use std::fs;
use std::path::Path;

use domainlint_graph::{CliOverrides, Code, Config, RunOptions, RunResult, report, run};

const TSCONFIG: &str = r#"{
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } }
}"#;

/// Creates a project in a temp dir: tsconfig.json + the given (path, content) files.
fn project(files: &[(&str, &str)], config_json: Option<&str>) -> (tempfile::TempDir, Config) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    fs::write(root.join("tsconfig.json"), TSCONFIG).unwrap();
    fs::create_dir_all(root.join("src/features")).unwrap();
    if let Some(c) = config_json {
        fs::write(root.join("domainlint.json"), c).unwrap();
    }
    for (p, content) in files {
        let full = root.join(p);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    let config = Config::load(&root, None, &CliOverrides::default()).unwrap();
    (dir, config)
}

fn lint(files: &[(&str, &str)]) -> (tempfile::TempDir, Config, RunResult) {
    let (d, c) = project(files, None);
    let r = run(&c, &RunOptions { scc: true }).unwrap();
    (d, c, r)
}

fn codes(r: &RunResult) -> Vec<&'static str> {
    r.violations.iter().map(|v| v.code.as_str()).collect()
}

fn rel(c: &Config, abs: &str) -> String {
    report::relative(&c.root_dir, Path::new(abs))
}

#[test]
fn deep_cross_feature_import_is_flagged() {
    let (_d, c, r) = lint(&[
        ("src/features/a/index.ts", "export const a = 1;\n"),
        ("src/features/b/index.ts", "export const b = 1;\n"),
        ("src/features/b/inner.ts", "export const inner = 1;\n"),
        (
            "src/features/a/use.ts",
            "import { a } from './index';\nimport { inner } from '@/features/b/inner';\n",
        ),
    ]);
    assert_eq!(codes(&r), ["noCrossFeatureDeepImport"]);
    let v = &r.violations[0];
    assert_eq!(rel(&c, &v.file), "src/features/a/use.ts");
    assert_eq!((v.line, v.col), (2, 1));
    assert_eq!(v.specifier, "@/features/b/inner");
    assert_eq!(rel(&c, &v.resolved_to), "src/features/b/inner.ts");
    assert_eq!(rel(&c, &v.barrel), "src/features/b/index.ts");

    // Plain output matches the Node reporter format.
    let out = report::format_violation(v, &c.root_dir);
    assert_eq!(
        out,
        "src/features/a/use.ts:2:1 ERROR noCrossFeatureDeepImport\n  Cross-feature deep import not allowed\n    Import:        \"@/features/b/inner\"\n    Resolves to:   \"./src/features/b/inner.ts\"\n    Should use:    \"./src/features/b/index.ts\""
    );
    assert_eq!(
        report::format_summary(&r.violations),
        "✗ Found 1 boundary violation (1 total violation)"
    );
}

#[test]
fn barrel_import_is_allowed() {
    let (_d, _c, r) = lint(&[
        ("src/features/b/index.ts", "export const b = 1;\n"),
        ("src/features/a/index.ts", "export const a = 1;\n"),
        (
            "src/features/a/use.ts",
            "import { b } from '@/features/b';\nexport const x = b;\n",
        ),
    ]);
    assert!(r.violations.is_empty(), "{:?}", codes(&r));
    assert_eq!(r.edge_count, 1);
    assert_eq!(
        report::format_summary(&r.violations),
        "✓ No violations found"
    );
}

#[test]
fn same_feature_deep_import_is_allowed() {
    let (_d, _c, r) = lint(&[
        ("src/features/a/index.ts", "export const a = 1;\n"),
        (
            "src/features/a/one.ts",
            "import { two } from './deep/two';\n",
        ),
        ("src/features/a/deep/two.ts", "export const two = 2;\n"),
    ]);
    assert!(r.violations.is_empty());
    assert_eq!(r.edge_count, 1);
}

