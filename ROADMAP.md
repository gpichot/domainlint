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
**Scope:** `src/rules/custom-rules.ts`, `src/linter/feature-boundaries-linter.ts`

Users can create a `domainlint.rules.ts` (or `.js`) file at the project root that exports custom rules. Each rule receives the full `DependencyGraph` and `FeatureBoundariesConfig` and returns violations.

- Programmatic API: rules implement `CustomRule` interface (`name` + `check` function)
- Auto-discovered from `domainlint.rules.ts` / `domainlint.rules.js`, or configured via `rulesFile` in `domainlint.json`
- Types exported from `domainlint` package: `CustomRule`, `CustomRuleContext`, `CustomRuleResult`, `DependencyGraph`
- Violations from custom rules are reported alongside built-in violations
- Documented in `docs/src/content/docs/rules.mdx` and `getting-started.mdx`

---

## 4. Refactor built-in rules to CustomRule interface

**Status:** in progress
**Scope:** `src/rules/cycle-detector.ts`, `src/linter/feature-boundaries-linter.ts`

Built-in rules are being refactored to implement the same `CustomRule` interface used by user-defined rules. This unifies rule execution through `runCustomRules`.

- Cycle detection rule (`cycleRule`) now implements `CustomRule` with `name` + `check(context)` using `emitViolation`
- Linter runs `cycleRule` through `runCustomRules` alongside user-defined custom rules
- Feature boundary validator is next (not yet migrated)

---

## 5. Fix line/column positions and file extension resolution

**Status:** done
**Scope:** `src/parser/swc-parser.ts`, `src/graph/graph-query.ts`

- SWC parser now correctly computes line/column from byte offsets (previously always reported 1:1)
- Handles SWC's cumulative 1-based byte positions across parseSync calls
- GraphQuery API now returns original file paths with extensions via `normalizedToOriginalPath`
- Custom rules using `query.edgesFrom(...).violations(...)`, `filesMatching()`, `importsOf()`, and `importersOf()` now get paths with real filesystem extensions

---

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
