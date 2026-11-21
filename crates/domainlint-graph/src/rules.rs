//! Built-in rules: import cycles (R1) and feature boundaries (R2).

use std::path::Path;

use crate::config::{Config, Level, RuleName};
use crate::graph::Graph;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    NoImportCycle,
    NoCrossFeatureDeepImport,
    NoFeatureImportFromNonDomain,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::NoImportCycle => "noImportCycle",
            Code::NoCrossFeatureDeepImport => "noCrossFeatureDeepImport",
            Code::NoFeatureImportFromNonDomain => "noFeatureImportFromNonDomain",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Violation {
    pub code: Code,
    /// `Warn` or `Error` (never `Off`).
    pub level: Level,
    /// Absolute path of the offending file.
    pub file: String,
    pub line: u32,
    pub col: u32,
    /// Boundary rules: the import specifier.
    pub specifier: String,
    /// Boundary rules: absolute path the import resolves to.
    pub resolved_to: String,
    /// `noCrossFeatureDeepImport`: absolute path of the expected barrel.
    pub barrel: String,
    /// `noImportCycle`: absolute file paths, first == last.
    pub cycle: Vec<String>,
}

/// Port of `getFeature` (file-discovery.ts): first path segment below `featuresDir`.
pub fn get_feature<'a>(path: &'a str, features_dir: &Path) -> Option<&'a str> {
    let rel = Path::new(path).strip_prefix(features_dir).ok()?;
    rel.components().next()?.as_os_str().to_str()
}

// ---------------------------------------------------------------------------------------------
// R1: cycles
// ---------------------------------------------------------------------------------------------

