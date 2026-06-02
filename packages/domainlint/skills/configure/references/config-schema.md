# `domainlint.json` — Full schema reference

This is the complete configuration surface for domainlint. All fields are
optional. Defaults work for a standard `src/features/` layout.

## Top-level fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `rootDir` | `string` | `"."` | Project root, relative to where domainlint runs. |
| `srcDir` | `string` | `"src"` | Source directory analyzed. |
| `featuresDir` | `string` | `"src/features"` | Direct children are features. |
| `barrelFiles` | `string[]` | `["index.ts"]` | Filenames treated as public-API barrels. Each entry is a filename, not a path. |
| `extensions` | `string[]` | `[".ts", ".tsx"]` | **Each entry must start with `.`** — Zod rejects otherwise. |
| `tsconfigPath` | `string` | `"./tsconfig.json"` | Used for `compilerOptions.baseUrl` and `paths` resolution. `extends` chains supported (single-level, monorepo-style parent-directory, array extends, node_modules package extends). |
| `exclude` | `string[]` | `["**/node_modules/**", "**/dist/**", "**/.next/**"]` | Glob patterns. Excluded files do not contribute to the graph at all. |
| `includeDynamicImports` | `boolean` | `false` | Whether `await import("...")` with a static string literal contributes an edge. |
| `overrides` | `object` | — | Rule severity overrides — see below. |
| `packageRules` | `PackageImportRestriction[]` | — | **Workspace root only.** See `use-in-monorepo`. |
| `packageRulesFile` | `string` | — | **Workspace root only.** Custom path for workspace rules. |

## Rule keys

| Override key (in `domainlint.json`) | Violation code (in CLI output) | Default severity |
| --- | --- | --- |
| `import-cycles` | `noImportCycle` | `error` |
| `cross-feature-imports` | `noCrossFeatureDeepImport` | `error` |
| `no-external-feature-imports` | `noFeatureImportFromNonDomain` | **`off`** |

The mismatch between override keys (kebab-case) and violation codes
(Biome-style camelCase) is the #1 configuration footgun. The CLI prints
violation codes; the config file expects override keys.

**Custom rule violations** use the `code` you pass to `emitViolation`, or
an auto-generated `CUSTOM_<RULE_NAME>` if omitted. Custom rule severities
are not currently configurable via `overrides.rules` — they are always
reported with the severity implicit in their emission.

## Severity values

| Value | Effect |
| --- | --- |
| `"error"` | Reported as error. Contributes to exit code 1. |
| `"warn"` | Reported as warning. Does **not** contribute to exit code 1. |
| `"off"` | Rule is skipped entirely for the scope. |

## `overrides` shape

```json
{
  "overrides": {
    "global": {
      "rules": {
        "import-cycles": "warn",
        "cross-feature-imports": "error",
        "no-external-feature-imports": "off"
      }
    },
    "features": {
      "<feature-name>": {
        "rules": {
          "import-cycles": "off",
          "cross-feature-imports": "warn"
        }
      }
    }
  }
}
```

- `overrides.features` is keyed by **feature name only** (the directory
  name directly under `featuresDir`). Not a path. Not a glob.
- A feature-level entry only needs the rule keys whose severity differs
  from the global setting — others fall through to global, then default.

## Override resolution order

For each emitted violation:

1. **Feature-level** — if the violating file is inside a feature and
   `overrides.features["<feature>"].rules["<key>"]` is set, use that.
2. **Global** — otherwise, if `overrides.global.rules["<key>"]` is set,
   use that.
3. **Default** — otherwise, the per-rule default (`error` for
   `import-cycles` / `cross-feature-imports`, `off` for
   `no-external-feature-imports`).

A severity of `"off"` at any level causes that specific violation to be
dropped from the report.

## Zod schema (internal)

This is the validation schema applied at config load time. If validation
fails, domainlint exits with code 2 before any analysis runs.

```ts
const ruleOverrideSchema = z.object({
  rules: z
    .object({
      'import-cycles': z.enum(['off', 'warn', 'error']).optional(),
      'cross-feature-imports': z.enum(['off', 'warn', 'error']).optional(),
      'no-external-feature-imports': z.enum(['off', 'warn', 'error']).optional(),
    })
    .optional(),
});

const configFileSchema = z.object({
  rootDir: z.string().optional(),
  srcDir: z.string().optional(),
  featuresDir: z.string().optional(),
  barrelFiles: z.array(z.string().min(1)).optional(),
  extensions: z.array(z.string().startsWith('.')).optional(),
  tsconfigPath: z.string().optional(),
  exclude: z.array(z.string()).optional(),
  includeDynamicImports: z.boolean().optional(),
  overrides: z
    .object({
      global: ruleOverrideSchema.optional(),
      features: z.record(z.string(), ruleOverrideSchema).optional(),
    })
    .optional(),
});
```

## CLI flag overrides

CLI flags override file values for: `--src-dir`, `--features-dir`,
`--tsconfig-path`, `--include-dynamic-imports`. Other fields are
file-only.

## Config discovery

domainlint loads, in order:

1. `domainlint.json` at `rootDir`
2. `.domainlint.json` at `rootDir`
3. The path passed via `-c, --config=<path>`

The first one found is used.
