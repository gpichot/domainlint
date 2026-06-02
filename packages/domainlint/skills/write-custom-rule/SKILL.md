---
name: write-custom-rule
description: >
  Author a custom `Rule` in `domainlint.rules.ts` using the `GraphQuery`
  API and `emitViolation` to enforce project-specific import constraints —
  including layered or domain-driven (DDD) architectures. Load before
  generating ANY custom rule code for domainlint. Covers the `Rule`
  interface (`name` + `check`), the `RuleContext` shape (`query`, `graph`,
  `config`, `emitViolation`), the full 12-method `GraphQuery` surface
  (`edgesFrom`, `edgesTo`, `edgesBetween`, `filesMatching`, `featureOf`,
  `importsOf`, `importersOf`, `dependsOn`, `dependenciesOf`,
  `dependentsOf`, `fanOut`, `fanIn`), the
  `query.edgesFrom(...).violations(code, message)` shorthand, the rules
  file discovery flow (`domainlint.rules.ts` / `.js` or `rulesFile`
  config), and modeling DDD / layered architectures as rules.
type: core
library: domainlint
library_version: '0.7.0'
sources:
  - 'gpichot/domainlint:docs/src/content/docs/custom-rules.mdx'
  - 'gpichot/domainlint:docs/src/content/docs/graphquery-api.mdx'
  - 'gpichot/domainlint:packages/domainlint/src/rules/rules.ts'
  - 'gpichot/domainlint:packages/domainlint/src/graph/graph-query.ts'
---

# domainlint — Write a custom rule

## Setup

Create `domainlint.rules.ts` (or `.js`) at the project root. Export a
`rules` array of `Rule` objects.

```ts
import type { Rule } from 'domainlint';

const noUtilsImport: Rule = {
  name: 'no-utils-import',
  check({ query, emitViolation }) {
    for (const edge of query.edgesTo('src/lib/utils/**').edges) {
      emitViolation({
        code: 'CUSTOM_NO_UTILS_IMPORT',
        file: edge.from,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: 'Importing from utils/ is not allowed. Use a feature barrel.',
      });
    }
  },
};

export const rules: Rule[] = [noUtilsImport];
```

Rules are auto-discovered from `domainlint.rules.ts` or
`domainlint.rules.js` at the project root, or from a path specified by
the `rulesFile` field in `domainlint.json`.

If the rules file is specified via config but not found at runtime,
domainlint throws — it does not silently skip.

## Core Patterns

### Rule interface

```ts
interface Rule {
  name: string;
  check(context: RuleContext): void | Promise<void>;
}

interface RuleContext {
  graph: DependencyGraph;
  query: GraphQuery;
  config: FeatureBoundariesConfig;
  emitViolation: (result: RuleResult) => void;
}

interface RuleResult {
  code?: string;     // auto-generated as CUSTOM_<RULE_NAME> if omitted
  file: string;      // absolute path
  line: number;      // 1-based
  col: number;       // 1-based
  message: string;
}
```

`check` is async-capable. Violations are reported by calling
`emitViolation` — **not** by returning an array.

### GraphQuery — edge queries with the shorthand

`edgesFrom`, `edgesTo`, and `edgesBetween` all return an
`EdgeQueryResult` with an `.edges` array AND a `.violations(code, message)`
helper that emits one violation per edge.

```ts
const noAppToInternalLib: Rule = {
  name: 'no-app-to-internal-lib',
  check({ query, emitViolation }) {
    query
      .edgesBetween('src/app/**', 'src/lib/internal/**')
      .violations('NO_APP_TO_INTERNAL_LIB', (edge) =>
        `App layer must not import internal lib (${edge.specifier})`,
      )
      .forEach(emitViolation);
  },
};
```

`message` can be a `string` or `(edge) => string` for per-edge context.

### Layered architecture (DDD pattern)