#[test]
fn two_file_cycle_is_reported_once_with_path() {
    let (_d, c, r) = lint(&[
        ("src/features/a/index.ts", "export const a = 1;\n"),
        (
            "src/features/a/m1.ts",
            "\nimport { v2 } from './m2';\nexport const v1 = 1;\n",
        ),
        (
            "src/features/a/m2.ts",
            "import { v1 } from './m1';\nexport const v2 = 2;\n",
        ),
    ]);
    assert_eq!(codes(&r), ["noImportCycle"]);
    let v = &r.violations[0];
    // Files are sorted, so m1 is visited first and the cycle starts at m1 (its import is on line 2).
    let cycle: Vec<String> = v.cycle.iter().map(|p| rel(&c, p)).collect();
    assert_eq!(
        cycle,
        [
            "src/features/a/m1.ts",
            "src/features/a/m2.ts",
            "src/features/a/m1.ts"
        ]
    );
    assert_eq!((v.line, v.col), (2, 1));
    assert_eq!(r.scc.unwrap().cyclic_sccs, 1);
    let out = report::format_violation(v, &c.root_dir);
    assert_eq!(
        out,
        "src/features/a/m1.ts:2:1 ERROR noImportCycle\n  Import cycle detected:\n    ./src/features/a/m1.ts ->\n    ./src/features/a/m2.ts ->\n    ./src/features/a/m1.ts ->"
    );
}

#[test]
fn tsconfig_alias_resolves_to_local_file_and_externals_are_dropped() {
    let (_d, c, r) = lint(&[
        ("src/util/helpers.ts", "export const h = 1;\n"),
        (
            "src/main.ts",
            "import { h } from '@/util/helpers';\nimport fs from 'node:fs';\nimport x from 'some-npm-pkg';\n",
        ),
    ]);
    assert_eq!(r.import_count, 3);
    assert_eq!(r.edge_count, 1);
    let e = &r.graph.edges[0];
    assert_eq!(rel(&c, &r.graph.nodes[e.from as usize].path), "src/main.ts");
    assert_eq!(
        rel(&c, &r.graph.nodes[e.to as usize].path),
        "src/util/helpers.ts"
    );
}

#[test]
fn type_only_imports_are_edges_and_flagged_as_metadata() {
    let (_d, _c, r) = lint(&[
        ("src/features/b/index.ts", "export type B = 1;\n"),
        ("src/features/b/types.ts", "export type T = 1;\n"),
        (
            "src/features/a/use.ts",
            "import type { T } from '@/features/b/types';\nimport { type B } from '@/features/b';\n",
        ),
    ]);
    assert_eq!(r.edge_count, 2);
    // `import type {..}` is counted, and so is its deep-import violation.
    assert_eq!(codes(&r), ["noCrossFeatureDeepImport"]);
    let kinds: Vec<bool> = r
        .graph
        .edges
        .iter()
        .map(|e| e.import.is_type_only)
        .collect();
    assert_eq!(kinds, [true, true]); // `{ type B }`: every entry is type-only
}

#[test]
fn colliding_foo_ts_and_foo_tsx_stay_separate_nodes() {
    let (_d, _c, r) = lint(&[
        (
            "src/Foo.ts",
            "import { x } from './Foo.tsx';\nexport const y = 1;\n",
        ),
        ("src/Foo.tsx", "export const x = 1;\n"),
    ]);
    assert_eq!(r.file_count, 2);
    assert_eq!(r.graph.nodes.len(), 2);
    assert!(
        r.graph.nodes.iter().all(|n| n.key == n.path),
        "keys keep extension"
    );
    assert_eq!(r.edge_count, 1);
    // Merging them into one node would create a bogus self-cycle.
    assert!(r.violations.is_empty());
}

