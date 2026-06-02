# `GraphQuery` API — complete reference

The `query` object on `RuleContext`. Available inside every custom `Rule`'s
`check` function. 12 methods total. **All glob patterns match against
paths relative to `config.rootDir`.**

> If a method does not appear in this list, it does not exist. The most
> commonly hallucinated names — `query.cycles`, `query.deps`,
> `query.filesIn`, `query.imports`, `query.cycles()` — are not part of
> the API.

## Types referenced

```ts
interface DependencyEdge {
  from: string;          // absolute path
  to: string;            // absolute path
  importInfo: {
    specifier: string;   // raw import string ("../auth/service")
    line: number;        // 1-based
    col: number;         // 1-based
    isDynamic: boolean;  // true for await import("...")
    isTypeOnly: boolean; // true for `import type` / `export type from`
  };
}

interface EdgeQueryResult {
  edges: DependencyEdge[];
  violations(
    code: string,
    message: string | ((edge: DependencyEdge) => string),
  ): RuleResult[];
}
```

## Edge queries (3 methods)

### `edgesFrom(glob: string): EdgeQueryResult`

Edges whose **source file** matches `glob`.

```ts
for (const edge of query.edgesFrom('src/domain/**').edges) {
  // edges leaving the domain layer
}
```

### `edgesTo(glob: string): EdgeQueryResult`

Edges whose **target file** matches `glob`.

```ts
for (const edge of query.edgesTo('src/lib/internal/**').edges) {
  // edges importing internal lib from anywhere
}
```

### `edgesBetween(fromGlob: string, toGlob: string): EdgeQueryResult`

Edges with both source matching `fromGlob` AND target matching `toGlob`.

```ts
const bad = query.edgesBetween('src/domain/**', 'src/infrastructure/**');
for (const edge of bad.edges) { /* ... */ }
```

### `EdgeQueryResult.violations(code, message)` — shorthand

Convert matched edges directly into `RuleResult` objects. `message` may
be a string or a `(edge) => string` function for per-edge messages.

```ts
const results = query
  .edgesBetween('src/app/**', 'src/lib/internal/**')
  .violations('NO_APP_TO_INTERNAL', (edge) =>
    `App must not import internal lib (${edge.importInfo.specifier})`,
  );
results.forEach(emitViolation);
```

The shorthand maps each edge to `{ code, file: edge.from, line:
edge.importInfo.line, col: edge.importInfo.col, message }`.

## Node queries (4 methods)

### `filesMatching(glob: string): string[]`

All graph nodes matching the glob. Returns original paths (with real
filesystem extensions).

```ts
for (const file of query.filesMatching('src/**/*.ts')) { /* ... */ }
```

### `featureOf(file: string): string | null`

Returns the feature name owning `file`, or `null` if outside all
features. Uses `config.featuresDir` to determine ownership — a file at
`<featuresDir>/<name>/**` belongs to feature `<name>`. Direct children
of `featuresDir` only — nested subdirectories are NOT separate features.

```ts
const owner = query.featureOf('src/features/billing/ui/Form.tsx');
// → "billing"
```

### `importsOf(file: string): string[]`

Direct outgoing neighbors of `file`. One level only.

```ts
const direct = query.importsOf('src/features/auth/session.ts');
```

### `importersOf(file: string): string[]`

Direct incoming neighbors of `file`. One level only.

```ts
const callers = query.importersOf('src/features/billing/index.ts');
```

## Transitive analysis (3 methods)

### `dependsOn(file: string, target: string): boolean`

Whether `file` transitively imports `target` (DFS over the adjacency
list).

```ts
if (query.dependsOn('src/domain/order.ts', 'src/infrastructure/db.ts')) {
  // domain has a transitive dependency on infra — layering violation
}
```

### `dependenciesOf(file: string): string[]`

All transitive dependencies of `file` (excluding `file` itself).

```ts
const all = query.dependenciesOf('src/features/billing/index.ts');
```

### `dependentsOf(file: string): string[]`

All transitive reverse dependencies (files that transitively import
`file`).

```ts
const reachers = query.dependentsOf('src/lib/auth/token.ts');
```

## Aggregates (2 methods)

### `fanOut(file: string): number`

Number of direct outgoing edges from `file`.

```ts
if (query.fanOut(file) > 15) { /* too many imports */ }
```

### `fanIn(file: string): number`

Number of direct incoming edges to `file`.

```ts
if (query.fanIn(file) > 30) { /* god-module candidate */ }
```

## Raw graph access (not a method, but on the context)

For anything the high-level API doesn't cover, `context.graph` exposes:

```ts
interface DependencyGraph {
  nodes: Set<string>;
  edges: DependencyEdge[];
  adjacencyList: Map<string, Set<string>>;
  // ...
}
```

Use the high-level API by default — the raw graph is a fallback for
advanced patterns that need direct access to the adjacency list (e.g.
custom SCC detection, weighted analyses).

## Quick reference table

| Category | Method | Returns |
| --- | --- | --- |
| Edges | `edgesFrom(glob)` | `EdgeQueryResult` |
| Edges | `edgesTo(glob)` | `EdgeQueryResult` |
| Edges | `edgesBetween(fromGlob, toGlob)` | `EdgeQueryResult` |
| Nodes | `filesMatching(glob)` | `string[]` |
| Nodes | `featureOf(file)` | `string \| null` |
| Nodes | `importsOf(file)` | `string[]` |
| Nodes | `importersOf(file)` | `string[]` |
| Transitive | `dependsOn(file, target)` | `boolean` |
| Transitive | `dependenciesOf(file)` | `string[]` |
| Transitive | `dependentsOf(file)` | `string[]` |
| Aggregate | `fanOut(file)` | `number` |
| Aggregate | `fanIn(file)` | `number` |