```ts
import type { Rule } from 'domainlint';

const noUpwardImports: Rule = {
  name: 'no-upward-imports',
  check({ query, emitViolation }) {
    for (const edge of query.edgesFrom('src/domain/**').edges) {
      if (edge.to.includes('/infrastructure/') || edge.to.includes('/ui/')) {
        emitViolation({
          code: 'NO_UPWARD_IMPORT',
          file: edge.from,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message: 'Domain layer must not import from infrastructure or UI',
        });
      }
    }
  },
};

export const rules: Rule[] = [noUpwardImports];
```

See `references/ddd-rule-cookbook.md` for full bounded-context and
aggregate-boundary patterns.

### Aggregate metric — fan-out limit

```ts
const maxFanOut: Rule = {
  name: 'max-fan-out',
  check({ query, emitViolation }) {
    const MAX = 15;
    for (const file of query.filesMatching('src/**/*.ts')) {
      const count = query.fanOut(file);
      if (count > MAX) {
        emitViolation({
          code: 'TOO_MANY_IMPORTS',
          file,
          line: 1,
          col: 0,
          message: `File has ${count} imports (max ${MAX})`,
        });
      }
    }
  },
};
```

## Common Mistakes

### CRITICAL Hallucinates GraphQuery methods that do not exist

Wrong:

```ts
const noDomainToInfra: Rule = {
  name: 'no-domain-to-infra',
  check({ query, emitViolation }) {
    for (const file of query.filesIn('src/domain/**')) {            // ❌ no such method
      for (const dep of query.deps(file)) {                          // ❌ no such method
        if (query.cycles().includes(dep)) {                          // ❌ no such method
          emitViolation({ /* ... */ });
        }
      }
    }
  },
};
```

Correct:

```ts
const noDomainToInfra: Rule = {
  name: 'no-domain-to-infra',
  check({ query, emitViolation }) {
    for (const file of query.filesMatching('src/domain/**')) {
      for (const dep of query.importsOf(file)) {
        if (query.dependsOn(dep, 'src/infrastructure')) {
          emitViolation({
            code: 'NO_DOMAIN_TO_INFRA',
            file,
            line: 1,
            col: 0,
            message: `Domain file ${file} transitively depends on infrastructure`,
          });
        }
      }
    }
  },
};
```

The GraphQuery surface has exactly 12 methods, listed in
`references/graphquery-api.md`. Methods that *sound* right
(`query.deps`, `query.cycles`, `query.filesIn`, `query.imports`) do not
exist. Hallucinated calls compile-fail (TypeScript) or silently return
`undefined` (JavaScript).

Source: maintainer interview;
`packages/domainlint/src/graph/graph-query.ts`

### CRITICAL Writes a rule from a vague human spec without nailing scope

Wrong:

```ts
// User: "ban utils imports"
// Agent immediately writes:
const noUtils: Rule = {
  name: 'no-utils',
  check({ query, emitViolation }) {
    for (const edge of query.edgesTo('src/utils/**').edges) {
      emitViolation({
        code: 'NO_UTILS',
        file: edge.from,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: 'No utils imports',
      });
    }
  },
};
// Floods CI: includes type-only imports, same-feature imports, internal helpers.
```

Correct:

```ts
// Step 1: probe before writing.
// - Who is restricted? (features only? all of src? a specific layer?)
// - Type-only OK? (edge.importInfo.isTypeOnly)
// - Dynamic imports? (edge.importInfo.isDynamic)
// - Same-feature deep imports?
// Step 2: write a precise rule:
const noUtilsFromFeatures: Rule = {
  name: 'no-utils-from-features',
  check({ query, emitViolation }) {
    for (const edge of query.edgesBetween('src/features/**', 'src/utils/**').edges) {
      if (edge.importInfo.isTypeOnly) continue;
      emitViolation({
        code: 'NO_UTILS_FROM_FEATURES',
        file: edge.from,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: `Features must not import from src/utils (${edge.specifier})`,
      });
    }
  },
};
```

