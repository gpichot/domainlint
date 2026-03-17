import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../test-utils/setup.js';
import { GraphQuery } from './graph-query.js';
import type { DependencyEdge, DependencyGraph } from './types.js';

function edge(
  from: string,
  to: string,
  overrides: Partial<DependencyEdge['importInfo']> = {},
): DependencyEdge {
  return {
    from,
    to,
    importInfo: {
      specifier: to,
      line: 1,
      col: 0,
      isDynamic: false,
      isTypeOnly: false,
      ...overrides,
    },
  };
}

function createGraph(
  edges: DependencyEdge[],
  normalizedToOriginalPath?: Map<string, string>,
): DependencyGraph {
  const nodes = new Set<string>();
  const adjacencyList = new Map<string, Set<string>>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!adjacencyList.has(e.from)) adjacencyList.set(e.from, new Set());
    adjacencyList.get(e.from)!.add(e.to);
  }
  return { nodes, edges, adjacencyList, normalizedToOriginalPath };
}

/*
  Test graph:

    /project/src/features/auth/index.ts
      → /project/src/features/auth/service.ts
      → /project/src/features/billing/index.ts

    /project/src/features/auth/service.ts
      → /project/src/lib/utils.ts

    /project/src/features/billing/index.ts
      → /project/src/features/billing/invoice.ts

    /project/src/features/billing/invoice.ts
      → /project/src/lib/utils.ts

    /project/src/app.ts
      → /project/src/features/auth/index.ts
*/
const testEdges = [
  edge(
    '/project/src/features/auth/index.ts',
    '/project/src/features/auth/service.ts',
  ),
  edge(
    '/project/src/features/auth/index.ts',
    '/project/src/features/billing/index.ts',
  ),
  edge('/project/src/features/auth/service.ts', '/project/src/lib/utils.ts'),
  edge(
    '/project/src/features/billing/index.ts',
    '/project/src/features/billing/invoice.ts',
  ),
  edge('/project/src/features/billing/invoice.ts', '/project/src/lib/utils.ts'),
  edge('/project/src/app.ts', '/project/src/features/auth/index.ts'),
];

const config = createDefaultConfig();

function createTestQuery() {
  return new GraphQuery(createGraph(testEdges), config);
}

