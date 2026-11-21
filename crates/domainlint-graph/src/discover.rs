//! File discovery. Mirrors `packages/domainlint/src/files/file-discovery.ts`:
//! `**/*<ext>` for each extension under `srcDir`, no dotfiles/dot-dirs (glob's `dot:false`),
//! then `exclude` globs matched against the path relative to `srcDir`.
//!
//! Order: sorted by path in UTF-16 code unit order, the same as `Array.prototype.sort()` on the
//! absolute paths in the JS fallback (`file-discovery.ts` sorts too), so node order, and with it
//! which file of a cycle is reported as its start, is deterministic and identical in both pipelines.

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
    // Deterministic order, identical to the JS fallback's `Array.prototype.sort()` (UTF-16 code
    // unit order; differs from byte order only for astral vs. U+E000..U+FFFF characters).
    out.sort_unstable_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    out.dedup();
    Ok(out)
}
