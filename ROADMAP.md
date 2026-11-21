# Roadmap

Items ordered by priority. Each section is designed to be handled independently by a dedicated agent.

---

## 1. tsconfig `extends` chain

**Status:** done
**Scope:** `src/tsconfig/tsconfig-loader.ts`

- Pure-TS `extends` resolution is now the primary path (no `tsc` dependency)
- Supports 2-level inheritance, monorepo-style parent-directory extends, array extends (TypeScript 5.0+), and node_modules package extends
- Tests cover: single-level, 2-level chain, monorepo (parent dir), array extends, node_modules extends

---

## 2. Workspace support (npm, pnpm, yarn)

**Status:** done
**Scope:** `src/workspace/`

- Auto-detects workspaces from `pnpm-workspace.yaml` or `package.json` `"workspaces"` field
- Lints each package independently with its own config/tsconfig
- Packages without a `srcDir` are automatically skipped
- Aggregates results with per-package summary output
- Supports npm, pnpm, and yarn (classic and modern) workspace formats

---

## 3. Custom rules support

**Status:** done
**Scope:** `src/rules/rules.ts`, `src/linter/feature-boundaries-linter.ts`

Users can create a `domainlint.rules.ts` (or `.js`) file at the project root that exports custom rules. Each rule receives the full `DependencyGraph` and `FeatureBoundariesConfig` and returns violations.

- Programmatic API: rules implement `Rule` interface (`name` + `check` function)
- Auto-discovered from `domainlint.rules.ts` / `domainlint.rules.js`, or configured via `rulesFile` in `domainlint.json`
- Types exported from `domainlint` package: `Rule`, `RuleContext`, `RuleResult`, `DependencyGraph`
- Violations from custom rules are reported alongside built-in violations
- Documented in `docs/src/content/docs/rules.mdx` and `getting-started.mdx`

---

## 4. Refactor built-in rules to Rule interface

**Status:** done
**Scope:** `src/rules/cycle-detector.ts`, `src/rules/feature-boundary-validator.ts`, `src/linter/feature-boundaries-linter.ts`

Built-in rules are refactored to implement the same `Rule` interface used by user-defined rules. This unifies rule execution through `runRules`.

- Cycle detection rule (`cycleRule`) implements `Rule` with `name` + `check(context)` using `emitViolation`
- Feature boundary validator (`featureBoundaryRule`) implements `Rule`, deriving feature/barrel info from graph and config
- Linter runs both built-in rules through `runRules` alongside user-defined custom rules

---

## 5. Fix line/column positions and file extension resolution

**Status:** done
**Scope:** `src/parser/swc-parser.ts`, `src/graph/graph-query.ts`

- SWC parser now correctly computes line/column from byte offsets (previously always reported 1:1)
- Handles SWC's cumulative 1-based byte positions across parseSync calls
- GraphQuery API now returns original file paths with extensions via `normalizedToOriginalPath`
- Custom rules using `query.edgesFrom(...).violations(...)`, `filesMatching()`, `importsOf()`, and `importersOf()` now get paths with real filesystem extensions

---

## 6. Switch to oxc parser and resolver

**Status:** done
**Scope:** `src/parser/oxc-parser.ts`, `src/resolution/module-resolver.ts`

- Replaced SWC (`@swc/core`) with `oxc-parser` for import extraction
  - Uses `module.staticImports` / `module.staticExports` / `module.dynamicImports` directly — no AST walking needed
  - Simpler line/column computation (0-based offsets, no cumulative byte correction)
- Replaced custom `ModuleResolver` with `oxc-resolver` (Rust-native module resolution)
  - Built-in tsconfig paths, extensions, barrel files, and Node builtin detection
  - Eliminates manual file-exists probing and custom caching
