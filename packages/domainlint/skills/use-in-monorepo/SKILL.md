---
name: use-in-monorepo
description: >
  Run domainlint across npm, pnpm, or yarn workspaces, configure
  cross-package import restrictions via `packageRules`, and write
  workspace-level custom rules using the `WorkspaceRule` interface. Load
  when working at a monorepo workspace root, restricting which packages
  may import which, writing cross-package rules, or debugging "my package
  is silently skipped." Covers workspace detection sources
  (`pnpm-workspace.yaml` then `package.json` `workspaces`), per-package
  configs, the silent-skip rule for packages without `srcDir`, built-in
  workspace rules (`noPackageImport`, `noPackageCycle`), the
  `WorkspaceRuleContext` shape (`packages`, `edges`, `packageRules`,
  `emitViolation`), `PackageImportEdge` fields, and `packageRulesFile`.
type: core
library: domainlint
library_version: '0.7.0'
sources:
  - 'gpichot/domainlint:docs/src/content/docs/workspaces.mdx'
  - 'gpichot/domainlint:packages/domainlint/src/workspace/'
  - 'gpichot/domainlint:packages/domainlint/src/rules/workspace-rules.ts'
---

# domainlint — Use in a monorepo

## Setup

Run from the workspace root. domainlint auto-detects workspaces from
(in order):

1. `pnpm-workspace.yaml` — `packages:` field
2. `package.json` `"workspaces"` field (npm + yarn classic / modern)

```sh
pnpm exec domainlint check
```

Each package is linted independently with its own `domainlint.json` and
`tsconfig.json` (falling back to defaults). Packages whose `srcDir` does
not exist are **silently skipped**.

Output is per-package:

```
Workspace (pnpm)

  ✓ @my/core (packages/core) 42 files, 150ms
  ✗ @my/ui (packages/ui) 28 files, 90ms
    3 violations
  - @my/docs (docs) — skipped: No src/features directory found

Analyzed 70 files across 2 packages in 240ms
✗ 3 total violations found
```

Use `--verbose` to see each violation per package.

## Core Patterns

### Restrict cross-package imports via `packageRules`

In the **workspace-root** `domainlint.json`:

```json
{
  "packageRules": [
    {
      "from": "packages/core",
      "deny": ["packages/feature-*"]
    },
    {
      "from": "packages/shared",
      "deny": ["packages/feature-*", "packages/app"]
    }
  ]
}
```

Both `from` and `deny` are **glob patterns over package paths**,
relative to the workspace root. Not npm package names.

Violations report as `noPackageImport`:

```
packages/core/src/service.ts:5:1 noPackageImport
  Package "packages/core" is not allowed to import from "packages/feature-auth"
```

### Built-in package cycle detection

Cycles between workspace packages are detected automatically. No config
required.

```
packages/core/src/service.ts:3:1 noPackageCycle
  Package cycle detected: packages/core -> packages/auth -> packages/core
```

### Custom workspace rule

Export `workspaceRules` from the **workspace-root** `domainlint.rules.ts`:

```ts
import type { WorkspaceRule } from 'domainlint';

export const workspaceRules: WorkspaceRule[] = [
  {
    name: 'no-app-to-internal-lib',
    check({ edges, emitViolation }) {
      for (const edge of edges) {
        if (
          edge.fromPackage.startsWith('apps/') &&
          edge.toPackage.startsWith('libs/internal')
        ) {
          emitViolation({
            file: edge.file,
            line: edge.line,
            col: edge.col,
            message: `App "${edge.fromPackage}" cannot import internal lib "${edge.toPackage}"`,
          });
        }
      }
    },
  },
];
```

A workspace `domainlint.rules.ts` may also export module-level `rules`
alongside `workspaceRules`. Custom workspace rules can be loaded from a
non-default path via `packageRulesFile` in `domainlint.json`.

### `WorkspaceRule` context shape

```ts
interface WorkspaceRule {
  name: string;
  check(context: WorkspaceRuleContext): void | Promise<void>;
}

interface WorkspaceRuleContext {
  packages: WorkspacePackageInfo[];     // all detected packages
  edges: PackageImportEdge[];           // cross-package import edges
  packageRules: PackageImportRestriction[]; // resolved deny rules from config
  emitViolation: (result: WorkspaceRuleResult) => void;
}

interface PackageImportEdge {
  fromPackage: string;  // path relative to workspace root
  toPackage: string;    // path relative to workspace root
  file: string;         // absolute path of the importing file
  specifier: string;    // raw import specifier
  line: number;         // 1-based
  col: number;          // 1-based
}

interface WorkspacePackageInfo {
  name: string;         // package.json `name`
  path: string;         // absolute path
  relPath: string;      // path relative to workspace root
}
```

