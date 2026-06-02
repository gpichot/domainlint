---
name: debug-a-violation
description: >
  Diagnose why a specific file is being flagged, shrink noisy cycle
  output, and trace the offending import. Load when investigating a
  single file ("why is this flagged?"), reading an unmanageable cycle
  path, or scoping output during incremental cleanup. Covers
  `domainlint debug <file>` for per-file import + violation dumps,
  `--shortest-cycles` to collapse long strongly-connected components to
  minimum-length cycles, `--max-cycle-length=<n>` (default 50),
  `--feature=<name>` to scope output, `--verbose` for per-package output
  in workspaces, `--no-color` for CI logs, and reading the
  `a -> b -> c -> a` cycle format.
type: core
library: domainlint
library_version: '0.7.0'
sources:
  - 'gpichot/domainlint:docs/src/content/docs/cli.mdx'
  - 'gpichot/domainlint:packages/domainlint/src/commands/check.ts'
  - 'gpichot/domainlint:packages/domainlint/src/commands/debug.ts'
---

# domainlint — Debug a violation

## Setup

Two commands cover the debug workflow:

```sh
# Project-wide check (default)
pnpm exec domainlint check

# Single-file dump: all resolved imports + any violations on that file
pnpm exec domainlint debug src/features/billing/ui/Form.tsx
```

`debug` uses the same resolver and rule pipeline as `check`. It is the
authoritative answer to "what does domainlint think this file imports?"
and "which rules fire on this file?"

## Core Patterns

### Investigate a single flagged file

```sh
pnpm exec domainlint debug src/features/billing/ui/Form.tsx
```

Output shows each resolved import (specifier → resolved path) and any
violations attached to that file. Use this **before** grep-tracing
specifiers by hand — the resolver may behave differently from what the
filesystem suggests (path aliases, extension inference, barrel
redirection).

### Shrink cycle output

A strongly-connected component can produce very long cycle paths.
`--shortest-cycles` reduces each SCC to its minimum-length cycle — the
actually-fixable view:

```sh
pnpm exec domainlint check --shortest-cycles
```

`--max-cycle-length=<n>` (default `50`) drops cycles longer than `n`
from the report entirely. Combine for the cleanest output during early
cleanup:

```sh
pnpm exec domainlint check --shortest-cycles --max-cycle-length=10
```

### Scope output by feature during incremental cleanup

```sh
pnpm exec domainlint check --feature=billing
```

Without this, every CI run after a partial fix re-dumps every violation
across the codebase and progress is invisible.

### Reading the violation format

```
src/pages/home.tsx:5:1 noCrossFeatureDeepImport
  Importing src/features/billing/ui/Button.tsx directly.
  Expected: src/features/billing/index.ts
```

Format: `<file>:<line>:<col> <violation-code> <message>`. The violation
code is **camelCase** (`noCrossFeatureDeepImport`,
`noImportCycle`, `noFeatureImportFromNonDomain`, `noPackageImport`,
`noPackageCycle`). To configure severity for one of these in
`domainlint.json`, look up the corresponding **kebab-case override key**
— see `configure`.

### Reading cycle output

```
src/features/auth/session.ts noImportCycle
  Cycle: auth/session.ts -> auth/user.ts -> auth/session.ts
```

The arrows show import direction: `session.ts` imports `user.ts`,
`user.ts` imports `session.ts`. Fix by extracting shared state into a
third module both can import.

### Workspace verbose mode

In a monorepo, the default check output summarizes per package. Use
`--verbose` to see each violation per package:

```sh
pnpm exec domainlint check --verbose
```

### CI-friendly output

```sh
pnpm exec domainlint check --no-color
```

Disables ANSI codes when the CI log viewer can't render them.

## Common Mistakes

### HIGH Stares at a 50-deep cycle without `--shortest-cycles`

Wrong:

```sh
pnpm exec domainlint check
# noImportCycle: a -> b -> c -> d -> ... -> z -> a (50 steps)
# (agent: "this cycle is too tangled to fix")
```

Correct:

```sh
pnpm exec domainlint check --shortest-cycles
# noImportCycle: a -> b -> a (the actually-fixable minimum)
```

The default output shows a representative cycle for each strongly-
connected component, which can be very long. `--shortest-cycles` reduces
each SCC to its minimum cycle — usually 2–3 edges, fixable in one PR.

Source: `docs/src/content/docs/cli.mdx`; `README.md`

### MEDIUM Reasons about a file in isolation instead of `domainlint debug`

Wrong:

```sh
# Agent reads the file, grep-traces import specifiers by hand,
# tries to reason about path aliases from tsconfig manually.
```

Correct:

```sh
pnpm exec domainlint debug src/features/billing/ui/Form.tsx
```

The debug command uses the same resolver as `check` (oxc-resolver with
tsconfig paths, extension inference, barrel redirection). Hand-tracing
specifiers misses path aliases, `index.ts` resolution, and `extends`
chains in tsconfig. The debug output is the ground truth.

Source: `docs/src/content/docs/cli.mdx`

### MEDIUM Forgets `--feature=<name>` during incremental cleanup

Wrong:

```sh
# After partial fix to billing/:
pnpm exec domainlint check
# Re-dumps every violation; progress is invisible.
```

Correct:

```sh
pnpm exec domainlint check --feature=billing
```

See also: `adopt-on-existing-codebase` § Common Mistakes —
same mistake from the adoption-workflow angle.

Source: `docs/src/content/docs/cli.mdx`

## See also

- `configure` — to translate a CLI violation code
  (camelCase) into the `domainlint.json` override key (kebab-case).
- `adopt-on-existing-codebase` — debug + `--shortest-cycles`
  + `--feature` is the standard toolkit during Day-1 triage.

## Version

Targets domainlint v0.7.0.
