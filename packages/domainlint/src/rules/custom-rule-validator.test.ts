import { describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { DependencyEdge, DependencyGraph } from '../graph/types.js';
import { validateCustomRules } from './custom-rule-validator.js';

const baseConfig: FeatureBoundariesConfig = {
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
      line: 5,
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

describe('validateCustomRules', () => {
  it('returns no violations when no custom rules are configured', () => {
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
      ),
    ]);
    const violations = validateCustomRules(graph, baseConfig);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when customRules is empty', () => {
    const config = { ...baseConfig, customRules: [] };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
      ),
    ]);
    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(0);
  });

  it('reports a violation when an edge matches a deny rule', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
          message: 'Features must not import from shared lib directly',
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
        '../../lib/utils',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_CUSTOM_RULE');
    expect(violations[0].file).toBe('/project/src/features/auth/service.ts');
    expect(violations[0].message).toBe(
      'Features must not import from shared lib directly',
    );
  });

  it('does not report when edge does not match deny pattern', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/features/auth/utils.ts',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(0);
  });

  it('does not report when source file does not match from pattern', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
        },
      ],
    };
    const graph = makeGraph([
      makeEdge('/project/src/pages/home.ts', '/project/src/lib/utils.ts'),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(0);
  });

  it('reports a violation when an edge target is not in the allow list', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          allow: ['src/features/**', 'src/shared/**'],
          message: 'Features can only import from features or shared',
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
        '../../lib/utils',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toBe(
      'Features can only import from features or shared',
    );
  });

  it('does not report when edge target is in the allow list', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          allow: ['src/features/**', 'src/shared/**'],
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/shared/helpers.ts',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(0);
  });

  it('uses the configured level on violations', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
          level: 'warn',
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].level).toBe('warn');
  });

  it('defaults to error level when not specified', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations[0].level).toBe('error');
  });

  it('generates a default message when none is provided', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
        '../../lib/utils',
      ),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations[0].message).toContain('../../lib/utils');
    expect(violations[0].message).toContain('not allowed by custom rule');
  });

  it('evaluates multiple custom rules independently', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
          message: 'Rule 1',
        },
        {
          from: 'src/pages/**',
          deny: ['src/internal/**'],
          message: 'Rule 2',
        },
      ],
    };
    const graph = makeGraph([
      makeEdge(
        '/project/src/features/auth/service.ts',
        '/project/src/lib/utils.ts',
      ),
      makeEdge('/project/src/pages/home.ts', '/project/src/internal/secret.ts'),
    ]);

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(2);
    expect(violations[0].message).toBe('Rule 1');
    expect(violations[1].message).toBe('Rule 2');
  });

  it('uses normalizedToOriginalPath when available', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
        },
      ],
    };
    const normalizedFrom = '/project/src/features/auth/service';
    const normalizedTo = '/project/src/lib/utils';
    const originalFrom = '/project/src/features/auth/service.ts';
    const originalTo = '/project/src/lib/utils.ts';

    const edges = [makeEdge(normalizedFrom, normalizedTo, '../../lib/utils')];
    const graph: DependencyGraph = {
      nodes: new Set([normalizedFrom, normalizedTo]),
      edges,
      adjacencyList: new Map([[normalizedFrom, new Set([normalizedTo])]]),
      normalizedToOriginalPath: new Map([
        [normalizedFrom, originalFrom],
        [normalizedTo, originalTo],
      ]),
    };

    const violations = validateCustomRules(graph, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(originalFrom);
  });

  it('reports line and column from the import edge', () => {
    const config: FeatureBoundariesConfig = {
      ...baseConfig,
      customRules: [
        {
          from: 'src/features/**',
          deny: ['src/lib/**'],
        },
      ],
    };
    const edge = makeEdge(
      '/project/src/features/auth/service.ts',
      '/project/src/lib/utils.ts',
    );
    edge.importInfo.line = 42;
    edge.importInfo.col = 7;
    const graph = makeGraph([edge]);

    const violations = validateCustomRules(graph, config);
    expect(violations[0].line).toBe(42);
    expect(violations[0].col).toBe(7);
  });
});
