//! napi binding: one production entry point, `lint`.
//!
//! Takes the already-resolved JS config (config parsing, `domainlint.json` and CLI overrides stay in
//! `packages/domainlint/src/config`), runs the native pipeline (discover, parse, resolve, graph,
//! built-in rules) and returns the result as flat typed arrays plus a string table, which the JS
//! side (`src/native/native-pipeline.ts`) turns back into `DependencyGraph` / `FileInfo[]` /
//! `ParseResult[]`. Violations come back as plain objects, unfiltered by override level: JS applies
//! `filterViolationsByOverrides` exactly as it does for the JS pipeline.

use std::collections::HashMap;
use std::path::PathBuf;

use domainlint_graph::config::{Overrides, RuleSelection};
use domainlint_graph::{
    Config, RunOptions, get_feature, is_barrel, parse_file, resolve_specifiers, run,
};
use napi::Error;
use napi::bindgen_prelude::{Int32Array, Uint8Array, Uint32Array};
use napi_derive::napi;

#[napi(object)]
pub struct LintOptions {
    /// Absolute project root.
    pub root_dir: String,
    /// Absolute source directory (already resolved against `rootDir`).
    pub src_dir: String,
    /// Absolute features directory.
    pub features_dir: String,
    pub barrel_files: Vec<String>,
    pub extensions: Vec<String>,
    pub exclude: Vec<String>,
    pub include_dynamic_imports: bool,
    /// Absolute tsconfig path (must exist, like the JS pipeline).
    pub tsconfig_path: String,
    /// Compute `noImportCycle` violations.
    pub compute_cycles: bool,
    /// Compute `noCrossFeatureDeepImport` violations.
    pub compute_cross_feature: bool,
    /// Compute `noFeatureImportFromNonDomain` violations.
    pub compute_non_domain: bool,
}

#[napi(object)]
pub struct NativeViolation {
    pub code: String,
    /// Absolute path of the offending file.
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub message: String,
}

#[napi(object)]
pub struct NativeTimings {
    pub walk: f64,
    pub read_parse: f64,
    pub resolve: f64,
    pub graph_build: f64,
    pub cycles: f64,
    pub boundaries: f64,
    pub total: f64,
}

/// Result of [`lint`]. Index `i` of `files` / `node_keys` / `file_feature` / `file_is_barrel` is
/// file (and graph node) `i`. Imports are stored flat in (file, source) order; file `i` owns
/// imports `import_offsets[i] .. import_offsets[i + 1]`.
#[napi(object)]
pub struct NativeLintResult {
    /// Original absolute paths, sorted (UTF-16 code unit order).
    pub files: Vec<String>,
    /// Graph node key per file: extension-stripped path, or the full path on a collision.
    pub node_keys: Vec<String>,
    /// Distinct feature names (first path segment below the features dir).
    pub features: Vec<String>,
    /// Index into `features`, or -1 when the file is outside the features dir.
    pub file_feature: Int32Array,
    /// 1 when the file is a barrel of its feature.
    pub file_is_barrel: Uint8Array,
    /// Length `files.length + 1`.
    pub import_offsets: Uint32Array,
    /// Index into `specifiers`.
    pub import_specifier: Uint32Array,
    pub import_line: Uint32Array,
    pub import_col: Uint32Array,
    /// bit 0 = type-only, bit 1 = dynamic.
    pub import_flags: Uint8Array,
    /// De-duplicated import specifiers.
    pub specifiers: Vec<String>,
    /// Graph edges in graph order; `edge_import` indexes the flat import arrays.
    pub edge_from: Uint32Array,
    pub edge_to: Uint32Array,
    pub edge_import: Uint32Array,
    /// Non-blank lines per file (lines that are not empty after a JS `trim()`).
    pub file_lines: Uint32Array,
    pub violations: Vec<NativeViolation>,
    pub timings_ms: NativeTimings,
}

fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn to_config(o: LintOptions) -> Config {
    Config {
        root_dir: PathBuf::from(o.root_dir),
        src_dir: PathBuf::from(o.src_dir),
        features_dir: PathBuf::from(o.features_dir),
        barrel_files: o.barrel_files,
        extensions: o.extensions,
        tsconfig_path: PathBuf::from(o.tsconfig_path),
        exclude: o.exclude,
        include_dynamic_imports: o.include_dynamic_imports,
        overrides: Overrides::default(),
        selection: Some(RuleSelection {
            import_cycles: o.compute_cycles,
            cross_feature_imports: o.compute_cross_feature,
            no_external_feature_imports: o.compute_non_domain,
        }),
    }
}

