//! Import extraction from oxc's module record (no AST walking).
//! Mirrors `packages/domainlint/src/parser/oxc-parser.ts`:
//!
//! 1. static imports (one per import statement, side-effect imports included),
//! 2. re-exports (one per export statement with a module request; `export {} from 'x'` has none),
//! 3. dynamic imports (only if enabled; only string-literal specifiers).
//!
//! Order is "all imports, then all re-exports, then dynamic" (each in source order), like Node.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Result, anyhow};
use memchr::memchr;
use oxc_allocator::Allocator;
use oxc_parser::{ParseOptions, Parser};
use oxc_span::SourceType;

#[derive(Debug, Clone)]
pub struct ImportInfo {
    pub specifier: String,
    /// 1-based line.
    pub line: u32,
    /// 1-based column in UTF-16 code units (same as Node's JS string indexing).
    pub col: u32,
    pub is_dynamic: bool,
    /// Metadata only: type-only imports still produce edges (as in Node).
    pub is_type_only: bool,
}

struct Raw {
    offset: u32,
    specifier: String,
    is_dynamic: bool,
    is_type_only: bool,
}

pub fn parse_imports(
    path: &Path,
    source: &str,
    allocator: &Allocator,
    include_dynamic: bool,
) -> Result<Vec<ImportInfo>> {
    // Node passes sourceType:'module' explicitly; language is inferred from the extension.
    let source_type = SourceType::from_path(path)
        .unwrap_or_else(|_| SourceType::ts())
        .with_module(true);
    let options = ParseOptions {
        preserve_parens: false,
        ..ParseOptions::default()
    };
    let ret = Parser::new(allocator, source, source_type)
        .with_options(options)
        .parse();

    if ret.fatal_error || ret.diagnostics.has_errors() {
        let msg = ret.diagnostics.errors().next().map_or_else(
            || "fatal parse error".to_string(),
            |d| d.message.to_string(),
        );
        return Err(anyhow!("Failed to parse {}: {}", path.display(), msg));
    }

    let rec = &ret.module_record;
    let mut raws: Vec<Raw> = Vec::new();

    // --- static imports: grouped entries per statement tell us `isTypeOnly`.
    let mut entry_stats: std::collections::HashMap<u32, (usize, bool)> =
        std::collections::HashMap::new();
    for e in rec.import_entries.iter() {
        let s = entry_stats
            .entry(e.statement_span.start)
            .or_insert((0, true));
        s.0 += 1;
        s.1 &= e.is_type;
    }
    let mut imports: Vec<Raw> = Vec::new();
    for (name, list) in rec.requested_modules.iter() {
        for rm in list.iter() {
            if !rm.is_import {
                continue;
            }
            let start = rm.statement_span.start;
            let is_type_only = entry_stats
                .get(&start)
                .is_some_and(|(count, all_type)| *count > 0 && *all_type);
            imports.push(Raw {
                offset: start,
                specifier: name.as_str().to_string(),
                is_dynamic: false,
                is_type_only,
            });
        }
    }
    imports.sort_by_key(|r| r.offset);
    raws.extend(imports);

    // --- re-exports: group entries with a module request by statement.
    let mut exports: BTreeMap<u32, (String, bool)> = BTreeMap::new();
    for e in rec
        .indirect_export_entries
        .iter()
        .chain(rec.star_export_entries.iter())
    {
        if let Some(mr) = &e.module_request {
            let slot = exports
                .entry(e.statement_span.start)
                .or_insert_with(|| (mr.name.as_str().to_string(), true));
            slot.1 &= e.is_type;
        }
    }
    for (offset, (specifier, is_type_only)) in exports {
        raws.push(Raw {
            offset,
            specifier,
            is_dynamic: false,
            is_type_only,
        });
    }

    // --- dynamic imports
    if include_dynamic {
        for d in rec.dynamic_imports.iter() {
            let raw = &source[d.module_request.start as usize..d.module_request.end as usize];
            // Same quirk as Node's stripQuotes: only checks first/last char.
            let b = raw.as_bytes();
            let quoted = b.len() >= 2
                && ((b[0] == b'\'' && b[b.len() - 1] == b'\'')
                    || (b[0] == b'"' && b[b.len() - 1] == b'"'));
            if quoted {
                let spec = &raw[1..raw.len() - 1];
                if !spec.is_empty() {
                    raws.push(Raw {
                        offset: d.span.start,
                        specifier: spec.to_string(),
                        is_dynamic: true,
                        is_type_only: false,
                    });
                }
            }
        }
    }

    Ok(to_import_infos(source, raws))
}

fn to_import_infos(source: &str, raws: Vec<Raw>) -> Vec<ImportInfo> {
    if raws.is_empty() {
        return Vec::new();
    }
    let mut order: Vec<usize> = (0..raws.len()).collect();
    order.sort_by_key(|&i| raws[i].offset);
    let mut pos_of = vec![(0u32, 0u32); raws.len()];

    let bytes = source.as_bytes();
    let mut line = 1u32;
    let mut line_start = 0usize;
    let mut pos = 0usize;
    for &i in &order {
        let off = (raws[i].offset as usize).min(bytes.len());
        while pos < off {
            match memchr(b'\n', &bytes[pos..off]) {
                Some(nl) => {
                    line += 1;
                    line_start = pos + nl + 1;
                    pos = line_start;
                }
                None => break,
            }
        }
        pos = off.max(pos);
        // UTF-16 column (Node counts JS string indices); for ASCII this equals the byte column.
        let col = source[line_start..off].encode_utf16().count() as u32 + 1;
        pos_of[i] = (line, col);
    }

    raws.into_iter()
        .zip(pos_of)
        .map(|(r, (line, col))| ImportInfo {
            specifier: r.specifier,
            line,
            col,
            is_dynamic: r.is_dynamic,
            is_type_only: r.is_type_only,
        })
        .collect()
}