A vague spec ("ban X") leaves type-only edges, dynamic edges, and
same-feature edges undefined. Resolve them with the user **before**
emitting code — the rule will run on every CI build and false positives
erode trust quickly.

Source: maintainer interview

### HIGH Confuses module-level `Rule` with workspace-level `WorkspaceRule`

Wrong:

```ts
// workspace-root/domainlint.rules.ts
import type { WorkspaceRule } from 'domainlint';

export const workspaceRules: WorkspaceRule[] = [{
  name: 'no-app-to-lib',
  check({ query, emitViolation }) {                  // ❌ no `query` in workspace context
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
  check({ edges, emitViolation }) {                  // workspace context has `edges`, not `query`
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

`Rule` (module-level) gets `{ graph, query, config, emitViolation }`.
`WorkspaceRule` (workspace-level) gets
`{ packages, edges, packageRules, emitViolation }`. Same `name` + `check`
shape, different context. Destructuring a non-existent field returns
`undefined` and a runtime error fires the moment the rule touches it.

Source: `packages/domainlint/src/rules/workspace-rules.ts:35-57`;
`docs/src/content/docs/workspaces.mdx`

### HIGH Forgets `emitViolation` — rule silently does nothing

Wrong:

```ts
const noUtils: Rule = {
  name: 'no-utils',
  check({ query }) {
    const violations = [];
    for (const edge of query.edgesTo('src/utils/**').edges) {
      violations.push({
        code: 'NO_UTILS',
        file: edge.from,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: 'No utils imports',
      });
    }
    return violations;                               // ❌ return value is ignored
  },
};
```

Correct:

```ts
const noUtils: Rule = {
  name: 'no-utils',
  check({ query, emitViolation }) {
    for (const edge of query.edgesTo('src/utils/**').edges) {
      emitViolation({
        code: 'NO_UTILS',
        file: edge.from,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: 'No utils imports',
      });
    }
  },
};
```

`check` returns `void | Promise<void>`. Any return value is discarded.
A rule that builds an array and returns it appears to run successfully
but never reports anything.

Source: `packages/domainlint/src/rules/rules.ts:25-28, 107-118`

### MEDIUM Re-implements a built-in rule or one expressible via `overrides`

Wrong:

```ts
// Reimplements R2 (cross-feature-imports), which is on by default:
const noDeepCrossFeature: Rule = {
  name: 'no-deep-cross-feature',
  check({ query, emitViolation, config }) {
    /* ...50 lines duplicating built-in logic... */
  },
};
```

Correct:

```json
// R2 is already enforced. To exempt a feature:
{
  "overrides": {
    "features": {
      "legacy": { "rules": { "cross-feature-imports": "off" } }
    }
  }
}
```

Reach for `overrides` first. Write a custom rule only when the
constraint isn't expressible as a severity change on a built-in.

Source: `docs/src/content/docs/rules.mdx`,
`docs/src/content/docs/configuration.mdx`

### HIGH Tension: Module-level `Rule` vs workspace-level `WorkspaceRule`

Both interfaces have `name` + `check`, but the context shapes diverge.
Agents authoring one frequently apply patterns from the other —
exporting `workspaceRules` from a per-package rules file, or accessing
`query` inside a workspace rule. Always confirm:

- `Rule` lives in any `domainlint.rules.ts` (per-package or root).
- `WorkspaceRule` lives **only** in the workspace-root rules file, and
  is exported as `workspaceRules`.

See also: `use-in-monorepo` § Common Mistakes.

## References

- [Full GraphQuery API reference (12 methods, signatures, examples)](references/graphquery-api.md)
- [DDD rule cookbook — bounded contexts, layered architecture, aggregate boundaries](references/ddd-rule-cookbook.md)

## See also

- `configure` — for severity-change constraints, an
  `overrides` entry beats a custom rule. The two skills' Common Mistakes
  sections reference each other.
- `use-in-monorepo` — cross-package constraints use the
  `WorkspaceRule` interface (different context shape).

## Version

Targets domainlint v0.7.0.
