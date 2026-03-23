import { describe, expect, it } from 'vitest';
import { GraphQuery } from '../graph/graph-query.js';
import type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from '../graph/types.js';
import type { ExportedSymbol, ImportedSymbol } from '../parser/types.js';
import { createDefaultConfig } from '../test-utils/setup.js';
import { runRules } from './rules.js';
import { unusedExportRule } from './unused-export-detector.js';

interface EdgeDef {
  from: string;
  to: string;
  importedNames?: ImportedSymbol[];
}

function makeGraph(
  nodeExportsMap: Record<string, ExportedSymbol[]>,
  edges: EdgeDef[],
  normalizedToOriginalPath?: Map<string, string>,
): DependencyGraph {
  const nodes = new Set<string>(Object.keys(nodeExportsMap));
  const adjacencyList = new Map<string, Set<string>>();
  const graphEdges: DependencyEdge[] = [];

  for (const node of nodes) {
    adjacencyList.set(node, new Set());
  }

  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
    if (!adjacencyList.has(edge.from)) adjacencyList.set(edge.from, new Set());
    if (!adjacencyList.has(edge.to)) adjacencyList.set(edge.to, new Set());
    adjacencyList.get(edge.from)!.add(edge.to);
    graphEdges.push({
      from: edge.from,
      to: edge.to,
      importInfo: {
        specifier: edge.to,
        line: 1,
        col: 1,
        isDynamic: false,
        isTypeOnly: false,
        importedNames: edge.importedNames,
      },
    });
  }

  const nodeExports = new Map<string, ExportedSymbol[]>();
  for (const [key, exports] of Object.entries(nodeExportsMap)) {
    nodeExports.set(key, exports);
  }

  return {
    nodes,
    edges: graphEdges,
    adjacencyList,
    normalizedToOriginalPath,
    nodeExports,
  };
}

function sym(name: string, isTypeOnly = false): ExportedSymbol {
  return { name, line: 1, col: 1, isTypeOnly };
}

async function detectUnusedExports(
  graph: DependencyGraph,
): Promise<Violation[]> {
  const config = createDefaultConfig();
  const query = new GraphQuery(graph, config);
  return runRules([unusedExportRule], { graph, query, config });
}

describe('unusedExportRule', () => {
  it('has the expected rule name', () => {
    expect(unusedExportRule.name).toBe('unused-exports');
  });

  it('returns no violations when there are no exports', async () => {
    const graph = makeGraph({ '/project/src/a': [] }, []);
    expect(await detectUnusedExports(graph)).toHaveLength(0);
  });

  it('detects unused exports', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('foo'), sym('bar')],
        '/project/src/b': [],
      },
      [
        {
          from: '/project/src/b',
          to: '/project/src/a',
          importedNames: [{ name: 'foo', isNamespace: false }],
        },
      ],
    );
    const violations = await detectUnusedExports(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_UNUSED_EXPORT');
    expect(violations[0].message).toContain('bar');
  });

  it('returns no violations when all exports are used', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('foo'), sym('bar')],
        '/project/src/b': [],
      },
      [
        {
          from: '/project/src/b',
          to: '/project/src/a',
          importedNames: [
            { name: 'foo', isNamespace: false },
            { name: 'bar', isNamespace: false },
          ],
        },
      ],
    );
    expect(await detectUnusedExports(graph)).toHaveLength(0);
  });

  it('treats namespace import as using all exports', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('foo'), sym('bar'), sym('baz')],
        '/project/src/b': [],
      },
      [
        {
          from: '/project/src/b',
          to: '/project/src/a',
          importedNames: [{ name: '*', isNamespace: true }],
        },
      ],
    );
    expect(await detectUnusedExports(graph)).toHaveLength(0);
  });

  it('detects unused default export', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('default'), sym('foo')],
        '/project/src/b': [],
      },
      [
        {
          from: '/project/src/b',
          to: '/project/src/a',
          importedNames: [{ name: 'foo', isNamespace: false }],
        },
      ],
    );
    const violations = await detectUnusedExports(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('default');
  });

  it('skips barrel files', async () => {
    const normalizedToOriginalPath = new Map([
      [
        '/project/src/features/auth/index',
        '/project/src/features/auth/index.ts',
      ],
    ]);
    const graph = makeGraph(
      {
        '/project/src/features/auth/index': [sym('login'), sym('logout')],
      },
      [],
      normalizedToOriginalPath,
    );
    // Barrel files should not be checked for unused exports
    expect(await detectUnusedExports(graph)).toHaveLength(0);
  });

  it('skips files that have wildcard re-exports', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('*'), sym('foo')],
        '/project/src/b': [],
      },
      [],
    );
    // Can't know what's unused when there's a wildcard re-export
    expect(await detectUnusedExports(graph)).toHaveLength(0);
  });

  it('aggregates imports across multiple importers', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('foo'), sym('bar'), sym('baz')],
        '/project/src/b': [],
        '/project/src/c': [],
      },
      [
        {
          from: '/project/src/b',
          to: '/project/src/a',
          importedNames: [{ name: 'foo', isNamespace: false }],
        },
        {
          from: '/project/src/c',
          to: '/project/src/a',
          importedNames: [{ name: 'bar', isNamespace: false }],
        },
      ],
    );
    const violations = await detectUnusedExports(graph);
    // Only 'baz' is unused
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('baz');
  });

  it('reports all unused exports when file has no importers', async () => {
    const graph = makeGraph(
      {
        '/project/src/a': [sym('foo'), sym('bar')],
      },
      [],
    );
    const violations = await detectUnusedExports(graph);
    expect(violations).toHaveLength(2);
    const names = violations.map((v) => v.message);
    expect(names.some((m) => m.includes('foo'))).toBe(true);
    expect(names.some((m) => m.includes('bar'))).toBe(true);
  });
});