**No `query` / `graph` / `config` here** — those belong to module-level
`Rule`. Workspace rules operate over a precomputed cross-package edge
list.

## Common Mistakes

### CRITICAL Defines `packageRules` / `workspaceRules` inside a package, not the workspace root

Wrong:

```json
// packages/core/domainlint.json
{
  "packageRules": [
    { "from": "packages/core", "deny": ["packages/feature-*"] }
  ]
}
```

Correct:

```json
// ./domainlint.json (workspace root)
{
  "packageRules": [
    { "from": "packages/core", "deny": ["packages/feature-*"] }
  ]
}
```

Workspace-level config lives at the workspace root. A `packageRules`
block inside a package config is silently ignored — there's no error,
but no rule is loaded. Same for `workspaceRules` exported from a
per-package `domainlint.rules.ts`.

Source: `docs/src/content/docs/workspaces.mdx`

### HIGH Uses npm package name for `packageRules.from` / `deny`

Wrong:

```json
{
  "packageRules": [
    { "from": "@my/core", "deny": ["@my/feature-*"] }
  ]
}
```

Correct:

```json
{
  "packageRules": [
    { "from": "packages/core", "deny": ["packages/feature-*"] }
  ]
}
```

`from` and `deny` are glob patterns against **package paths** relative
to the workspace root (e.g. `packages/core`, `apps/web`), not npm
package names. The error mode is silent: rules never match any package
and no violations are emitted, giving false confidence that the policy
is enforced.

Source: `docs/src/content/docs/workspaces.mdx`

### MEDIUM Adds a package without `src/` and expects it to be linted

Wrong:

```
packages/docs/
  content/
  astro.config.mjs
  # no src/ directory
```

Agent assumption: "domainlint is linting all packages, including docs."

Correct:

```json
// packages/docs/domainlint.json — point srcDir at the actual source root
{
  "srcDir": "content"
}
```

Or accept the skip — packages whose `srcDir` doesn't exist are reported
as `skipped: No src/features directory found` and excluded from the
analysis. The skip is intentional but easy to miss in CI logs.

Source: `docs/src/content/docs/workspaces.mdx`

### MEDIUM Assumes Bun workspaces or Nx project graphs are auto-detected

Wrong:

```toml
# bunfig.toml only — no pnpm-workspace.yaml, no "workspaces" in package.json
[workspaces]
packages = ["packages/*"]
```

Correct:

```json
// package.json
{
  "workspaces": ["packages/*"]
}
```

Detection sources are exactly: `pnpm-workspace.yaml`, then
`package.json` `"workspaces"`. Bun-only workspace declarations and Nx
`project.json` files are not detected. domainlint will fall back to
single-project mode and only analyze the root.

Source: `docs/src/content/docs/workspaces.mdx`

### HIGH Confuses module-level `Rule` with workspace-level `WorkspaceRule`

Wrong:

```ts
// workspace-root/domainlint.rules.ts
import type { WorkspaceRule } from 'domainlint';

export const workspaceRules: WorkspaceRule[] = [{
  name: 'no-app-to-lib',
  check({ query, emitViolation }) {                       // ❌ no `query`
    for (const edge of query.edgesFrom('apps/**').edges) {
      // ...
    }
  },
}];
```

Correct:

```ts
export const workspaceRules: WorkspaceRule[] = [{
  name: 'no-app-to-lib',
  check({ edges, emitViolation }) {
    for (const edge of edges) {
      if (edge.fromPackage.startsWith('apps/') &&
          edge.toPackage.startsWith('libs/internal')) {
        emitViolation({
          file: edge.file,
          line: edge.line,
          col: edge.col,
          message: `App "${edge.fromPackage}" cannot import "${edge.toPackage}"`,
        });
      }
    }
  },
}];
```

Workspace context has `edges` (precomputed cross-package edges), not
`query`. The two interfaces mirror each other (`name` + `check`) but
diverge in context.

Source: `packages/domainlint/src/rules/workspace-rules.ts:35-57`

### HIGH Tension: Module-level `Rule` vs workspace-level `WorkspaceRule`

Same `name` + `check` shape, different context. The most common
manifestation: a workspace-root rules file exports `rules` (a
module-level array) when the intent was a workspace rule, or vice
versa. Always check:

- Module-level: exported as `rules`, context = `{ graph, query, config, emitViolation }`
- Workspace-level: exported as `workspaceRules`, context = `{ packages, edges, packageRules, emitViolation }`

See also: `write-custom-rule` § Common Mistakes.

## See also

- `configure` — `packageRules` and `packageRulesFile` belong
  in the workspace-root `domainlint.json` next to all the other config
  fields.
- `write-custom-rule` — for the module-level `Rule`
  interface and the full `GraphQuery` API.

## Version

Targets domainlint v0.7.0.
