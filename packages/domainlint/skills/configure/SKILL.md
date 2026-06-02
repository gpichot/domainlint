---
name: configure
description: >
  Author and edit `domainlint.json` to match the project layout, set rule
  severities, and apply per-feature overrides. Load when shaping the static
  config surface — fields like `srcDir`, `featuresDir`, `barrelFiles`,
  `extensions`, `tsconfigPath`, `exclude`, `includeDynamicImports`,
  `overrides`. Covers severity keys (`import-cycles`,
  `cross-feature-imports`, `no-external-feature-imports`), severity values
  (`error` / `warn` / `off`), the global → per-feature override resolution
  order, the rule-key vs violation-code mismatch (`noImportCycle` vs
  `import-cycles`), the Zod validation that gates exit code 2, and the
  default-off behavior of `no-external-feature-imports`.
type: core
library: domainlint
library_version: '0.7.0'
sources:
  - 'gpichot/domainlint:docs/src/content/docs/configuration.mdx'
  - 'gpichot/domainlint:docs/src/content/docs/rules.mdx'
  - 'gpichot/domainlint:docs/src/content/docs/feature-structure.mdx'
  - 'gpichot/domainlint:packages/domainlint/src/config/types.ts'
  - 'gpichot/domainlint:packages/domainlint/src/config/rule-overrides.ts'
---

# domainlint — Configure via domainlint.json

## Setup

Place `domainlint.json` at the project root (next to `package.json`).
All fields are optional — defaults work for a standard `src/features/`
layout.

```json
{
  "rootDir": ".",
  "srcDir": "src",
  "featuresDir": "src/features",
  "barrelFiles": ["index.ts"],
  "extensions": [".ts", ".tsx"],
  "tsconfigPath": "./tsconfig.json",
  "exclude": ["**/node_modules/**", "**/dist/**", "**/.next/**"],
  "includeDynamicImports": false
}
```

Config is validated with Zod at load time; invalid config → exit code 2
before any linting runs.

## Core Patterns

### Map a non-default layout

```json
{
  "srcDir": "app",
  "featuresDir": "app/modules",
  "barrelFiles": ["index.ts", "public.ts"]
}
```

`barrelFiles` lets a feature expose multiple public-API filenames. Any
file matching one of these names at the feature root is treated as a
barrel.

### Set severities globally

The three rule keys and their defaults:

| Override key | Violation code | Default |
| --- | --- | --- |
| `import-cycles` | `noImportCycle` | `error` |
| `cross-feature-imports` | `noCrossFeatureDeepImport` | `error` |
| `no-external-feature-imports` | `noFeatureImportFromNonDomain` | **`off`** |

```json
{
  "overrides": {
    "global": {
      "rules": {
        "import-cycles": "warn",
        "cross-feature-imports": "error",
        "no-external-feature-imports": "error"
      }
    }
  }
}
```

Severity values: `"error"` (causes exit 1), `"warn"` (reports, exit 0),
`"off"` (rule skipped for scope).

### Per-feature overrides

`overrides.features` is keyed by **feature name** (the directory name
directly under `featuresDir`), not by path or glob.

```json
{
  "overrides": {
    "global": {
      "rules": { "cross-feature-imports": "warn" }
    },
    "features": {
      "payments": {
        "rules": { "cross-feature-imports": "error" }
      },
      "legacy-billing": {
        "rules": {
          "cross-feature-imports": "off",
          "import-cycles": "off"
        }
      }
    }
  }
}
```

Resolution order for any single violation: **feature override → global
override → built-in default**. The first match wins.

### Workspace-only config

In a monorepo, the workspace-root `domainlint.json` may also include
`packageRules` and `packageRulesFile`. See `use-in-monorepo`.

## Common Mistakes

### CRITICAL Uses violation code as override key

Wrong:

```json
{
  "overrides": {
    "global": {
      "rules": {
        "noImportCycle": "warn",
        "noCrossFeatureDeepImport": "warn"
      }
    }
  }
}
```

Correct:

```json
{
  "overrides": {
    "global": {
      "rules": {
        "import-cycles": "warn",
        "cross-feature-imports": "warn"
      }
    }
  }
}
```