#[test]
fn reexports_side_effects_and_columns() {
    // `export {} from` has no entries -> not an import (Node parity); side-effect import counts;
    // column is counted in UTF-16 code units ('é' = 1 unit, '😀' = 2 units).
    let (_d, _c, r) = lint(&[
        (
            "src/a.ts",
            "export * from './b';\nexport {} from './c';\nimport './d';\n/* é😀 */ import { z } from './e';\n",
        ),
        ("src/b.ts", "export const b = 1;\n"),
        ("src/c.ts", "export const c = 1;\n"),
        ("src/d.ts", "export const d = 1;\n"),
        ("src/e.ts", "export const z = 1;\n"),
    ]);
    let a_edges: Vec<(&str, u32, u32)> = r
        .graph
        .edges
        .iter()
        .map(|e| (e.import.specifier.as_str(), e.import.line, e.import.col))
        .collect();
    // imports first (source order), then re-exports
    assert_eq!(a_edges, [("./d", 3, 1), ("./e", 4, 11), ("./b", 1, 1)]);
}

#[test]
fn dynamic_imports_only_when_enabled_and_rules_can_be_turned_off() {
    let files = [
        ("src/features/a/index.ts", "export const a = 1;\n"),
        ("src/features/b/index.ts", "export const b = 1;\n"),
        ("src/features/b/inner.ts", "export const i = 1;\n"),
        (
            "src/features/a/use.ts",
            "const m = import('@/features/b/inner');\nimport(`./tpl`);\n",
        ),
    ];
    let (_d, c, r) = lint(&files);
    assert_eq!(r.edge_count, 0);
    assert!(r.violations.is_empty());
    assert!(c.rule_possibly_enabled(domainlint_graph::RuleName::ImportCycles));

    let (_d2, mut c2) = project(&files, None);
    c2.include_dynamic_imports = true;
    let r2 = run(&c2, &RunOptions::default()).unwrap();
    assert_eq!(codes(&r2), ["noCrossFeatureDeepImport"]);
    assert!(r2.graph.edges[0].import.is_dynamic);

    // Rule off => skipped entirely.
    let (_d3, mut c3) = project(
        &files,
        Some(
            r#"{ "includeDynamicImports": true, "overrides": { "global": { "rules": { "cross-feature-imports": "off" } } } }"#,
        ),
    );
    assert!(c3.include_dynamic_imports);
    let r3 = run(&c3, &RunOptions::default()).unwrap();
    assert!(r3.violations.is_empty());
    assert!(r3.timings.boundaries_skipped);
    c3.overrides.global = None;
    assert!(
        !run(&c3, &RunOptions::default())
            .unwrap()
            .timings
            .boundaries_skipped
    );
    assert_eq!(Code::NoImportCycle.as_str(), "noImportCycle");
}

/// macOS temp dirs live under `/var -> /private/var`: a root behind a symlink
/// must still resolve relative and `@/*` alias imports to the walked paths.
#[cfg(unix)]
#[test]
fn project_root_behind_a_symlink_keeps_all_edges() {
    let (d, real) = project(
        &[
            ("src/features/a/index.ts", "export const a = 1;\n"),
            ("src/features/b/index.ts", "export const b = 1;\n"),
            ("src/features/b/inner.ts", "export const inner = 1;\n"),
            (
                "src/features/a/use.ts",
                "import { a } from './index';\nimport { inner } from '@/features/b/inner';\n",
            ),
        ],
        None,
    );
    let link_holder = tempfile::tempdir().unwrap();
    let link = link_holder.path().join("link");
    std::os::unix::fs::symlink(d.path(), &link).unwrap();
    let c = Config::load(&link, None, &CliOverrides::default()).unwrap();
    let r = run(&c, &RunOptions::default()).unwrap();
    assert_eq!(r.edge_count, 2);
    assert_eq!(codes(&r), ["noCrossFeatureDeepImport"]);
    assert!(r.violations[0].file.starts_with(link.to_str().unwrap()));
    assert!(
        r.violations[0]
            .resolved_to
            .starts_with(link.to_str().unwrap())
    );
    let _ = real;
}
