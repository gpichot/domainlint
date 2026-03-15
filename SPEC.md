# Feature Boundaries Linter — SPEC

This document specifies a small architecture linter that enforces import boundaries around `src/features/*` and bans import cycles.

The linter is intended to run as a CLI in CI and locally.

---

## 1. Goals

The linter MUST enforce:

1. **No import cycles** in the analyzed project graph.
2. **No cross-feature deep imports** into `src/features/<feature>/**` internals.
   - Cross-feature imports MUST go through the feature **public API barrel** only.

The linter MUST be **tsconfig-paths aware**, using `compilerOptions.baseUrl` and `compilerOptions.paths` from `tsconfig.json` to resolve non-relative module specifiers.

---

## 2. Definitions

### 2.1 Source root
- Default source root is `src/`.
- The linter MAY allow configuring the source root, but the canonical structure assumes `src/`.

### 2.2 Features directory
A “feature” is any directory matching:

- `src/features/<featureName>/`

Where `<featureName>` is the directory name directly under `src/features/`.

### 2.3 Feature public API (barrel)
A feature’s public API entrypoint is:

- `src/features/<featureName>/index.ts`

Optionally (configurable), additional barrel extensions MAY be allowed:
- `index.tsx`
- `index.js`
- `index.jsx`

Unless configured otherwise, the linter MUST treat **`index.ts`** as the only valid barrel.

### 2.4 Internal feature module
Any file inside a feature directory that is **not** the barrel file(s):

- `src/features/<featureName>/**` excluding the barrel.

Examples of internals:
- `src/features/billing/ui/Button.tsx`
- `src/features/billing/domain/invoice.ts`
- `src/features/billing/_internal/foo.ts`

### 2.5 Local module import edge
A directed edge `A -> B` exists when file `A` contains an import (static or re-export) whose specifier resolves to a **local file** `B` in the project.

External packages (e.g. `react`, `zod`) do not produce edges.

### 2.6 Feature ownership
Define:

- `featureOf(filePath)`:
  - returns `<featureName>` if `filePath` matches `src/features/<featureName>/**`
  - otherwise returns `null`

Define:

- `barrelOf(featureName)`:
  - resolves to `src/features/<featureName>/index.ts` (and optionally other allowed barrel filenames/extensions if configured)

---

## 3. Scope

### 3.1 Included files
By default, the linter MUST analyze:
- `src/**/*.ts`
- `src/**/*.tsx`

Optionally (configurable), it MAY include:
- `src/**/*.js`
- `src/**/*.jsx`

### 3.2 Excluded paths
The linter MUST exclude at least:
- `**/node_modules/**`
- build outputs like `**/dist/**`, `**/build/**`, `**/.next/**` (configurable list)
- hidden directories by default: `**/.*` (configurable)

---

## 4. Rules

## RULE R1 — No import cycles

### Intent
Avoid circular dependencies across the module graph.

### Requirements
- The directed graph of local module import edges MUST be acyclic.
- A strongly connected component (SCC) with more than one node is a cycle.
- A self-loop (`A -> A`) MUST be treated as a cycle.

### Reporting
For each cycle detected, the linter MUST emit at least one violation with:
- `code`: `ARCH_IMPORT_CYCLE`
- `file`: path of at least one involved file
- `message`: includes a representative cycle path (e.g. `a -> b -> c -> a`)

The linter SHOULD attempt to pinpoint at least one offending import statement location (line/column) when feasible.

---

## RULE R2 — Cross-feature imports must use barrel only

### Intent
Ensure features only depend on other features via stable public APIs.

### Requirements
For every resolved local edge `from -> to`:

Let:
- `FX = featureOf(from)`
- `FY = featureOf(to)`

If `FY` is not `null` and `FX != FY` (including `FX = null`), then:

- `to` MUST equal `barrelOf(FY)`

Otherwise the edge is a violation.

### Allowed examples
- `src/pages/home.tsx` importing `src/features/billing/index.ts`
- `src/features/auth/internal.ts` importing `src/features/auth/ui/Button.tsx` (same feature; allowed)

### Forbidden examples
- `src/pages/home.tsx` importing `src/features/billing/ui/Button.tsx`
- `src/features/auth/foo.ts` importing `src/features/billing/domain/invoice.ts`

### Reporting
When violated, the linter MUST emit a violation with:
- `code`: `ARCH_NO_CROSS_FEATURE_DEEP_IMPORT`
- `file`: importer file (`from`)
- `line`/`col`: import statement location (best-effort)
- `message`: MUST indicate:
  - the resolved target
  - the expected barrel path for that feature
  - the raw import specifier, if available

---

## RULE R3 — Same-feature deep imports are allowed

### Intent
Keep internal ergonomics within a feature.

### Requirements
If `featureOf(from) == featureOf(to) != null`, then deep imports MUST be allowed by default.

(This spec does not enforce internal layering within a feature.)

---

## 5. Module Resolution

Correctness depends on robust module resolution.

### 5.1 General rules
For each import specifier encountered, the linter MUST attempt to resolve it to a file path using:

1. **Relative specifiers**: `./x`, `../y`
2. **tsconfig path mapping**: `compilerOptions.baseUrl` + `compilerOptions.paths`
3. **Node/TypeScript-like resolution** for local modules:
   - extension inference for configured extensions
   - directory index resolution (e.g. `foo/` -> `foo/index.ts`)
4. If the specifier resolves outside the project root or cannot be resolved to a local file, it MUST be treated as **external/ignored** for boundary and cycle rules.