/// Exact port of `rules/cycle-detector.ts` (NOT Tarjan): for each node in node order that has not
/// been visited by an earlier traversal, run a DFS with a *fresh* `visited` set (so earlier
/// regions are re-walked), collect every back-edge as a cycle `path[idx(nb)..] + [nb]`, and
/// report each cycle whose start node has not been reported before.
///
/// Iterative so deep graphs cannot overflow the stack. Cycles are emitted in discovery order,
/// which equals the order Node concatenates them in.
///
/// Cycle *reports* follow this algorithm for parity with the Node implementation; see
/// [`scc_stats`] for the Tarjan cross-check.
pub fn find_cycles(graph: &Graph) -> Vec<Vec<u32>> {
    let n = graph.nodes.len();
    let mut global_visited = vec![false; n];
    let mut visited_stamp = vec![0u32; n];
    let mut on_stack = vec![false; n];
    let mut path_pos = vec![0u32; n];
    let mut reported_start = vec![false; n];
    let mut path: Vec<u32> = Vec::new();
    let mut frames: Vec<(u32, u32)> = Vec::new();
    let mut result = Vec::new();
    let mut stamp = 0u32;

    for start in 0..n as u32 {
        if global_visited[start as usize] {
            continue;
        }
        stamp += 1;
        // enter(start)
        visited_stamp[start as usize] = stamp;
        global_visited[start as usize] = true;
        on_stack[start as usize] = true;
        path_pos[start as usize] = path.len() as u32;
        path.push(start);
        frames.push((start, 0));

        while let Some(frame) = frames.last_mut() {
            let node = frame.0 as usize;
            let adj = &graph.adjacency[node];
            if (frame.1 as usize) < adj.len() {
                let nb = adj[frame.1 as usize];
                frame.1 += 1;
                if visited_stamp[nb as usize] != stamp {
                    visited_stamp[nb as usize] = stamp;
                    global_visited[nb as usize] = true;
                    on_stack[nb as usize] = true;
                    path_pos[nb as usize] = path.len() as u32;
                    path.push(nb);
                    frames.push((nb, 0));
                } else if on_stack[nb as usize] {
                    let first = path[path_pos[nb as usize] as usize];
                    if !reported_start[first as usize] {
                        reported_start[first as usize] = true;
                        let mut cycle: Vec<u32> = path[path_pos[nb as usize] as usize..].to_vec();
                        cycle.push(nb);
                        result.push(cycle);
                    }
                }
            } else {
                on_stack[node] = false;
                path.pop();
                frames.pop();
            }
        }
    }
    result
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SccStats {
    /// Number of strongly connected components that contain a cycle (size > 1, or a self-loop).
    pub cyclic_sccs: usize,
    /// Total number of nodes inside those components.
    pub nodes_in_cycles: usize,
    pub largest: usize,
}

/// Iterative Tarjan SCC. Fast cross-check: `cyclic_sccs` is a lower bound on the number of cycle
/// reports (each cyclic SCC contains at least one cycle) and equals 0 iff the graph is acyclic.
pub fn scc_stats(graph: &Graph) -> SccStats {
    let n = graph.nodes.len();
    const UNSET: u32 = u32::MAX;
    let mut index = vec![UNSET; n];
    let mut low = vec![0u32; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<u32> = Vec::new();
    let mut frames: Vec<(u32, u32)> = Vec::new();
    let mut next = 0u32;
    let mut stats = SccStats::default();

    for root in 0..n as u32 {
        if index[root as usize] != UNSET {
            continue;
        }
        index[root as usize] = next;
        low[root as usize] = next;
        next += 1;
        stack.push(root);
        on_stack[root as usize] = true;
        frames.push((root, 0));

        while let Some(frame) = frames.last_mut() {
            let v = frame.0 as usize;
            let adj = &graph.adjacency[v];
            if (frame.1 as usize) < adj.len() {
                let w = adj[frame.1 as usize] as usize;
                frame.1 += 1;
                if index[w] == UNSET {
                    index[w] = next;
                    low[w] = next;
                    next += 1;
                    stack.push(w as u32);
                    on_stack[w] = true;
                    frames.push((w as u32, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
            } else {
                if low[v] == index[v] {
                    let mut size = 0usize;
                    let mut self_loop = false;
                    loop {
                        let w = stack.pop().unwrap() as usize;
                        on_stack[w] = false;
                        size += 1;
                        if graph.adjacency[w].contains(&(w as u32)) {
                            self_loop = true;
                        }
                        if w == v {
                            break;
                        }
                    }
                    if size > 1 || self_loop {
                        stats.cyclic_sccs += 1;
                        stats.nodes_in_cycles += size;
                        stats.largest = stats.largest.max(size);
                    }
                }
                frames.pop();
                if let Some(parent) = frames.last() {
                    let p = parent.0 as usize;
                    low[p] = low[p].min(low[v]);
                }
            }
        }
    }
    stats
}

/// Turn raw cycles into violations. `line`/`col` come from the *first* edge in the global edge list
/// that goes `cycle[0] -> cycle[1]` (as in Node's `graph.edges.find`).
pub fn cycle_violations(graph: &Graph, config: &Config, cycles: &[Vec<u32>]) -> Vec<Violation> {
    use std::collections::HashMap;
    let mut wanted: HashMap<(u32, u32), Option<(u32, u32)>> = HashMap::new();
    for c in cycles {
        wanted.insert((c[0], c[1]), None);
    }
    let mut remaining = wanted.len();
    for e in &graph.edges {
        if remaining == 0 {
            break;
        }
        if let Some(slot @ None) = wanted.get_mut(&(e.from, e.to)) {
            *slot = Some((e.import.line, e.import.col));
            remaining -= 1;
        }
    }

    let mut out = Vec::new();
    for c in cycles {
        let file = graph.nodes[c[0] as usize].path.clone();
        let level = config.effective_level(RuleName::ImportCycles, &file);
        if level == Level::Off {
            continue;
        }
        let (line, col) = wanted[&(c[0], c[1])].unwrap_or((1, 1));
        out.push(Violation {
            code: Code::NoImportCycle,
            level,
            file,
            line,
            col,
            specifier: String::new(),
            resolved_to: String::new(),
            barrel: String::new(),
            cycle: c
                .iter()
                .map(|&i| graph.nodes[i as usize].path.clone())
                .collect(),
        });
    }
    out
}

// ---------------------------------------------------------------------------------------------
// R2: feature boundaries
// ---------------------------------------------------------------------------------------------

/// Port of `rules/feature-boundary-validator.ts`, iterating edges in graph order.
/// Only emits what could be enabled (Node emits everything and filters afterwards).
pub fn boundary_violations(graph: &Graph, config: &Config) -> Vec<Violation> {
    let want_deep = config.rule_possibly_enabled(RuleName::CrossFeatureImports);
    let want_non_domain = config.rule_possibly_enabled(RuleName::NoExternalFeatureImports);
    if !want_deep && !want_non_domain {
        return Vec::new();
    }

    let features: Vec<Option<&str>> = graph
        .nodes
        .iter()
        .map(|n| get_feature(&n.path, &config.features_dir))
        .collect();

    let mut out = Vec::new();
    for e in &graph.edges {
        let from_feature = features[e.from as usize];
        let to_feature = features[e.to as usize];
        let from_path = &graph.nodes[e.from as usize].path;
        let to_path = &graph.nodes[e.to as usize].path;

        // Rule 1: feature importing from outside the features dir.
        if from_feature.is_some() && to_feature.is_none() {
            if want_non_domain {
                let level = config.effective_level(RuleName::NoExternalFeatureImports, from_path);
                if level != Level::Off {
                    out.push(Violation {
                        code: Code::NoFeatureImportFromNonDomain,
                        level,
                        file: from_path.clone(),
                        line: e.import.line,
                        col: e.import.col,
                        specifier: e.import.specifier.clone(),
                        resolved_to: to_path.clone(),
                        barrel: String::new(),
                        cycle: Vec::new(),
                    });
                }
            }
            continue;
        }
        let Some(to_feature) = to_feature else {
            continue;
        };
        if from_feature == Some(to_feature) {
            continue; // same-feature deep imports are allowed
        }
        if !want_deep {
            continue;
        }
        // Rule 2: cross-feature import must hit a barrel.
        let feature_dir = config.features_dir.join(to_feature);
        let is_barrel = Path::new(to_path)
            .strip_prefix(&feature_dir)
            .ok()
            .map(|r| {
                r.components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .is_some_and(|rel| config.barrel_files.contains(&rel));
        if is_barrel {
            continue;
        }
        let level = config.effective_level(RuleName::CrossFeatureImports, from_path);
        if level == Level::Off {
            continue;
        }
        let barrel = crate::config::resolve_path(
            &config.features_dir,
            &format!("{}/{}", to_feature, config.barrel_files[0]),
        );
        out.push(Violation {
            code: Code::NoCrossFeatureDeepImport,
            level,
            file: from_path.clone(),
            line: e.import.line,
            col: e.import.col,
            specifier: e.import.specifier.clone(),
            resolved_to: to_path.clone(),
            barrel: barrel.to_string_lossy().into_owned(),
            cycle: Vec::new(),
        });
    }
    out
}
