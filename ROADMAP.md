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

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
