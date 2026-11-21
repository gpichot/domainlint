//! File discovery. Mirrors `packages/domainlint/src/files/file-discovery.ts`:
//! `**/*<ext>` for each extension under `srcDir`, no dotfiles/dot-dirs (glob's `dot:false`),
//! then `exclude` globs matched against the path relative to `srcDir`.
//!
//! Order: Node's async `glob` has no defined order and is NOT even stable between runs on the same
//! tree (observed on a 10k-file fixture: 3 runs, 3 different orders; readdir completion order
//! races). On small/regular trees it behaves like a level-order walk with each directory's
//! entries in descending name order, with one group per configured extension pattern
//! (`**/*.ts` results first, then `**/*.tsx` ones not yet seen, ...). We emulate exactly that,
//! deterministically: sort by (depth ascending, then path components descending), then group by
//! extension in config order. Node order only matters for *which file of a cycle is reported as
//! the cycle start*; it never changes which files are in a cycle or any boundary finding.

use anyhow::Result;
use globset::{GlobBuilder, GlobSetBuilder};
use ignore::WalkBuilder;

use crate::config::Config;

pub fn discover_files(config: &Config) -> Result<Vec<String>> {
    let mut gs = GlobSetBuilder::new();
    for pat in &config.exclude {
        gs.add(GlobBuilder::new(pat).literal_separator(true).build()?);
    }
    let excludes = gs.build()?;

    let walker = WalkBuilder::new(&config.src_dir)
        .hidden(true) // skip dotfiles / dot-dirs, like glob with dot:false
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .require_git(false)
        .follow_links(false)
        .build();

    let mut out: Vec<String> = Vec::new();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        let Some(ft) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        let is_file = ft.is_file() || (ft.is_symlink() && path.is_file());
        if !is_file {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !config.extensions.iter().any(|e| name.ends_with(e.as_str())) {
            continue;
        }
        let rel = path.strip_prefix(&config.src_dir).unwrap_or(path);
        if !excludes.is_empty() && excludes.is_match(rel) {
            continue;
        }
        out.push(path.to_string_lossy().into_owned());
    }
    out.sort_unstable();
    out.dedup();
    // Approximate Node's glob order (see module docs).
    let src = config.src_dir.to_string_lossy().into_owned();
    let rel_components = |p: &str| -> Vec<String> {
        p.strip_prefix(src.as_str())
            .unwrap_or(p)
            .trim_start_matches('/')
            .split('/')
            .map(str::to_string)
            .collect()
    };
    let mut keyed: Vec<(Vec<String>, String)> =
        out.into_iter().map(|p| (rel_components(&p), p)).collect();
    keyed.sort_by(|(a, _), (b, _)| a.len().cmp(&b.len()).then_with(|| b.cmp(a)));
    let mut seen = vec![false; keyed.len()];
    let mut ordered = Vec::with_capacity(keyed.len());
    for ext in &config.extensions {
        for (i, (_, p)) in keyed.iter().enumerate() {
            if !seen[i] && p.ends_with(ext.as_str()) {
                seen[i] = true;
                ordered.push(p.clone());
            }
        }
    }
    Ok(ordered)
}