- Integration and unit tests converted from memfs to real temp directories (required because oxc-resolver accesses the filesystem from Rust, bypassing Node's fs module)

---

## 7. Monorepo workspace rules

**Status:** done
**Scope:** `src/rules/workspace-rules.ts`, `src/rules/package-import-deny-rule.ts`, `src/rules/package-cycle-detector.ts`, `src/workspace/workspace-runner.ts`

Workspace-level rules follow the same `Rule` interface pattern as module-level rules. Two built-in rules are provided, and users can add custom workspace rules.

### Built-in workspace rules

- **Package import deny** (`noPackageImport`): Configure `packageRules` in workspace root `domainlint.json` to restrict cross-package imports using glob patterns
- **Package cycle detection** (`noPackageCycle`): Automatically detects circular dependencies between workspace packages

### Custom workspace rules

Users can export `workspaceRules: WorkspaceRule[]` from `domainlint.rules.ts` (or a file configured via `packageRulesFile`). Each rule receives `WorkspaceRuleContext` with cross-package import edges, package info, and `emitViolation`.

### Architecture

- `WorkspaceRule` interface mirrors the module-level `Rule` interface (`name` + `check(context)`)
- `buildPackageImportEdges()` builds a cross-package import graph from parsed file imports
- `runWorkspaceRules()` executes all rules (built-in + custom) against the workspace graph
- Package matching uses trailing separators to avoid path prefix collisions

---

## 8. TanStack Intent skills

**Status:** done (initial scaffold) — 5 skills generated, validated, and wired into the `domainlint` package.
**Scope:** `_artifacts/`, `packages/domainlint/skills/`, `packages/domainlint/package.json`, `packages/domainlint/README.md`

Scaffolding AI-agent skills via `npx @tanstack/intent@latest scaffold`. Skill set (5 skills, lightweight path):

- `adopt-on-existing-codebase` (lifecycle) — first-run triage, Day-1 violations, per-feature overrides
- `configure` (core) — `domainlint.json` schema, severities, overrides
- `write-custom-rule` (core) — `Rule` interface + full `GraphQuery` API; reference files for the 11-method API surface and a DDD rule cookbook
- `use-in-monorepo` (framework) — workspace detection, `packageRules`, `WorkspaceRule`
- `debug-a-violation` (core) — `domainlint debug`, `--shortest-cycles`, `--feature`

### Review checklist for `_artifacts/domain_map.yaml`

Verify before approving Step 2:

- **Failure modes are accurate.** Especially `configure` #1 (`noImportCycle` vs `import-cycles` key mismatch) and `configure` #4 (`no-external-feature-imports` defaults to `off`) — these are claims about current behavior that will be embedded into every generated skill.
- **GraphQuery method list is complete and current.** 11 methods listed in `write-custom-rule` reference candidate. If `src/graph/graph-query.ts` adds/removes methods, the failure-mode example using `dependsOn` / `importsOf` may rot.
- **Override resolution order** in `configure` matches actual code (feature → global → default).
- **Workspace detection sources** in `use-in-monorepo` failure mode #4 (Bun/Nx not supported) still hold — confirm against `src/workspace/`.
- **Severity defaults** in the `configure` skill match the Zod schema (currently: `import-cycles` and `cross-feature-imports` default to `error`, `no-external-feature-imports` defaults to `off`).
- **Cross-references and tensions** are useful (not just decoration) — agents loading one skill genuinely benefit from awareness of the other.

### Open gap

6-month-veteran implicit knowledge — currently empty. Library is young (v0.7.0) with no long-tail production user base. Revisit after broader adoption: performance gotchas at scale, override patterns that age badly, large-codebase anti-patterns.

### What landed

- 5 SKILL.md files in `packages/domainlint/skills/<slug>/` (flat structure, no router, no core overview).
- 3 reference files: `configure/references/config-schema.md`, `write-custom-rule/references/graphquery-api.md`, `write-custom-rule/references/ddd-rule-cookbook.md`.
- `_artifacts/domain_map.yaml`, `_artifacts/skill_spec.md`, `_artifacts/skill_tree.yaml` at the repo root.
- `packages/domainlint/package.json` wired: `@tanstack/intent` in devDependencies, `tanstack-intent` in keywords, `skills` in the `files` array (skills ship via npm).
- 5 GitHub labels created: `skill:<slug>` for each skill.
- README note pointing AI-agent users at `npx @tanstack/intent@latest install`.
- All 5 skills pass `pnpx @tanstack/intent validate`.

### Follow-up tasks

- **Regenerate on release.** When the library cuts a new minor/major, run `pnpx @tanstack/intent edit-package-json` again (idempotent) and re-run the staleness check / Workflow B in `tree-generator/SKILL.md` to update skills against the changelog. Bump `library_version` in each skill's frontmatter.
- **Watch for GraphQuery API drift.** `write-custom-rule/references/graphquery-api.md` lists 12 methods by name. If `packages/domainlint/src/graph/graph-query.ts` adds, removes, or renames a method, regenerate that reference file and the matching failure-mode example in the SKILL.
- **Revisit the open gap.** `_artifacts/domain_map.yaml` flags one unresolved gap: 6-month-veteran implicit knowledge (performance gotchas at scale, override patterns that age badly). Recapture once the library has more production users.

---

## 9. Documentation site revamp + reproducible benchmarks

**Status:** done
**Scope:** `docs/src/content/docs/index.mdx`, `docs/src/content/docs/getting-started.mdx`, `docs/src/components/`, `docs/src/styles/custom.css`, `benchmarks/`

- New landing page: animated terminal, problem statement, animated boundary/cycle diagram, benchmark chart, comparison table with dependency-cruiser / madge / ESLint plugins (including when to pick those instead), feature grid, copyable CTA
- Getting started rewritten as 5 steps: layout (file tree), zero-install run (animated terminal), fix a deep import (animated before/after), fix a cycle, install + CI. Plus an "adopting on an existing codebase" section
- All animations respect `prefers-reduced-motion`; no new docs dependencies
- `benchmarks/`: deterministic fixture generator (`generate.mjs`) and runner (`run.mjs`) comparing domainlint, madge, dependency-cruiser and `eslint-plugin-import-x` at pinned versions. Fixtures and tools are generated into gitignored folders

### Benchmark findings (10,100 files, 4 vCPU, Node 22, median of 5)

| Scenario | domainlint | oxlint | dependency-cruiser | madge | ESLint |
|---|---|---|---|---|---|
| cycles | 3.81s | 0.24s | 6.91s | 7.58s | 13.38s |
| boundaries | 3.99s | 2.97s (eslint-plugin-boundaries via jsPlugins) | 6.89s | n/a | 12.42s |
| full | 3.69s | 3.48s | 7.01s | n/a | 16.31s |

oxlint is the fastest in every scenario. domainlint's measured speed edge is over dependency-cruiser (~2×) and ESLint (~4×), not over oxlint. On ~500 files every tool takes about 1s.

### Follow-up tasks

- **Close the gap with oxlint (highest-leverage perf work).** oxlint's no-cycle parses and resolves the same 10k files in 0.24s; domainlint takes ~3.8s. Turning a rule `off` doesn't skip its computation either: the boundaries-only run is no faster than the full one.
  - **Status: spike done (Rust native core), decision pending.** Branch `claude/rust-graph-spike`. See "Native graph spike" below.

### Native graph spike (Rust)

**Scope:** `crates/domainlint-graph/` (lib + `domainlint-rs` CLI), `crates/domainlint-graph-napi/` (napi-rs addon + `bench.mjs`), `benchmarks/run.mjs` (`domainlint-rs` tool). Self-contained: the published package and docs are unchanged.

Rust 1.97, `oxc_parser` 0.158 (module record, no AST walk), `oxc_resolver` 11.24, `rayon`, `ignore`. Imports come from the module record; parsing and resolution run in parallel with one shared `Resolver`. Cycle reporting ports the Node DFS exactly (it is not Tarjan); an iterative Tarjan SCC runs as a cross-check (`--scc`). Rules set to `off` are skipped, not computed and then filtered.

**Parity** (`node crates/domainlint-graph/scripts/parity.mjs <fixture>...`): on 20x25 and 100x100, with no config, cycles-only and boundaries-only configs, the violation sets (header and body) and the summary line are identical: 463 `noCrossFeatureDeepImport` + 12 `noImportCycle` at 100x100, 18 + 5 at 20x25. The only differences: Node's `glob` returns files in a different order from run to run, so which file a cycle is reported from (m1 or m2) and the order of the list vary between Node runs. The prototype uses a fixed order; the script also compares cycles by member set. 9 Rust integration tests cover: deep import, barrel import, same-feature import, 2-file cycle, `@/*` alias, type-only import, Foo.ts/Foo.tsx collision, UTF-16 columns.

**Benchmark** (4 vCPU, Node 22, median of 5, wall clock incl. process start; findings in parentheses):

| Scenario | domainlint (Node) | domainlint-rs | oxlint | dependency-cruiser |
|---|---|---|---|---|
| cycles, 10,100 files | 3.48s (12) | **0.05s** (12) | 0.25s (22) | 5.71s (12) |
| boundaries, 10,100 | 3.54s (463)¹ | **0.05s** (463) | 2.43s (458) | 5.77s (459) |
| full, 10,100 | 3.46s (475) | **0.06s** (475) | 2.79s (480) | 5.81s (471) |
| cycles, 20,200 | crash² | **0.09s** (23) | 0.44s (42) | 18.59s (23) |
| boundaries, 20,200 | crash² | **0.10s** (932) | 3.86s (921) | 18.08s (923) |
| full, 20,200 | crash² | **0.09s** (955) | 3.99s (963) | 18.71s (946) |

¹ The run recorded 424; six reruns (to a file, to a pipe, and with `spawnSync` like `run.mjs`) all give 463. Treat the 424 as a one-off flake.
² **Node CLI crashes at 20k files:** `EMFILE: too many open files`. `Promise.all` over every `parseFile` opens all files at once, and the hard `ulimit -n` here is 20000. This is a real bug, separate from the spike.

**Time breakdown, `--timings`, 10,100 files, warm cache** (4 threads / 1 thread): walk 9 / 8 ms, read+parse 13 / 35 ms, resolve 10 / 12 ms, graph build 7 / 7 ms, cycles 1 / 1 ms, boundaries 3 / 3 ms, total **~42 / ~67 ms**. Cold-cache first run: ~200 ms. At 20,200 files the process takes 100 ms with 4 threads and 178 ms with `RAYON_NUM_THREADS=1`. So the speed-up is **~70× even single-threaded**: it comes from avoiding per-file async I/O and JS path work, not from threads. Resolve, walk and graph build barely parallelise; walk and graph build are sequential, and resolve barely gains from threads. The Node tsconfig loader also shells out to `npx tsc --showConfig` first (`src/tsconfig/tsconfig-loader.ts`), and that result isn't used for resolution.

**napi boundary cost** (`node crates/domainlint-graph-napi/bench.mjs`, in-process, median of 7). Boundary = call wall time − Rust-side total:

| Variant | 10,100 files / 17k edges | 20,200 files / 34k edges |
|---|---|---|
| typed arrays (`Uint32Array` from/to/line/col + specifier strings) | +7.7 ms | +~20 ms |
| one JS object per edge | +17 ms | +36 ms |
| JSON string + `JSON.parse` | +55 ms | +110 ms |

Rebuilding the JS `DependencyGraph` (Sets/Maps) from typed arrays takes another ~7 ms. A real `GraphQuery` from `dist/` runs on the rebuilt graph: the smoke queries `filesMatching`, `edgesBetween`, `fanIn`, `dependsOn` and others give consistent results. So **Rust graph + JS custom rules ≈ 60 ms at 10k files** vs 3.5s today. `GraphQuery` itself (minimatch over all nodes, lazy reverse adjacency) then costs ~200 ms for a handful of queries, so it is the next hotspot for rule-heavy users. Addon: 3.7 MB `.so`, ~1 ms to load.

**Not ported:** workspace mode and the workspace rules, the per-feature summary and cycle analysis output, `--feature` / `--shortest-cycles`, `debug`, JSONC trailing commas. Default extensions follow the Node source (`.ts`, `.tsx`, `.d.ts`).

**Recommendation: hybrid.** Ship a native core through napi that does discovery, parsing, resolution, the graph and the built-in rules. Keep the CLI, config, reporter, workspace orchestration and the custom `Rule` / `GraphQuery` API in JS, and pass the graph across as typed arrays. Reasons:
- The win is ~60× and holds single-threaded.
- The boundary cost (~8 ms + ~7 ms rebuild) is noise next to it.
- The custom-rules API, the main differentiator from oxlint, keeps working unchanged.

Contrarian check:
- *Keep pure JS and fix the I/O first.* Sync batched reads, a bounded worker pool and dropping the `tsc` shell-out would fix the EMFILE crash and plausibly bring the run to ~1s at a fraction of the cost. Worth doing anyway as a fallback path, but it won't reach ~50 ms.
- *Full Rust CLI.* Needs a JS runtime for custom rules, so the work ends up in the hybrid anyway.

**Packaging cost** of the hybrid (napi-rs standard pattern):
- One npm package per target with `os`/`cpu`/`libc` fields, as `optionalDependencies` of `domainlint`. Typical targets: linux-x64-gnu, linux-x64-musl, linux-arm64-gnu, linux-arm64-musl, darwin-x64, darwin-arm64, win32-x64-msvc, plus optionally win32-arm64. That's 7–8 binaries of ~3–4 MB each.
- A GitHub Actions matrix (cross-compiles via `zig`/`cross` or native runners) on release tags. Roughly 10–15 min of CI per release, plus `@napi-rs/cli` for build/artifacts/publish.
- Keep a pure-JS fallback (the current pipeline, with the I/O fixes) for unsupported platforms or `DOMAINLINT_NATIVE=0`, and run the parity script in CI against both paths.
- Adds Rust to the contributor toolchain and an oxc version to track. The Rust crates and the JS `oxc-parser` share a versioning cadence, so pin them together.

**Next steps if accepted:**
1. Fix the Node EMFILE crash and the exit code bug independently.
2. Make file discovery order deterministic (sort) in Node so cycle start files are stable.
3. Productionise `crates/` as a Cargo workspace plus `@napi-rs/cli` packaging.
4. Port workspace mode.
5. Move `GraphQuery`'s glob matching to precompiled matchers.
- **I/O is the bottleneck, not parsing.** A CPU profile shows oxc parsing takes ~280ms of a ~4.4s run; most time is per-file `fs/promises` open/read/close, `path.relative`/`normalize`, and idle waits. Batched/sync reads or a worker pool could plausibly cut total time substantially. Re-run `node benchmarks/run.mjs` and update `docs/src/components/BenchmarkChart.astro` after any perf change.
- **`check` exits 2 instead of 1 on violations.** `this.exit(1)` inside the `try` in `src/commands/check.ts` is caught and rethrown as "Internal error: EEXIT: 1". Docs describe the intended contract (1 = violations).

---

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
