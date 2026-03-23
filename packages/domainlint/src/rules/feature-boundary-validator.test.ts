import { describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { GraphQuery } from '../graph/graph-query.js';
import type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from '../graph/types.js';
import { featureBoundaryRule } from './feature-boundary-validator.js';
import { runRules } from './rules.js';

const config: FeatureBoundariesConfig = {
  rootDir: '/project',
  srcDir: '/project/src',
  featuresDir: '/project/src/features',
  barrelFiles: ['index.ts'],
  extensions: ['.ts', '.tsx'],
  tsconfigPath: '/project/tsconfig.json',
  exclude: [],
  includeDynamicImports: false,
};

function makeEdge(
  from: string,
  to: string,
  specifier = './import',
): DependencyEdge {
  return {
    from,
    to,
    importInfo: {
      specifier,
      line: 1,
      col: 1,
      isDynamic: false,
      isTypeOnly: false,
    },
  };
}

function makeGraph(
  edges: DependencyEdge[],
  normalizedToOriginalPath?: Map<string, string>,
): DependencyGraph {
  const nodes = new Set(edges.flatMap((e) => [e.from, e.to]));
  const adjacencyList = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    if (!adjacencyList.has(from)) adjacencyList.set(from, new Set());
    adjacencyList.get(from)!.add(to);
  }
  return { nodes, edges, adjacencyList, normalizedToOriginalPath };
}

async function checkBoundaries(
  graph: DependencyGraph,
  overrideConfig = config,
): Promise<Violation[]> {
  const query = new GraphQuery(graph, overrideConfig);
  return runRules([featureBoundaryRule], {
    graph,
    query,
    config: overrideConfig,
  });
}

describe('featureBoundaryRule', () => {
  it('has the expected rule name', () => {
    expect(featureBoundaryRule.name).toBe('cross-feature-imports');
  });

  it('returns no violations for imports within the same feature', async () => {
    const edges = [
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/features/auth/utils.ts',
      ),
    ];
    const violations = await checkBoundaries(makeGraph(edges));
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when importing from another feature barrel', async () => {
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/index.ts',
        '../auth/index',
      ),
    ];
    const violations = await checkBoundaries(makeGraph(edges));
    expect(violations).toHaveLength(0);
  });

  it('reports noCrossFeatureDeepImport for cross-feature non-barrel import', async () => {
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/service.ts',
        '../auth/service',
      ),
    ];
    const violations = await checkBoundaries(makeGraph(edges));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('noCrossFeatureDeepImport');
    expect(violations[0].file).toBe('/project/src/features/billing/invoice.ts');
    expect(violations[0].message).toContain('../auth/service');
  });

  it('includes the expected barrel path in the violation message', async () => {
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/service.ts',
        '../auth/service',
      ),
    ];
    const violations = await checkBoundaries(makeGraph(edges));
    expect(violations[0].message).toContain('index.ts');
  });

  it('reports noFeatureImportFromNonDomain for feature importing outside features dir', async () => {
    const edges = [
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/shared/utils.ts',
        '../../shared/utils',
      ),
    ];
    const violations = await checkBoundaries(makeGraph(edges));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('noFeatureImportFromNonDomain');
  });

  it('returns no violations for non-feature files importing anything', async () => {
    const edges = [
      makeEdge(
        '/project/src/shared/utils.ts',
        '/project/src/shared/helpers.ts',
      ),
    ];
    const violations = await checkBoundaries(makeGraph(edges));
    expect(violations).toHaveLength(0);
  });

  it('handles multiple barrel file types', async () => {
    const configWithMultipleBarrels: FeatureBoundariesConfig = {
      ...config,
      barrelFiles: ['index.ts', 'index.tsx'],
    };
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/index.tsx',
        '../auth/index',
      ),
    ];
    const violations = await checkBoundaries(
      makeGraph(edges),
      configWithMultipleBarrels,
    );
    expect(violations).toHaveLength(0);
  });

  it('uses originalPath from normalizedToOriginalPath when available', async () => {
    const normalizedFrom = '/project/src/features/billing/invoice';
    const normalizedTo = '/project/src/features/auth/service';
    const originalFrom = '/project/src/features/billing/invoice.ts';
    const originalTo = '/project/src/features/auth/service.ts';

    const normalizedToOriginalPath = new Map([
      [normalizedFrom, originalFrom],
      [normalizedTo, originalTo],
    ]);
    const edges = [makeEdge(normalizedFrom, normalizedTo, '../auth/service')];
    const graph = makeGraph(edges, normalizedToOriginalPath);

    const violations = await checkBoundaries(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(originalFrom);
  });

  it('returns no violations for an empty graph', async () => {
    const violations = await checkBoundaries({
      nodes: new Set(),
      edges: [],
      adjacencyList: new Map(),
    });
    expect(violations).toHaveLength(0);
  });
});
