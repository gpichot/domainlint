import { describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import type { DependencyEdge, DependencyGraph } from '../graph/types.js';
import { validateFeatureBoundaries } from './feature-boundary-validator.js';

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

function makeFileInfo(
  path: string,
  feature: string | null,
  isBarrel = false,
): FileInfo {
  return {
    path,
    relativePath: path.replace('/project/', ''),
    feature,
    isBarrel,
  };
}

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

function makeGraph(edges: DependencyEdge[]): DependencyGraph {
  const nodes = new Set(edges.flatMap((e) => [e.from, e.to]));
  const adjacencyList = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    if (!adjacencyList.has(from)) adjacencyList.set(from, new Set());
    adjacencyList.get(from)!.add(to);
  }
  return { nodes, edges, adjacencyList };
}

describe('validateFeatureBoundaries', () => {
  it('returns no violations for imports within the same feature', () => {
    const files = [
      makeFileInfo('/project/src/features/auth/service.ts', 'auth'),
      makeFileInfo('/project/src/features/auth/utils.ts', 'auth'),
    ];
    const edges = [
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/features/auth/utils.ts',
      ),
    ];
    const violations = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      config,
    );
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when importing from another feature barrel', () => {
    const files = [
      makeFileInfo('/project/src/features/billing/invoice.ts', 'billing'),
      makeFileInfo('/project/src/features/auth/index.ts', 'auth', true),
    ];
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/index.ts',
        '../auth/index',
      ),
    ];
    const violations = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      config,
    );
    expect(violations).toHaveLength(0);
  });

  it('reports ARCH_NO_CROSS_FEATURE_DEEP_IMPORT for cross-feature non-barrel import', () => {
    const files = [
      makeFileInfo('/project/src/features/billing/invoice.ts', 'billing'),
      makeFileInfo('/project/src/features/auth/service.ts', 'auth'),
    ];
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/service.ts',
        '../auth/service',
      ),
    ];
    const violations = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      config,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_NO_CROSS_FEATURE_DEEP_IMPORT');
    expect(violations[0].file).toBe('/project/src/features/billing/invoice.ts');
    expect(violations[0].message).toContain('../auth/service');
  });

  it('includes the expected barrel path in the violation message', () => {
    const files = [
      makeFileInfo('/project/src/features/billing/invoice.ts', 'billing'),
      makeFileInfo('/project/src/features/auth/service.ts', 'auth'),
    ];
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/service.ts',
        '../auth/service',
      ),
    ];
    const [violation] = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      config,
    );
    expect(violation.message).toContain('index.ts');
  });

  it('reports ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN for feature importing outside features dir', () => {
    const files = [
      makeFileInfo('/project/src/features/auth/service.ts', 'auth'),
      makeFileInfo('/project/src/shared/utils.ts', null),
    ];
    const edges = [
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/shared/utils.ts',
        '../../shared/utils',
      ),
    ];
    const violations = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      config,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN');
  });

  it('returns no violations for non-feature files importing anything', () => {
    const files = [
      makeFileInfo('/project/src/shared/utils.ts', null),
      makeFileInfo('/project/src/shared/helpers.ts', null),
    ];
    const edges = [
      makeEdge(
        '/project/src/shared/utils.ts',
        '/project/src/shared/helpers.ts',
      ),
    ];
    const violations = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      config,
    );
    expect(violations).toHaveLength(0);
  });

  it('handles multiple barrel file types', () => {
    const configWithMultipleBarrels: FeatureBoundariesConfig = {
      ...config,
      barrelFiles: ['index.ts', 'index.tsx'],
    };
    const files = [
      makeFileInfo('/project/src/features/billing/invoice.ts', 'billing'),
      makeFileInfo('/project/src/features/auth/index.tsx', 'auth', true),
    ];
    const edges = [
      makeEdge(
        '/project/src/features/billing/invoice.ts',
        '/project/src/features/auth/index.tsx',
        '../auth/index',
      ),
    ];
    const violations = validateFeatureBoundaries(
      makeGraph(edges),
      files,
      configWithMultipleBarrels,
    );
    expect(violations).toHaveLength(0);
  });

  it('uses originalPath from normalizedToOriginalPath when available', () => {
    const normalizedFrom = '/project/src/features/billing/invoice';
    const normalizedTo = '/project/src/features/auth/service';
    const originalFrom = '/project/src/features/billing/invoice.ts';
    const originalTo = '/project/src/features/auth/service.ts';

    const files = [
      makeFileInfo(originalFrom, 'billing'),
      makeFileInfo(originalTo, 'auth'),
    ];
    const normalizedToOriginalPath = new Map([
      [normalizedFrom, originalFrom],
      [normalizedTo, originalTo],
    ]);
    const edges = [makeEdge(normalizedFrom, normalizedTo, '../auth/service')];
    const graph: DependencyGraph = {
      nodes: new Set([normalizedFrom, normalizedTo]),
      edges,
      adjacencyList: new Map([[normalizedFrom, new Set([normalizedTo])]]),
      normalizedToOriginalPath,
    };

    const violations = validateFeatureBoundaries(graph, files, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(originalFrom);
  });

  it('returns no violations for an empty graph', () => {
    const violations = validateFeatureBoundaries(
      { nodes: new Set(), edges: [], adjacencyList: new Map() },
      [],
      config,
    );
    expect(violations).toHaveLength(0);
  });
});
