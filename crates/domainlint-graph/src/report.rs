//! Plain (`--no-color`) output, byte-compatible with `ColoredReporter` for the three built-in
//! violation codes and the summary line. Not ported: the per-domain summary and cycle-analysis
//! sections that Node prints after the summary.

use std::path::{Component, Path};

use crate::config::Level;
use crate::rules::{Code, Violation};

/// Node's `path.relative(from, to)` for absolute, normalised paths.
pub fn relative(from: &Path, to: &Path) -> String {
    let f: Vec<Component> = from.components().collect();
    let t: Vec<Component> = to.components().collect();
    let common = f.iter().zip(&t).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = Vec::new();
    for _ in common..f.len() {
        parts.push("..".into());
    }
    for c in &t[common..] {
        parts.push(c.as_os_str().to_string_lossy().into_owned());
    }
    parts.join("/")
}

/// `stripPaths`: replace every occurrence of the root dir with `.` (global string replace).
fn strip(s: &str, root: &str) -> String {
    if root.is_empty() {
        s.to_string()
    } else {
        s.replace(root, ".")
    }
}

fn level_label(l: Level) -> &'static str {
    if l == Level::Warn { "WARN" } else { "ERROR" }
}

pub fn format_violation(v: &Violation, root: &Path) -> String {
    let root_s = root.to_string_lossy();
    let file = relative(root, Path::new(&v.file));
    let head = format!(
        "{}:{}:{} {} {}",
        file,
        v.line,
        v.col,
        level_label(v.level),
        v.code.as_str()
    );
    match v.code {
        Code::NoImportCycle => {
            let paths: Vec<String> = v.cycle.iter().map(|p| strip(p, &root_s)).collect();
            let (display, summary) = truncate_cycle(&paths, 8);
            let mut out = format!(
                "{head}\n  Import cycle detected:\n    {} ->",
                display.join(" ->\n    ")
            );
            if let Some(s) = summary {
                out.push_str(&format!("\n  {s}"));
            }
            out
        }
        Code::NoCrossFeatureDeepImport => [
            head,
            "  Cross-feature deep import not allowed".to_string(),
            format!("    Import:        \"{}\"", strip(&v.specifier, &root_s)),
            format!("    Resolves to:   \"{}\"", strip(&v.resolved_to, &root_s)),
            format!("    Should use:    \"{}\"", strip(&v.barrel, &root_s)),
        ]
        .join("\n"),
        Code::NoFeatureImportFromNonDomain => [
            head,
            "  Feature import from non-domain directory not allowed".to_string(),
            format!("    Import:        \"{}\"", strip(&v.specifier, &root_s)),
            format!("    Resolves to:   \"{}\"", strip(&v.resolved_to, &root_s)),
            "    Suggestion:    Create or move to an existing feature/domain for this import"
                .to_string(),
        ]
        .join("\n"),
    }
}

fn truncate_cycle(path: &[String], max_visible: usize) -> (Vec<String>, Option<String>) {
    if path.len() <= max_visible {
        return (path.to_vec(), None);
    }
    let (first, last) = (3, 3);
    let hidden = path.len() - first - last;
    let mut display: Vec<String> = path[..first].to_vec();
    display.push(format!("[... {hidden} more imports in cycle]"));
    display.extend_from_slice(&path[path.len() - last..]);
    (
        display,
        Some(format!("(Total cycle length: {} files)", path.len())),
    )
}

pub fn format_summary(violations: &[Violation]) -> String {
    if violations.is_empty() {
        return "✓ No violations found".to_string();
    }
    let cycles = violations
        .iter()
        .filter(|v| v.code == Code::NoImportCycle)
        .count();
    let boundary = violations.len() - cycles;
    let mut parts: Vec<String> = Vec::new();
    if cycles > 0 {
        parts.push(format!(
            "{cycles} import cycle{}",
            if cycles > 1 { "s" } else { "" }
        ));
    }
    if boundary > 0 {
        parts.push(format!(
            "{boundary} boundary violation{}",
            if boundary > 1 { "s" } else { "" }
        ));
    }
    let n = violations.len();
    format!(
        "✗ Found {} ({} total violation{})",
        parts.join(" and "),
        n,
        if n > 1 { "s" } else { "" }
    )
}