Violation codes are Biome-style camelCase (`noImportCycle`,
`noCrossFeatureDeepImport`, `noFeatureImportFromNonDomain`). Override
keys in `domainlint.json` are kebab-case (`import-cycles`,
`cross-feature-imports`, `no-external-feature-imports`). They look like
they should match, but they do not — the Zod schema rejects unknown
keys, and the run exits with code 2 before any file is parsed.

Source: `packages/domainlint/src/config/types.ts:4-6, 23-25`;
`packages/domainlint/src/config/rule-overrides.ts:57-61`

### HIGH Uses a path or glob as the feature override key

Wrong:

```json
{
  "overrides": {
    "features": {
      "src/features/legacy-billing": {
        "rules": { "import-cycles": "off" }
      }
    }
  }
}
```

Correct:

```json
{
  "overrides": {
    "features": {
      "legacy-billing": {
        "rules": { "import-cycles": "off" }
      }
    }
  }
}
```

`overrides.features` is keyed by **feature name only** — the directory
name directly under `featuresDir`. A path or glob looks plausible but
never matches any feature, so the override is silently ignored.

Source: `docs/src/content/docs/configuration.mdx` (override resolution)

### HIGH Assumes `no-external-feature-imports` is on by default

Wrong:

```ts
// Agent leaves default config and asserts in a PR comment:
// "Imports from src/lib into features are already blocked by default."
```

Correct:

```json
{
  "overrides": {
    "global": {
      "rules": { "no-external-feature-imports": "error" }
    }
  }
}
```

Unlike `import-cycles` and `cross-feature-imports` (default `error`),
`no-external-feature-imports` defaults to **`off`**. Enabling a refactor
that depends on it being enforced will silently allow violations.

Source: `packages/domainlint/src/config/rule-overrides.ts:15`

### MEDIUM Forgets the leading `.` on `extensions`

Wrong:

```json
{ "extensions": ["ts", "tsx"] }
```

Correct:

```json
{ "extensions": [".ts", ".tsx"] }
```

The Zod schema enforces `z.array(z.string().startsWith("."))`. Without
the dot, validation fails and the run exits with code 2.

Source: `packages/domainlint/src/config/types.ts` (Zod schema)

### MEDIUM Excludes a path instead of using a per-feature override

See `adopt-on-existing-codebase` § Common Mistakes — same
mistake from the configure-skill angle: `exclude` removes a file from
the graph entirely; an `overrides.features` entry exempts a feature
from one or more rules while keeping it in the graph.

### MEDIUM Re-implements a built-in check as a custom rule

Wrong:

```ts
// Custom rule duplicating R2 (cross-feature-imports):
const noDeepCrossFeature: Rule = {
  name: 'no-deep-cross-feature',
  check({ query, emitViolation, config }) {
    /* ...lots of code reimplementing the built-in... */
  },
};
```

Correct:

```json
// R2 is already enforced as `cross-feature-imports` by default.
// To exempt a feature, use overrides — no custom rule needed:
{
  "overrides": {
    "features": {
      "legacy": { "rules": { "cross-feature-imports": "off" } }
    }
  }
}
```

Reach for `overrides` before writing a custom rule. See
`write-custom-rule` for cases that overrides truly cannot
express (custom paths, layered architecture, fan-out limits, etc.).

Source: `docs/src/content/docs/rules.mdx`,
`docs/src/content/docs/configuration.mdx`

### HIGH Tension: Custom rule expressiveness vs config-first simplicity

The programmatic `Rule` API can express anything; an `overrides` entry
expresses only severity changes. Agents reach for code when config
would do. Always ask: **does `overrides` solve this before writing a
rule?**

See also: `write-custom-rule` § Common Mistakes for the
opposite pull — when a custom rule really is the right answer.

## References

- [Full `domainlint.json` schema and rule-key/violation-code reference](references/config-schema.md)

## See also

- `write-custom-rule` — when overrides cannot express a
  constraint, the escalation path is a custom rule.
- `adopt-on-existing-codebase` — Day-1 triage is mostly an
  exercise in writing the right `overrides` block.
- `use-in-monorepo` — workspace-only fields (`packageRules`,
  `packageRulesFile`) live in the same `domainlint.json` at the
  workspace root.

## Version

Targets domainlint v0.7.0.
