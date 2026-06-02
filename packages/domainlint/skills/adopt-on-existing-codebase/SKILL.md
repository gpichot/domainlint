---
name: adopt-on-existing-codebase
description: >
  Run domainlint for the first time on an existing TypeScript or JavaScript
  project, triage the Day-1 wave of violations, and decide what to fix,
  warn, or disable per feature. Load when adopting domainlint, integrating
  it into CI for the first time, getting hundreds of violations on initial
  run, scoping the linter to a single feature, or quarantining a legacy
  feature. Covers `domainlint check`, `--feature=<name>`, severity
  selection (`error` / `warn` / `off`), `overrides.features` blocks for
  legacy code, the install-before-lint requirement for tsconfig path
  resolution, and choosing between `exclude` and per-feature overrides.
type: lifecycle
library: domainlint
library_version: '0.7.0'
sources:
  - 'gpichot/domainlint:docs/src/content/docs/getting-started.mdx'
  - 'gpichot/domainlint:docs/src/content/docs/ci.mdx'
  - 'gpichot/domainlint:docs/src/content/docs/configuration.mdx'
  - 'gpichot/domainlint:docs/src/content/docs/cli.mdx'
---

# domainlint — Adopt on an existing codebase

## Setup

Install as a dev dependency and run from the project root:

```sh
pnpm add -D domainlint
pnpm exec domainlint check
```

domainlint reads `tsconfig.json` to resolve path aliases. Dependencies must
be installed first — otherwise alias-driven specifiers fail to resolve and
are silently treated as external (no edge in the graph, no violation, no
warning).

Default layout assumed:

```
src/
  features/
    auth/
      index.ts          ← barrel (public API)
      session.ts
    billing/
      index.ts
      ui/Button.tsx
  pages/home.tsx
```

A "feature" is any direct child directory of `featuresDir` (default
`src/features`). Each feature's `index.ts` is its barrel. If the project
uses a different layout, configure `srcDir` and `featuresDir` before the
first run — see `configure`.

## Core Patterns

### Triage by feature

When the first run reports 200+ violations, scope to one feature at a time:

```sh
pnpm exec domainlint check --feature=billing
```

Fix violations feature-by-feature instead of touching every file at once.

### Shrink cycle output during cleanup

Long strongly-connected components produce unreadable cycle paths. Collapse
to minimum-length cycles, the actually-fixable view:

```sh
pnpm exec domainlint check --shortest-cycles --max-cycle-length=10
```

### Quarantine a legacy feature

Keep the rest of the codebase strict; downgrade a single feature to `warn`
or `off` in `domainlint.json`:

```json
{
  "overrides": {
    "global": {
      "rules": {
        "import-cycles": "error",
        "cross-feature-imports": "error"
      }
    },
    "features": {
      "legacy-billing": {
        "rules": {
          "import-cycles": "off",
          "cross-feature-imports": "warn"
        }
      }
    }
  }
}
```

Resolution order is **feature → global → default** — a feature override
wins over the global override, which wins over the built-in default.

### Add to CI without breaking the build on Day 1

Install dependencies first; otherwise tsconfig paths fail silently:

```yaml
# .github/workflows/ci.yml
- run: pnpm install --frozen-lockfile
- run: pnpm exec domainlint check
```

Exit codes: `0` (clean), `1` (violations), `2` (internal error — e.g.
unreadable tsconfig or invalid `domainlint.json`).

## Common Mistakes

### CRITICAL Treats every Day-1 violation as urgent

Wrong:

```sh
# Agent sees 200 errors and starts editing files at random.
pnpm exec domainlint check
# → noCrossFeatureDeepImport × 84
# → noImportCycle × 119
# (agent: "Let me fix these one by one...")
```

Correct:

```sh
# Triage: scope by feature, downgrade legacy, fix the rest.
pnpm exec domainlint check --feature=billing
```

```json
{
  "overrides": {
    "global": { "rules": { "cross-feature-imports": "error" } },
    "features": {
      "legacy-billing": { "rules": { "cross-feature-imports": "warn" } }
    }
  }
}
```

A blanket fix attempt produces a noisy, hard-to-review diff and usually
introduces more bugs than it removes. Quarantine known-broken features
first, then clean them up under their own PRs.

Source: maintainer interview; `docs/src/content/docs/configuration.mdx`

### HIGH Runs domainlint before installing dependencies

Wrong:

```yaml
- uses: actions/checkout@v4
- run: npx domainlint check
```

Correct:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npm ci
- run: npx domainlint check
```

`tsconfig.json` `compilerOptions.paths` resolves against installed
packages (oxc-resolver hits the real filesystem). Without `node_modules`,
alias-driven specifiers fail to resolve and are silently treated as
external — no edge in the graph, no violation reported, false confidence.

Source: `docs/src/content/docs/ci.mdx`

### HIGH Project layout does not match defaults — assumes "no violations" means clean

Wrong:

```sh
# Project actually uses app/modules/ — no domainlint.json present.
pnpm exec domainlint check
# → ✓ 0 violations
# (agent declares done; features are not even detected)
```

Correct:

```json
// domainlint.json
{
  "srcDir": "app",
  "featuresDir": "app/modules"
}
```

Default `featuresDir` is `src/features`. If the project uses any other
layout, no features are detected and only cycle checks meaningfully run.
A clean exit on the first run is suspicious — always verify the config
matches the project before trusting the result.

Source: `docs/src/content/docs/feature-structure.mdx`,
`docs/src/content/docs/configuration.mdx`

### MEDIUM Excludes a noisy file via `exclude` instead of an override

Wrong:

```json
{
  "exclude": ["src/features/legacy/**"]
}
```

Correct:

```json
{
  "overrides": {
    "features": {
      "legacy": {
        "rules": {
          "cross-feature-imports": "off",
          "import-cycles": "off"
        }
      }
    }
  }
}
```

`exclude` removes the file from analysis entirely — it no longer
contributes to cycle detection from the importer side, and it cannot
serve as a target of valid cross-feature imports. The override is the
right tool when "this feature is exempt from one or more rules" but the
graph should still see it.

Source: `docs/src/content/docs/configuration.mdx`

### MEDIUM Forgets `--feature=<name>` during incremental cleanup

Wrong:

```sh
# After partial fix:
pnpm exec domainlint check
# → Re-dumps every violation across the codebase; progress is invisible.
```

Correct:

```sh
pnpm exec domainlint check --feature=billing
```

Source: `docs/src/content/docs/cli.mdx`

### HIGH Tension: Adoption ease vs architectural strictness

Globally downgrading every rule to `warn` makes domainlint pass on Day 1
but lets the same architecture continue to rot — the linter never blocks
a bad PR. The right move is **per-feature scoping**: keep `error`
globally, downgrade `warn`/`off` only inside `overrides.features` for the
contained legacy area.

See also: `configure` § Common Mistakes — override key naming
and resolution order.

## See also

- `configure` — full `domainlint.json` schema, rule keys, and
  override resolution. Adoption work routes into the configuration
  surface.
- `debug-a-violation` — `domainlint debug <file>` and
  `--shortest-cycles` make individual violations tractable during
  cleanup.

## Version

Targets domainlint v0.7.0.
