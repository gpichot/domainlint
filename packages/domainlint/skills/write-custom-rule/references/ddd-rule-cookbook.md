# DDD / Layered architecture — rule cookbook

Worked examples for modeling Domain-Driven Design and layered
architectures as domainlint rules. Each pattern is a complete `Rule`
that can be dropped into `domainlint.rules.ts`.

These rules complement — they do not replace — the built-in
`cross-feature-imports` rule. Use built-ins for feature-barrel
enforcement; use these custom rules for cross-layer or cross-context
constraints.

## Project shape this cookbook assumes

```
src/
  domain/           ← pure business logic (entities, value objects)
  application/      ← use cases, services orchestrating domain
  infrastructure/   ← DB, HTTP, external API adapters
  ui/               ← framework views, components
  contexts/
    sales/          ← bounded context: Sales
      domain/
      application/
      infrastructure/
    inventory/      ← bounded context: Inventory
      domain/
      application/
      infrastructure/
  shared-kernel/    ← types shared across bounded contexts
```

Adapt the globs to your own project layout.

## Pattern 1 — Layered architecture (no upward imports)

The domain layer must not depend on application, infrastructure, or UI.
Application may import domain but not infrastructure-impl details. UI
may import application but not domain directly.

```ts
import type { Rule } from 'domainlint';

const noDomainToOuterLayers: Rule = {
  name: 'no-domain-to-outer-layers',
  check({ query, emitViolation }) {
    const outer = ['src/application/**', 'src/infrastructure/**', 'src/ui/**'];
    for (const layerGlob of outer) {
      query
        .edgesBetween('src/domain/**', layerGlob)
        .violations(
          'NO_DOMAIN_TO_OUTER',
          (edge) =>
            `Domain must not depend on outer layer: ${edge.importInfo.specifier}`,
        )
        .forEach(emitViolation);
    }
  },
};

const noApplicationToInfra: Rule = {
  name: 'no-application-to-infra',
  check({ query, emitViolation }) {
    query
      .edgesBetween('src/application/**', 'src/infrastructure/**')
      .violations(
        'NO_APP_TO_INFRA',
        (edge) =>
          `Application must depend on interfaces, not infra impl: ${edge.importInfo.specifier}`,
      )
      .forEach(emitViolation);
  },
};

const noUiToDomain: Rule = {
  name: 'no-ui-to-domain',
  check({ query, emitViolation }) {
    query
      .edgesBetween('src/ui/**', 'src/domain/**')
      .violations(
        'NO_UI_TO_DOMAIN',
        () => 'UI must go through application services, not domain directly',
      )
      .forEach(emitViolation);
  },
};

export const rules: Rule[] = [
  noDomainToOuterLayers,
  noApplicationToInfra,
  noUiToDomain,
];
```

## Pattern 2 — Bounded contexts (no cross-context imports)

Each bounded context is isolated except via a shared kernel or an
explicit context barrel.

```ts
import type { Rule } from 'domainlint';

const CONTEXTS = ['sales', 'inventory', 'billing'];

function isInContext(file: string, ctx: string): boolean {
  return file.includes(`/contexts/${ctx}/`);
}

const noCrossContextImports: Rule = {
  name: 'no-cross-context-imports',
  check({ graph, emitViolation }) {
    for (const edge of graph.edges) {
      const fromCtx = CONTEXTS.find((c) => isInContext(edge.from, c));
      const toCtx = CONTEXTS.find((c) => isInContext(edge.to, c));
      if (!fromCtx || !toCtx || fromCtx === toCtx) continue;

      // Allow only the context's barrel: src/contexts/<ctx>/index.ts
      const allowed = `/contexts/${toCtx}/index.`;
      if (!edge.to.includes(allowed)) {
        emitViolation({
          code: 'NO_CROSS_CONTEXT_DEEP_IMPORT',
          file: edge.from,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message:
            `Context "${fromCtx}" must not import internals of "${toCtx}"` +
            ` — go through src/contexts/${toCtx}/index.ts.`,
        });
      }
    }
  },
};

export const rules: Rule[] = [noCrossContextImports];
```

## Pattern 3 — Shared kernel must not import from contexts

The shared kernel is upstream. It must not depend on any specific
bounded context.

```ts
import type { Rule } from 'domainlint';

const sharedKernelNoContextImports: Rule = {
  name: 'shared-kernel-no-context-imports',
  check({ query, emitViolation }) {
    query
      .edgesBetween('src/shared-kernel/**', 'src/contexts/**')
      .violations(
        'SHARED_KERNEL_NO_CONTEXT_IMPORTS',
        () => 'Shared kernel must not depend on any bounded context',
      )
      .forEach(emitViolation);
  },
};

export const rules: Rule[] = [sharedKernelNoContextImports];
```