### 5.2 tsconfig.json selection
- The linter MUST load `tsconfig.json` from the configured root directory (default `./tsconfig.json`).
- The linter MUST honor:
  - `compilerOptions.baseUrl`
  - `compilerOptions.paths`
- The linter SHOULD support `extends` chains (common in monorepos), resolving and merging `compilerOptions` accordingly.
  - If `extends` is unsupported, the linter MUST document the limitation.

### 5.3 Path mapping behavior
When `paths` is present:
- The linter MUST implement wildcard matching compatible with TypeScript’s `paths` behavior:
  - single `*` segment in keys and targets
  - replacement of `*` with the matched substring
- If multiple `paths` entries match a specifier, the linter SHOULD try them in TypeScript order and resolve the first that exists.

### 5.4 Symlinks
- The linter MAY choose to resolve symlinks to real paths, but MUST do so consistently to avoid false cycles.

---

## 6. Parsed Import Forms

The linter MUST account for the following forms as dependency edges (when resolvable locally):

### 6.1 Static imports
```ts
import x from "spec";
import { a } from "spec";
import * as ns from "spec";
```

### 6.2 Re-exports
```ts
export * from "spec";
export { a } from "spec";
```

### 6.3 Type-only imports/exports
```ts
import type { T } from "spec";
export type { T } from "spec";
```
Type-only edges MUST be included in the dependency graph (for boundary and cycle rules) unless explicitly configured otherwise.

### 6.4 Dynamic import (optional)
```ts
await import("spec");
```
By default:
- Dynamic imports MAY be ignored.
Optionally:
- The linter MAY include them if statically analyzable string literals are present.

This must be configurable.

---

## 7. Configuration

The linter SHOULD support a config file and CLI flags. If both exist, CLI flags SHOULD override config.

### 7.1 Proposed config file
`feature-boundaries.json` (name optional) with shape:

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

### 7.2 Defaults
- `rootDir`: `.`
- `srcDir`: `src`
- `featuresDir`: `src/features`
- `barrelFiles`: `["index.ts"]`
- `extensions`: `[".ts", ".tsx"]`
- `tsconfigPath`: `./tsconfig.json`
- `includeDynamicImports`: `false`

---

## 8. Diagnostics & Exit Codes

### 8.1 Violation shape
Each violation MUST include:
- `code`: stable identifier (`ARCH_IMPORT_CYCLE`, `ARCH_NO_CROSS_FEATURE_DEEP_IMPORT`)
- `file`: importer file path
- `line`: 1-based line number (best-effort)
- `col`: 1-based column number (best-effort)
- `message`: human-readable explanation

### 8.2 Output format
Default CLI output MUST be one line per violation:

```
<file>:<line>:<col> <code> <message>
```

### 8.3 Exit codes
- `0` if no violations
- `1` if violations found
- `2` if an internal error occurs (e.g., unreadable tsconfig)

---

## 9. Non-goals

The following are explicitly out of scope for this spec:
- Enforcing intra-feature layering (e.g. `ui` cannot import `infra`)
- Auto-fixing imports
- Type-checking / semantic analysis beyond resolution
- Enforcing “only alias imports” (though recommended as an extra policy)

---

## RULE R4 — Custom rules

### Intent
Allow users to define project-specific import restrictions beyond the built-in rules.

### Configuration
Custom rules are defined in the `customRules` array in `domainlint.json`:

```json
{
  “customRules”: [
    {
      “from”: “src/features/**”,
      “deny”: [“src/lib/**”, “src/utils/**”],
      “message”: “Features must not import from shared lib directly”
    },
    {
      “from”: “src/features/**”,
      “allow”: [“src/features/**”, “src/shared/**”],
      “message”: “Features can only import from features or shared”,
      “level”: “warn”
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | `string` | Yes | Glob pattern matching source files (relative to `rootDir`) |
| `deny` | `string[]` | No | Glob patterns for forbidden import targets |
| `allow` | `string[]` | No | Glob patterns for exclusively allowed import targets |
| `message` | `string` | No | Custom violation message |
| `level` | `”warn” \| “error”` | No | Severity level (default: `”error”`) |

### Semantics
- `from` is matched against the importing file's path (relative to `rootDir`)
- When `deny` is specified: imports resolving to a path matching any deny pattern produce a violation
- When `allow` is specified: imports resolving to a path **not** matching any allow pattern produce a violation
- If neither `deny` nor `allow` is specified, the rule has no effect
- All patterns use [minimatch](https://github.com/isaacs/minimatch) glob syntax

### Reporting
Violations emit:
- `code`: `ARCH_CUSTOM_RULE`
- `file`: importer file path
- `line`/`col`: import statement location
- `message`: custom message if provided, otherwise a default message

### Programmatic API
When using the JS API, users can also add rule functions that receive the full `DependencyGraph`:

```ts
import { FeatureBoundariesLinter, loadConfig } from 'domainlint';

const config = await loadConfig('.');
const linter = new FeatureBoundariesLinter(config);

linter.addRule((graph) => {
  const violations = [];
  for (const edge of graph.edges) {
    // Custom logic using the full graph
  }
  return violations;
});

const result = await linter.lint();
```

---

## 10. Suggested future extensions (not part of current rules)

- Allow a `public.ts` instead of `index.ts`
- Add per-feature “friend” features / allowed dependencies list
- Add “shared” layer: `src/shared/**` always importable
- Add lint rule: prohibit importing barrels **from inside** the same feature (enforce relative internal imports)