/// Runs the whole native pipeline. Synchronous (tens of ms even at 20k files). Throws
/// `Failed to parse <file>: <message>` on a syntax error, like the JS parser.
#[napi]
pub fn lint(options: LintOptions) -> napi::Result<NativeLintResult> {
    let config = to_config(options);
    let r =
        run(&config, &RunOptions::default()).map_err(|e| Error::from_reason(format!("{e:#}")))?;

    let n = r.files.len();
    let node_keys: Vec<String> = r.graph.nodes.iter().map(|x| x.key.clone()).collect();

    // features + barrel flags
    let mut features: Vec<String> = Vec::new();
    let mut feature_ids: HashMap<&str, i32> = HashMap::new();
    let mut file_feature = Vec::with_capacity(n);
    let mut file_is_barrel = Vec::with_capacity(n);
    for f in &r.files {
        match get_feature(f, &config.features_dir) {
            Some(name) => {
                let id = *feature_ids.entry(name).or_insert_with(|| {
                    features.push(name.to_string());
                    (features.len() - 1) as i32
                });
                file_feature.push(id);
                file_is_barrel.push(u8::from(is_barrel(f, name, &config)));
            }
            None => {
                file_feature.push(-1);
                file_is_barrel.push(0);
            }
        }
    }

    // imports (flat) + specifier table
    let total: usize = r.imports.iter().map(Vec::len).sum();
    let mut import_offsets = Vec::with_capacity(n + 1);
    let mut import_specifier = Vec::with_capacity(total);
    let mut import_line = Vec::with_capacity(total);
    let mut import_col = Vec::with_capacity(total);
    let mut import_flags = Vec::with_capacity(total);
    let mut specifiers: Vec<String> = Vec::new();
    let mut spec_ids: HashMap<&str, u32> = HashMap::new();
    import_offsets.push(0u32);
    for file_imports in &r.imports {
        for i in file_imports {
            let id = *spec_ids.entry(i.specifier.as_str()).or_insert_with(|| {
                specifiers.push(i.specifier.clone());
                (specifiers.len() - 1) as u32
            });
            import_specifier.push(id);
            import_line.push(i.line);
            import_col.push(i.col);
            import_flags.push(u8::from(i.is_type_only) | (u8::from(i.is_dynamic) << 1));
        }
        import_offsets.push(import_specifier.len() as u32);
    }

    let e = r.graph.edges.len();
    let mut edge_from = Vec::with_capacity(e);
    let mut edge_to = Vec::with_capacity(e);
    let mut edge_import = Vec::with_capacity(e);
    for edge in &r.graph.edges {
        edge_from.push(edge.from);
        edge_to.push(edge.to);
        edge_import.push(edge.import_index);
    }

    let violations = r
        .violations
        .iter()
        .map(|v| NativeViolation {
            code: v.code.as_str().to_string(),
            file: v.file.clone(),
            line: v.line,
            col: v.col,
            message: v.message(),
        })
        .collect();

    let t = &r.timings;
    Ok(NativeLintResult {
        files: r.files,
        node_keys,
        features,
        file_feature: Int32Array::new(file_feature),
        file_is_barrel: Uint8Array::new(file_is_barrel),
        import_offsets: Uint32Array::new(import_offsets),
        import_specifier: Uint32Array::new(import_specifier),
        import_line: Uint32Array::new(import_line),
        import_col: Uint32Array::new(import_col),
        import_flags: Uint8Array::new(import_flags),
        specifiers,
        edge_from: Uint32Array::new(edge_from),
        edge_to: Uint32Array::new(edge_to),
        edge_import: Uint32Array::new(edge_import),
        file_lines: Uint32Array::new(r.line_counts),
        violations,
        timings_ms: NativeTimings {
            walk: ms(t.walk),
            read_parse: ms(t.read_parse),
            resolve: ms(t.resolve),
            graph_build: ms(t.graph_build),
            cycles: ms(t.cycles),
            boundaries: ms(t.boundaries),
            total: ms(t.total),
        },
    })
}

#[napi(object)]
pub struct NativeImport {
    pub specifier: String,
    pub line: u32,
    pub col: u32,
    pub is_type_only: bool,
    pub is_dynamic: bool,
}

/// Parses a single file (used by `domainlint debug`); same import extraction as `lint`.
#[napi]
pub fn parse_imports(options: LintOptions, file_path: String) -> napi::Result<Vec<NativeImport>> {
    let config = to_config(options);
    let imports =
        parse_file(&config, &file_path).map_err(|e| Error::from_reason(format!("{e:#}")))?;
    Ok(imports
        .into_iter()
        .map(|i| NativeImport {
            specifier: i.specifier,
            line: i.line,
            col: i.col,
            is_type_only: i.is_type_only,
            is_dynamic: i.is_dynamic,
        })
        .collect())
}

/// Resolves specifiers imported from `from_file`; `null` = external or unresolved (used by
/// `domainlint debug`).
#[napi]
pub fn resolve_imports(
    options: LintOptions,
    from_file: String,
    specifiers: Vec<String>,
) -> Vec<Option<String>> {
    resolve_specifiers(&to_config(options), &from_file, &specifiers)
}