describe('GraphQuery', () => {
  describe('edgesFrom', () => {
    it('should return edges from files matching a glob', () => {
      const q = createTestQuery();
      const result = q.edgesFrom('src/features/auth/**');
      expect(result.edges).toHaveLength(3);
      expect(result.edges.every((e) => e.from.includes('/auth/'))).toBe(true);
    });

    it('should return empty for non-matching glob', () => {
      const q = createTestQuery();
      const result = q.edgesFrom('src/nonexistent/**');
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('edgesTo', () => {
    it('should return edges targeting files matching a glob', () => {
      const q = createTestQuery();
      const result = q.edgesTo('src/lib/**');
      expect(result.edges).toHaveLength(2);
      expect(result.edges.every((e) => e.to.includes('/lib/'))).toBe(true);
    });
  });

  describe('edgesBetween', () => {
    it('should return edges from one glob to another', () => {
      const q = createTestQuery();
      const result = q.edgesBetween('src/features/**', 'src/lib/**');
      expect(result.edges).toHaveLength(2);
    });

    it('should return empty when no edges match', () => {
      const q = createTestQuery();
      const result = q.edgesBetween('src/lib/**', 'src/features/**');
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('EdgeQueryResult.violations', () => {
    it('should generate violations from matching edges with static message', () => {
      const q = createTestQuery();
      const violations = q
        .edgesBetween('src/features/**', 'src/lib/**')
        .violations('NO_LIB', 'Do not import lib');
      expect(violations).toHaveLength(2);
      expect(violations[0].code).toBe('NO_LIB');
      expect(violations[0].message).toBe('Do not import lib');
      expect(violations[0].line).toBe(1);
    });

    it('should support dynamic message function', () => {
      const q = createTestQuery();
      const violations = q
        .edgesTo('src/lib/**')
        .violations('NO_LIB', (e) => `${e.from} must not import ${e.to}`);
      expect(violations).toHaveLength(2);
      expect(violations[0].message).toContain('must not import');
    });

    it('should return empty array when no edges match', () => {
      const q = createTestQuery();
      const violations = q
        .edgesBetween('src/lib/**', 'src/features/**')
        .violations('X', 'msg');
      expect(violations).toHaveLength(0);
    });
  });

  describe('filesMatching', () => {
    it('should return nodes matching a glob', () => {
      const q = createTestQuery();
      const files = q.filesMatching('src/features/billing/**');
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.includes('/billing/'))).toBe(true);
    });

    it('should return all files with broad glob', () => {
      const q = createTestQuery();
      const files = q.filesMatching('**/*.ts');
      expect(files).toHaveLength(6);
    });
  });

  describe('featureOf', () => {
    it('should return feature name for feature files', () => {
      const q = createTestQuery();
      expect(q.featureOf('/project/src/features/auth/service.ts')).toBe('auth');
      expect(q.featureOf('/project/src/features/billing/invoice.ts')).toBe(
        'billing',
      );
    });

    it('should return null for non-feature files', () => {
      const q = createTestQuery();
      expect(q.featureOf('/project/src/lib/utils.ts')).toBeNull();
      expect(q.featureOf('/project/src/app.ts')).toBeNull();
    });
  });

  describe('importsOf', () => {
    it('should return direct imports of a file', () => {
      const q = createTestQuery();
      const imports = q.importsOf('/project/src/features/auth/index.ts');
      expect(imports).toHaveLength(2);
      expect(imports).toContain('/project/src/features/auth/service.ts');
      expect(imports).toContain('/project/src/features/billing/index.ts');
    });

    it('should return empty for leaf nodes', () => {
      const q = createTestQuery();
      const imports = q.importsOf('/project/src/lib/utils.ts');
      expect(imports).toHaveLength(0);
    });
  });

  describe('importersOf', () => {
    it('should return files that import a given file', () => {
      const q = createTestQuery();
      const importers = q.importersOf('/project/src/lib/utils.ts');
      expect(importers).toHaveLength(2);
      expect(importers).toContain('/project/src/features/auth/service.ts');
      expect(importers).toContain('/project/src/features/billing/invoice.ts');
    });

    it('should return empty for root nodes', () => {
      const q = createTestQuery();
      const importers = q.importersOf('/project/src/app.ts');
      expect(importers).toHaveLength(0);
    });
  });

  describe('dependsOn', () => {
    it('should return true for direct dependency', () => {
      const q = createTestQuery();
      expect(
        q.dependsOn(
          '/project/src/app.ts',
          '/project/src/features/auth/index.ts',
        ),
      ).toBe(true);
    });

    it('should return true for transitive dependency', () => {
      const q = createTestQuery();
      expect(
        q.dependsOn('/project/src/app.ts', '/project/src/lib/utils.ts'),
      ).toBe(true);
    });

    it('should return false for unrelated files', () => {
      const q = createTestQuery();
      expect(
        q.dependsOn('/project/src/lib/utils.ts', '/project/src/app.ts'),
      ).toBe(false);
    });
  });

  describe('dependenciesOf', () => {
    it('should return all transitive dependencies', () => {
      const q = createTestQuery();
      const deps = q.dependenciesOf('/project/src/app.ts');
      expect(deps).toContain('/project/src/features/auth/index.ts');
      expect(deps).toContain('/project/src/features/auth/service.ts');
      expect(deps).toContain('/project/src/features/billing/index.ts');
      expect(deps).toContain('/project/src/features/billing/invoice.ts');
      expect(deps).toContain('/project/src/lib/utils.ts');
      expect(deps).not.toContain('/project/src/app.ts');
    });

    it('should return empty for leaf nodes', () => {
      const q = createTestQuery();
      const deps = q.dependenciesOf('/project/src/lib/utils.ts');
      expect(deps).toHaveLength(0);
    });
  });

  describe('dependentsOf', () => {
    it('should return all transitive dependents', () => {
      const q = createTestQuery();
      const deps = q.dependentsOf('/project/src/lib/utils.ts');
      expect(deps).toContain('/project/src/features/auth/service.ts');
      expect(deps).toContain('/project/src/features/auth/index.ts');
      expect(deps).toContain('/project/src/features/billing/invoice.ts');
      expect(deps).toContain('/project/src/features/billing/index.ts');
      expect(deps).toContain('/project/src/app.ts');
      expect(deps).not.toContain('/project/src/lib/utils.ts');
    });

    it('should return empty for root nodes', () => {
      const q = createTestQuery();
      const deps = q.dependentsOf('/project/src/app.ts');
      expect(deps).toHaveLength(0);
    });
  });

  describe('fanOut', () => {
    it('should return number of direct imports', () => {
      const q = createTestQuery();
      expect(q.fanOut('/project/src/features/auth/index.ts')).toBe(2);
      expect(q.fanOut('/project/src/app.ts')).toBe(1);
      expect(q.fanOut('/project/src/lib/utils.ts')).toBe(0);
    });
  });

  describe('fanIn', () => {
    it('should return number of direct importers', () => {
      const q = createTestQuery();
      expect(q.fanIn('/project/src/lib/utils.ts')).toBe(2);
      expect(q.fanIn('/project/src/features/auth/index.ts')).toBe(1);
      expect(q.fanIn('/project/src/app.ts')).toBe(0);
    });
  });

  describe('normalizedToOriginalPath support', () => {
    it('violations should use original paths with extensions', () => {
      const normalizedEdges = [
        edge('/project/src/features/auth/service', '/project/src/lib/utils'),
      ];
      const map = new Map([
        [
          '/project/src/features/auth/service',
          '/project/src/features/auth/service.ts',
        ],
        ['/project/src/lib/utils', '/project/src/lib/utils.ts'],
      ]);
      const graph = createGraph(normalizedEdges, map);
      const q = new GraphQuery(graph, config);
      const violations = q
        .edgesFrom('src/features/**')
        .violations('TEST', 'test message');
      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('/project/src/features/auth/service.ts');
    });

    it('filesMatching should return original paths with extensions', () => {
      const normalizedEdges = [
        edge('/project/src/features/auth/service', '/project/src/lib/utils'),
      ];
      const map = new Map([
        [
          '/project/src/features/auth/service',
          '/project/src/features/auth/service.ts',
        ],
        ['/project/src/lib/utils', '/project/src/lib/utils.ts'],
      ]);
      const graph = createGraph(normalizedEdges, map);
      const q = new GraphQuery(graph, config);
      const files = q.filesMatching('src/features/**');
      expect(files).toEqual(['/project/src/features/auth/service.ts']);
    });

    it('importsOf should return original paths with extensions', () => {
      const normalizedEdges = [
        edge('/project/src/features/auth/service', '/project/src/lib/utils'),
      ];
      const map = new Map([
        [
          '/project/src/features/auth/service',
          '/project/src/features/auth/service.ts',
        ],
        ['/project/src/lib/utils', '/project/src/lib/utils.ts'],
      ]);
      const graph = createGraph(normalizedEdges, map);
      const q = new GraphQuery(graph, config);
      const imports = q.importsOf('/project/src/features/auth/service');
      expect(imports).toEqual(['/project/src/lib/utils.ts']);
    });
  });
});
