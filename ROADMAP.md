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

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
