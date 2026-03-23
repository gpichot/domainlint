import { describe, expect, it } from 'vitest';
import { GraphQuery } from '../graph/graph-query.js';
import type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from '../graph/types.js';
import { createDefaultConfig } from '../test-utils/setup.js';
import { runRules } from './rules.js';
import { unusedFileRule } from './unused-file-detector.js';

function makeGraph(
  nodeList: string[],
  edges: [string, string][],
  normalizedToOriginalPath?: Map<string, string>,
): DependencyGraph {
  const nodes = new Set<string>(nodeList);
  const adjacencyList = new Map<string, Set<string>>();
  const graphEdges: DependencyEdge[] = [];

  for (const node of nodes) {
    adjacencyList.set(node, new Set());
  }

  for (const [from, to] of edges) {
    adjacencyList.get(from)!.add(to);
    graphEdges.push({
      from,
      to,
      importInfo: {
        specifier: to,
        line: 1,
        col: 1,
        isDynamic: false,
        isTypeOnly: false,
      },
    });
  }

  return { nodes, edges: graphEdges, adjacencyList, normalizedToOriginalPath };
}

async function detectUnusedFiles(graph: DependencyGraph): Promise<Violation[]> {
  const config = createDefaultConfig();
  const query = new GraphQuery(graph, config);
  return runRules([unusedFileRule], { graph, query, config });
}

describe('unusedFileRule', () => {
  it('has the expected rule name', () => {
    expect(unusedFileRule.name).toBe('unused-files');
  });

  it('returns no violations for an empty graph', async () => {
    const graph: DependencyGraph = {
      nodes: new Set(),
      edges: [],
      adjacencyList: new Map(),
    };
    expect(await detectUnusedFiles(graph)).toHaveLength(0);
  });

  it('detects a file with no importers', async () => {
    const graph = makeGraph(
      ['/project/src/a', '/project/src/b'],
      [['/project/src/a', '/project/src/b']],
    );
    const violations = await detectUnusedFiles(graph);
    // 'a' is not imported by anyone
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_UNUSED_FILE');
    expect(violations[0].file).toBe('/project/src/a');
  });

  it('returns no violations when all files are imported', async () => {
    const graph = makeGraph(
      ['/project/src/a', '/project/src/b'],
      [
        ['/project/src/a', '/project/src/b'],
        ['/project/src/b', '/project/src/a'],
      ],
    );
    const violations = await detectUnusedFiles(graph);
    expect(violations).toHaveLength(0);
  });

  it('skips barrel files (index.ts)', async () => {
    const normalizedToOriginalPath = new Map([
      [
        '/project/src/features/auth/index',
        '/project/src/features/auth/index.ts',
      ],
      [
        '/project/src/features/auth/service',
        '/project/src/features/auth/service.ts',
      ],
    ]);
    const graph = makeGraph(
      [
        '/project/src/features/auth/index',
        '/project/src/features/auth/service',
      ],
      [
        [
          '/project/src/features/auth/index',
          '/project/src/features/auth/service',
        ],
      ],
      normalizedToOriginalPath,
    );
    const violations = await detectUnusedFiles(graph);
    // index.ts (barrel) should NOT be flagged even though no one imports it
    // service.ts is imported by index.ts so it's fine
    expect(violations).toHaveLength(0);
  });

  it('detects unused file within a feature', async () => {
    const normalizedToOriginalPath = new Map([
      [
        '/project/src/features/auth/index',
        '/project/src/features/auth/index.ts',
      ],
      [
        '/project/src/features/auth/service',
        '/project/src/features/auth/service.ts',
      ],
      [
        '/project/src/features/auth/unused',
        '/project/src/features/auth/unused.ts',
      ],
    ]);
    const graph = makeGraph(
      [
        '/project/src/features/auth/index',
        '/project/src/features/auth/service',
        '/project/src/features/auth/unused',
      ],
      [
        [
          '/project/src/features/auth/index',
          '/project/src/features/auth/service',
        ],
      ],
      normalizedToOriginalPath,
    );
    const violations = await detectUnusedFiles(graph);
    // index.ts is a barrel (skipped), service.ts is imported, unused.ts is not imported
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('/project/src/features/auth/unused.ts');
  });

  it('uses original paths from normalizedToOriginalPath', async () => {
    const normalizedToOriginalPath = new Map([
      ['/project/src/a', '/project/src/a.ts'],
      ['/project/src/b', '/project/src/b.ts'],
    ]);
    const graph = makeGraph(
      ['/project/src/a', '/project/src/b'],
      [['/project/src/a', '/project/src/b']],
      normalizedToOriginalPath,
    );
    const violations = await detectUnusedFiles(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('/project/src/a.ts');
  });
});
