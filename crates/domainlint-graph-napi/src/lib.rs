//! Spike: three ways to hand the Rust import graph to JS.
//!   buildGraph        objects-per-edge (what a naive port would do)
//!   buildGraphCompact typed arrays + string table
//!   buildGraphJson    one JSON string, JSON.parse on the JS side
//! All three run the full Rust pipeline (`domainlint_graph::run`) and differ only in marshalling.

use std::path::Path;

use domainlint_graph::{CliOverrides, Config, RunOptions, RunResult, run};
use napi::Error;
use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;

#[napi(object)]
pub struct JsEdge {
    pub from: u32,
    pub to: u32,
    pub specifier: String,
    pub line: u32,
    pub col: u32,
    pub is_type_only: bool,
    pub is_dynamic: bool,
}

#[napi(object)]
pub struct JsViolation {
    pub code: String,
    pub level: String,
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub specifier: String,
    pub resolved_to: String,
    pub barrel: String,
    pub cycle: Vec<String>,
}

#[napi(object)]
pub struct JsTimings {
    pub walk: f64,
    pub read_parse: f64,
    pub resolve: f64,
    pub graph_build: f64,
    pub cycles: f64,
    pub boundaries: f64,
    pub total: f64,
}

#[napi(object)]
pub struct JsGraph {
    /// Original file paths (index == node id).
    pub files: Vec<String>,
    /// Node keys (extension-stripped), index == node id.
    pub nodes: Vec<String>,
    pub edges: Vec<JsEdge>,
    pub violations: Vec<JsViolation>,
    pub timings_ms: JsTimings,
}

#[napi(object)]
pub struct JsGraphCompact {
    pub files: Vec<String>,
    pub nodes: Vec<String>,
    pub edge_from: Uint32Array,
    pub edge_to: Uint32Array,
    pub line: Uint32Array,
    pub col: Uint32Array,
    /// bit0 = type-only, bit1 = dynamic
    pub flags: Uint32Array,
    pub specifiers: Vec<String>,
    pub violations: Vec<JsViolation>,
    pub timings_ms: JsTimings,
}

fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn exec(root_dir: &str, config_path: Option<String>) -> napi::Result<(RunResult, Config)> {
    let cfg = Config::load(Path::new(root_dir), config_path.as_deref(), &CliOverrides::default())
        .map_err(|e| Error::from_reason(format!("{e:#}")))?;
    let res = run(&cfg, &RunOptions::default()).map_err(|e| Error::from_reason(format!("{e:#}")))?;
    Ok((res, cfg))
}

fn timings(r: &RunResult) -> JsTimings {
    let t = &r.timings;
    JsTimings {
        walk: ms(t.walk),
        read_parse: ms(t.read_parse),
        resolve: ms(t.resolve),
        graph_build: ms(t.graph_build),
        cycles: ms(t.cycles),
        boundaries: ms(t.boundaries),
        total: ms(t.total),
    }
}

fn violations(r: &RunResult) -> Vec<JsViolation> {
    r.violations
        .iter()
        .map(|v| JsViolation {
            code: v.code.as_str().to_string(),
            level: format!("{:?}", v.level).to_lowercase(),
            file: v.file.clone(),
            line: v.line,
            col: v.col,
            specifier: v.specifier.clone(),
            resolved_to: v.resolved_to.clone(),
            barrel: v.barrel.clone(),
            cycle: v.cycle.clone(),
        })
        .collect()
}

fn files_nodes(r: &RunResult) -> (Vec<String>, Vec<String>) {
    (
        r.graph.nodes.iter().map(|n| n.path.clone()).collect(),
        r.graph.nodes.iter().map(|n| n.key.clone()).collect(),
    )
}

#[napi(js_name = "buildGraph")]
pub fn build_graph(root_dir: String, config_path: Option<String>) -> napi::Result<JsGraph> {
    let (r, _) = exec(&root_dir, config_path)?;
    let (files, nodes) = files_nodes(&r);
    let edges = r
        .graph
        .edges
        .iter()
        .map(|e| JsEdge {
            from: e.from,
            to: e.to,
            specifier: e.import.specifier.clone(),
            line: e.import.line,
            col: e.import.col,
            is_type_only: e.import.is_type_only,
            is_dynamic: e.import.is_dynamic,
        })
        .collect();
    Ok(JsGraph { files, nodes, edges, violations: violations(&r), timings_ms: timings(&r) })
}

#[napi(js_name = "buildGraphCompact")]
pub fn build_graph_compact(root_dir: String, config_path: Option<String>) -> napi::Result<JsGraphCompact> {
    let (r, _) = exec(&root_dir, config_path)?;
    let (files, nodes) = files_nodes(&r);
    let n = r.graph.edges.len();
    let (mut from, mut to, mut line, mut col, mut flags) = (
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
    );
    let mut specifiers = Vec::with_capacity(n);
    for e in &r.graph.edges {
        from.push(e.from);
        to.push(e.to);
        line.push(e.import.line);
        col.push(e.import.col);
        flags.push(u32::from(e.import.is_type_only) | (u32::from(e.import.is_dynamic) << 1));
        specifiers.push(e.import.specifier.clone());
    }
    Ok(JsGraphCompact {
        files,
        nodes,
        edge_from: Uint32Array::new(from),
        edge_to: Uint32Array::new(to),
        line: Uint32Array::new(line),
        col: Uint32Array::new(col),
        flags: Uint32Array::new(flags),
        specifiers,
        violations: violations(&r),
        timings_ms: timings(&r),
    })
}

#[napi(js_name = "buildGraphJson")]
pub fn build_graph_json(root_dir: String, config_path: Option<String>) -> napi::Result<String> {
    let (r, _) = exec(&root_dir, config_path)?;
    let (files, nodes) = files_nodes(&r);
    let t = &r.timings;
    let edges: Vec<serde_json::Value> = r
        .graph
        .edges
        .iter()
        .map(|e| {
            serde_json::json!({
                "from": e.from, "to": e.to, "specifier": e.import.specifier,
                "line": e.import.line, "col": e.import.col,
                "isTypeOnly": e.import.is_type_only, "isDynamic": e.import.is_dynamic,
            })
        })
        .collect();
    let viol: Vec<serde_json::Value> = violations(&r)
        .into_iter()
        .map(|v| {
            serde_json::json!({
                "code": v.code, "level": v.level, "file": v.file, "line": v.line, "col": v.col,
                "specifier": v.specifier, "resolvedTo": v.resolved_to, "barrel": v.barrel, "cycle": v.cycle,
            })
        })
        .collect();
    let out = serde_json::json!({
        "files": files, "nodes": nodes, "edges": edges, "violations": viol,
        "timingsMs": {
            "walk": ms(t.walk), "readParse": ms(t.read_parse), "resolve": ms(t.resolve),
            "graphBuild": ms(t.graph_build), "cycles": ms(t.cycles),
            "boundaries": ms(t.boundaries), "total": ms(t.total),
        },
    });
    serde_json::to_string(&out).map_err(|e| Error::from_reason(e.to_string()))
}