## Pattern 4 — Aggregate root is the only public type per aggregate

Within a context, an aggregate's internals (child entities, value
objects) must not be imported across aggregates. Only the aggregate root
file is the public surface.

```ts
import type { Rule } from 'domainlint';

const aggregateRootOnly: Rule = {
  name: 'aggregate-root-only',
  check({ graph, emitViolation }) {
    const aggregatePattern = /\/contexts\/([^/]+)\/domain\/aggregates\/([^/]+)\//;
    for (const edge of graph.edges) {
      const fromMatch = edge.from.match(aggregatePattern);
      const toMatch = edge.to.match(aggregatePattern);
      if (!toMatch) continue; // edge target not inside an aggregate
      const [, toCtx, toAgg] = toMatch;

      const sameAggregate =
        fromMatch && fromMatch[1] === toCtx && fromMatch[2] === toAgg;
      if (sameAggregate) continue;

      // Allow only the aggregate root file:
      // src/contexts/<ctx>/domain/aggregates/<agg>/<agg>.ts
      const allowedRoot = `/contexts/${toCtx}/domain/aggregates/${toAgg}/${toAgg}.`;
      if (!edge.to.includes(allowedRoot)) {
        emitViolation({
          code: 'AGGREGATE_INTERNAL_IMPORT',
          file: edge.from,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message: `Import aggregate "${toAgg}" through its root, not internal: ${edge.importInfo.specifier}`,
        });
      }
    }
  },
};

export const rules: Rule[] = [aggregateRootOnly];
```

## Pattern 5 — Anti-corruption layer for one specific context

The "billing" context may only consume "sales" through a designated
anti-corruption layer (`src/contexts/billing/acl/sales.ts`).

```ts
import type { Rule } from 'domainlint';

const billingSalesAcl: Rule = {
  name: 'billing-sales-acl',
  check({ graph, emitViolation }) {
    for (const edge of graph.edges) {
      const fromBilling = edge.from.includes('/contexts/billing/');
      const toSales = edge.to.includes('/contexts/sales/');
      if (!fromBilling || !toSales) continue;

      const goesThroughAcl = edge.from.includes('/contexts/billing/acl/sales');
      if (!goesThroughAcl) {
        emitViolation({
          code: 'BILLING_SALES_ACL',
          file: edge.from,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message:
            'Billing must consume Sales only via src/contexts/billing/acl/sales.ts',
        });
      }
    }
  },
};

export const rules: Rule[] = [billingSalesAcl];
```

## Pattern 6 — Detect violations of dependency direction by reachability

Sometimes a layering violation is transitive — a domain file imports an
application helper, which imports infrastructure. The direct edge looks
fine; the transitive reachability is the problem. Use `dependsOn`:

```ts
import type { Rule } from 'domainlint';

const noDomainTransitivelyOnInfra: Rule = {
  name: 'no-domain-transitively-on-infra',
  check({ query, emitViolation }) {
    for (const file of query.filesMatching('src/domain/**')) {
      // Cheap shortcut: check well-known infrastructure entry points.
      const infraEntryPoints = query.filesMatching('src/infrastructure/**');
      for (const target of infraEntryPoints) {
        if (query.dependsOn(file, target)) {
          emitViolation({
            code: 'NO_DOMAIN_TRANSITIVELY_ON_INFRA',
            file,
            line: 1,
            col: 0,
            message: `Domain file ${file} transitively reaches ${target}`,
          });
          break;
        }
      }
    }
  },
};

export const rules: Rule[] = [noDomainTransitivelyOnInfra];
```

For large graphs, prefer reachability rules on representative targets
rather than every pair — `dependsOn` is a DFS and runs once per call.

## Combining built-in rules with custom rules

Built-in `cross-feature-imports` already enforces "use the barrel" for
feature folders. If your bounded contexts are mapped onto features
(`src/features/sales/`, `src/features/inventory/`), you get the
cross-context barrel rule for free. Layered rules and aggregate-internal
rules are the additions DDD requires.

A typical DDD codebase ends up with:

| Rule | Source |
| --- | --- |
| Cross-context internals forbidden | Built-in `cross-feature-imports` (if contexts are features) OR Pattern 2 |
| No cycles | Built-in `import-cycles` |
| Layered direction | Pattern 1 |
| Aggregate-root-only | Pattern 4 |
| Anti-corruption layers | Pattern 5 (one rule per specific consumer→producer pair) |
