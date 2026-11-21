//! Dependency graph. Mirrors `packages/domainlint/src/graph/dependency-graph.ts`.

use std::collections::HashMap;

use crate::parse::ImportInfo;

#[derive(Debug, Clone)]
pub struct Node {
    /// Node key: path without extension, unless it collides (Foo.ts / Foo.tsx), then the full path.
    pub key: String,
    /// Original absolute file path.
    pub path: String,
}

#[derive(Debug, Clone)]
pub struct Edge {
    pub from: u32,
    pub to: u32,
    pub import: ImportInfo,
}

#[derive(Debug, Default)]
pub struct Graph {
    pub nodes: Vec<Node>,
    /// All edges (duplicates kept), in file order then import order.
    pub edges: Vec<Edge>,
    /// Ordered, de-duplicated adjacency (insertion order), like a JS `Set`.
    pub adjacency: Vec<Vec<u32>>,
}

/// Node's `path.extname`.
pub fn extname(p: &str) -> &str {
    let base = p.rsplit('/').next().unwrap_or(p);
    match base.rfind('.') {
        Some(0) | None => "",
        Some(i) => &base[i..],
    }
}

fn normalize<'a>(path: &'a str, extensions: &[String]) -> &'a str {
    let ext = extname(path);
    if !ext.is_empty() && extensions.iter().any(|e| e == ext) {
        &path[..path.len() - ext.len()]
    } else {
        path
    }
}

/// `files[i]` is the i-th file; `imports[i]` its parsed imports; `resolved[i][k]` the resolution
/// of `imports[i][k]` (`None` = external/unresolved, dropped).
pub fn build_graph(
    files: &[String],
    imports: Vec<Vec<ImportInfo>>,
    resolved: &[Vec<Option<String>>],
    extensions: &[String],
) -> Graph {
    // Collisions: several files normalising to the same key keep their full path as key.
    let mut counts: HashMap<&str, u32> = HashMap::with_capacity(files.len());
    for f in files {
        *counts.entry(normalize(f, extensions)).or_insert(0) += 1;
    }
    let key_of = |path: &str| -> String {
        let n = normalize(path, extensions);
        if counts.get(n).is_some_and(|c| *c > 1) {
            path.to_string()
        } else {
            n.to_string()
        }
    };

    let mut index: HashMap<String, u32> = HashMap::with_capacity(files.len());
    let mut nodes: Vec<Node> = Vec::with_capacity(files.len());
    let mut file_node: Vec<u32> = Vec::with_capacity(files.len());
    for f in files {
        let key = key_of(f);
        // JS Set semantics: a repeated key would reuse the node (cannot happen: paths are unique).
        let id = *index.entry(key.clone()).or_insert_with(|| {
            nodes.push(Node {
                key,
                path: f.clone(),
            });
            (nodes.len() - 1) as u32
        });
        file_node.push(id);
    }

    let mut edges: Vec<Edge> = Vec::new();
    let mut adjacency: Vec<Vec<u32>> = vec![Vec::new(); nodes.len()];
    // `seen[to] == from + 1` means the edge from->to is already in adjacency (edges of one `from`
    // are processed contiguously because each file appears once).
    let mut seen = vec![0u32; nodes.len()];

    for (fi, file_imports) in imports.into_iter().enumerate() {
        let from = file_node[fi];
        for (k, info) in file_imports.into_iter().enumerate() {
            let Some(target) = resolved[fi][k].as_deref() else {
                continue;
            };
            let Some(&to) = index.get(&key_of(target)) else {
                continue;
            };
            edges.push(Edge {
                from,
                to,
                import: info,
            });
            if seen[to as usize] != from + 1 {
                seen[to as usize] = from + 1;
                adjacency[from as usize].push(to);
            }
        }
    }

    Graph {
        nodes,
        edges,
        adjacency,
    }
}
