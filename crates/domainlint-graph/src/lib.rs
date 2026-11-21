//! Native import-graph build + the two built-in domainlint rules (R1 cycles, R2 feature
//! boundaries). Designed so a napi binding can call [`run`] directly.
//!
//! Pipeline (each phase timed separately, see [`Timings`]):
//!   walk -> read+parse (rayon) -> resolve (rayon, one shared `Resolver`) -> graph -> rules.
//! Parse and resolve are deliberately separate passes (not fused per file) so their cost can be
//! attributed; fusing would save one barrier and some cache misses.
//!
//! Differences from the Node pipeline (all deliberate): rules that are `off` are skipped instead of
//! computed-then-filtered; tsconfig is only consumed by the resolver (Node additionally shells out
//! to `npx tsc --showConfig`, whose result is unused by resolution); user rules files
//! (`domainlint.rules.ts`) and workspaces are not supported.

pub mod config;
pub mod discover;
pub mod graph;
pub mod parse;
pub mod report;
pub mod resolve;
pub mod rules;

use std::time::{Duration, Instant};

use anyhow::Result;
use oxc_allocator::Allocator;
use rayon::prelude::*;

pub use config::{CliOverrides, Config, Level, RuleName};
pub use graph::Graph;
pub use rules::{Code, SccStats, Violation, get_feature, is_barrel};

#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    /// Also run the Tarjan SCC cross-check (reported in [`RunResult::scc`]).
    pub scc: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Timings {
    pub walk: Duration,
    pub read_parse: Duration,
    pub resolve: Duration,
    pub graph_build: Duration,
    pub cycles: Duration,
    pub boundaries: Duration,
    pub scc: Duration,
    pub total: Duration,
    pub cycles_skipped: bool,
    pub boundaries_skipped: bool,
}

#[derive(Debug)]
pub struct RunResult {
    pub file_count: usize,
    pub edge_count: usize,
    pub import_count: usize,
    pub graph: Graph,
    /// Discovered files (sorted); `graph.nodes[i]` belongs to `files[i]`.
    pub files: Vec<String>,
    /// All parsed imports per file (external and unresolved ones included), in file order.
    pub imports: Vec<Vec<parse::ImportInfo>>,
    /// Non-blank line count per file (same order as `files`).
    pub line_counts: Vec<u32>,
    /// Cycles first, then boundary violations (same order as Node's output).
    pub violations: Vec<Violation>,
    pub scc: Option<SccStats>,
    pub timings: Timings,
}

pub fn run(config: &Config, opts: &RunOptions) -> Result<RunResult> {
    let t_total = Instant::now();
    let mut timings = Timings::default();

    // Node requires the tsconfig to exist (loadTsConfig throws otherwise); same message.
    if !config.tsconfig_path.exists() {
        let p = config.tsconfig_path.display();
        anyhow::bail!(
            "Failed to read tsconfig.json at {p}: ENOENT: no such file or directory, open '{p}'"
        );
    }

    // 1. walk
    let t = Instant::now();
    let files = discover::discover_files(config)?;
    timings.walk = t.elapsed();

    // 2. read + parse
    let t = Instant::now();
    let include_dynamic = config.include_dynamic_imports;
    let parsed: Vec<(Vec<parse::ImportInfo>, u32)> = files
        .par_iter()
        .map_init(Allocator::default, |alloc, path| {
            alloc.reset();
            let bytes =
                std::fs::read(path).map_err(|e| anyhow::anyhow!("Failed to read {path}: {e}"))?;
            let source = String::from_utf8_lossy(&bytes);
            let loc = parse::count_loc(&source);
            let imports =
                parse::parse_imports(std::path::Path::new(path), &source, alloc, include_dynamic)?;
            Ok((imports, loc))
        })
        .collect::<Result<Vec<_>>>()?;
    let (imports, line_counts): (Vec<_>, Vec<_>) = parsed.into_iter().unzip();
    timings.read_parse = t.elapsed();
    let import_count: usize = imports.iter().map(Vec::len).sum();

    // 3. resolve
    let t = Instant::now();
    let resolver = resolve::build_resolver(config);
    let resolved: Vec<Vec<Option<String>>> = files
        .par_iter()
        .zip(imports.par_iter())
        .map(|(file, imps)| {
            imps.iter()
                .map(|i| resolve::resolve_local(&resolver, file, &i.specifier))
                .collect()
        })
        .collect();
    timings.resolve = t.elapsed();

    // 4. graph
    let t = Instant::now();
    let graph = graph::build_graph(&files, &imports, &resolved, &config.extensions);
    timings.graph_build = t.elapsed();

    // 5. rules (skipped entirely when off)
    let mut violations = Vec::new();

    let t = Instant::now();
    if config.rule_possibly_enabled(RuleName::ImportCycles) {
        let cycles = rules::find_cycles(&graph);
        violations.extend(rules::cycle_violations(&graph, config, &cycles));
    } else {
        timings.cycles_skipped = true;
    }
    timings.cycles = t.elapsed();

    let t = Instant::now();
    if config.rule_possibly_enabled(RuleName::CrossFeatureImports)
        || config.rule_possibly_enabled(RuleName::NoExternalFeatureImports)
    {
        violations.extend(rules::boundary_violations(&graph, config));
    } else {
        timings.boundaries_skipped = true;
    }
    timings.boundaries = t.elapsed();

    let scc = if opts.scc {
        let t = Instant::now();
        let s = rules::scc_stats(&graph);
        timings.scc = t.elapsed();
        Some(s)
    } else {
        None
    };

    timings.total = t_total.elapsed();
    Ok(RunResult {
        file_count: files.len(),
        edge_count: graph.edges.len(),
        import_count,
        graph,
        files,
        imports,
        line_counts,
        violations,
        scc,
        timings,
    })
}

/// Parses one file (any path, not necessarily under `srcDir`), for `domainlint debug`.
pub fn parse_file(config: &Config, path: &str) -> Result<Vec<parse::ImportInfo>> {
    let bytes = std::fs::read(path).map_err(|e| anyhow::anyhow!("Failed to read {path}: {e}"))?;
    let source = String::from_utf8_lossy(&bytes);
    let alloc = Allocator::default();
    parse::parse_imports(
        std::path::Path::new(path),
        &source,
        &alloc,
        config.include_dynamic_imports,
    )
}

/// Resolves `specifiers` as imported from `from_file` (`None` = external or unresolved), for
/// `domainlint debug`. Same semantics as the resolution used for the graph.
pub fn resolve_specifiers(
    config: &Config,
    from_file: &str,
    specifiers: &[String],
) -> Vec<Option<String>> {
    let resolver = resolve::build_resolver(config);
    specifiers
        .iter()
        .map(|s| resolve::resolve_local(&resolver, from_file, s))
        .collect()
}
