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

## 4. Refactor feature boundaries rule to use custom rules system

**Status:** done
**Scope:** `src/rules/feature-boundary-rule.ts`, `src/graph/graph-query.ts`, `src/linter/feature-boundaries-linter.ts`

- The feature boundaries rule (R2) now implements the `CustomRule` interface, using the same `check(context)` + `emitViolation` pattern as user-defined custom rules
- `GraphQuery` enriched with file info: `fileInfo()`, `isBarrel()`, `barrelPathFor()`, `originalPath()` methods
- Built-in and custom rules are collected into a single array and run through `runCustomRules()`
- Old `validateFeatureBoundaries()` function removed in favor of `featureBoundaryRule` object

---

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
