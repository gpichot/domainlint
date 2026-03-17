import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { GraphQuery } from '../graph/graph-query.js';
import type { DependencyGraph } from '../graph/types.js';
import { createDefaultConfig } from '../test-utils/setup.js';
import {
  findRulesFile,
  loadRules,
  type Rule,
  type RuleContext,
  runRules,
} from './rules.js';

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

function createMockFileSystem(files: Record<string, string>) {
  vol.reset();
  vol.fromJSON(files);
}

function createMockGraph(
  overrides: Partial<DependencyGraph> = {},
): DependencyGraph {
  return {
    nodes: new Set<string>(),
    edges: [],
    adjacencyList: new Map(),
    ...overrides,
  };
}

function createContext(
  graph: DependencyGraph,
  config: FeatureBoundariesConfig,
) {
  return { graph, query: new GraphQuery(graph, config), config };
}

describe('findRulesFile', () => {
  beforeEach(() => {
    vol.reset();
  });

  it('should find domainlint.rules.ts in project root', async () => {
    createMockFileSystem({
      '/project/domainlint.rules.ts': 'export const rules = [];',
    });

    const result = await findRulesFile('/project');
    expect(result).toBe('/project/domainlint.rules.ts');
  });

  it('should find domainlint.rules.js as fallback', async () => {
    createMockFileSystem({
      '/project/domainlint.rules.js': 'export const rules = [];',
    });

    const result = await findRulesFile('/project');
    expect(result).toBe('/project/domainlint.rules.js');
  });

  it('should prefer .ts over .js', async () => {
    createMockFileSystem({
      '/project/domainlint.rules.ts': 'export const rules = [];',
      '/project/domainlint.rules.js': 'export const rules = [];',
    });

    const result = await findRulesFile('/project');
    expect(result).toBe('/project/domainlint.rules.ts');
  });

  it('should return null when no rules file exists', async () => {
    createMockFileSystem({
      '/project/src/app.ts': 'export const x = 1;',
    });

    const result = await findRulesFile('/project');
    expect(result).toBeNull();
  });

  it('should use explicit rulesFile path from config', async () => {
    createMockFileSystem({
      '/project/custom/my-rules.ts': 'export const rules = [];',
    });

    const result = await findRulesFile('/project', 'custom/my-rules.ts');
    expect(result).toBe('/project/custom/my-rules.ts');
  });

  it('should throw when explicit rulesFile does not exist', async () => {
    createMockFileSystem({
      '/project/src/app.ts': 'export const x = 1;',
    });

    await expect(findRulesFile('/project', 'missing-rules.ts')).rejects.toThrow(
      'Rules file not found',
    );
  });
});

describe('runRules', () => {
  it('should collect violations emitted by a rule', async () => {
    const graph = createMockGraph({
      nodes: new Set(['/project/src/a.ts', '/project/src/b.ts']),
      edges: [
        {
          from: '/project/src/a.ts',
          to: '/project/src/b.ts',
          importInfo: {
            specifier: './b',
            line: 1,
            col: 0,
            isDynamic: false,
            isTypeOnly: false,
          },
        },
      ],
    });
    const config = createDefaultConfig();

    const rule: Rule = {
      name: 'no-import-b',
      check({ graph, emitViolation }) {
        for (const edge of graph.edges) {
          if (edge.to.includes('/b.ts')) {
            emitViolation({
              code: 'CUSTOM_NO_IMPORT_B',
              file: edge.from,
              line: edge.importInfo.line,
              col: edge.importInfo.col,
              message: 'Do not import b.ts',
            });
          }
        }
      },
    };

    const violations = await runRules([rule], createContext(graph, config));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('CUSTOM_NO_IMPORT_B');
    expect(violations[0].file).toBe('/project/src/a.ts');
    expect(violations[0].message).toBe('Do not import b.ts');
  });

  it('should auto-generate violation code from rule name when not provided', async () => {
    const graph = createMockGraph({
      nodes: new Set(['/project/src/a.ts']),
    });
    const config = createDefaultConfig();

    const rule: Rule = {
      name: 'my-rule',
      check({ emitViolation }) {
        emitViolation({
          file: '/project/src/a.ts',
          line: 1,
          col: 0,
          message: 'test',
        });
      },
    };

    const violations = await runRules([rule], createContext(graph, config));
    expect(violations[0].code).toBe('CUSTOM_MY_RULE');
  });

  it('should handle async rules', async () => {
    const graph = createMockGraph();
    const config = createDefaultConfig();

    const rule: Rule = {
      name: 'async-rule',
      async check({ emitViolation }) {
        emitViolation({
          code: 'ASYNC_VIOLATION',
          file: '/project/src/a.ts',
          line: 1,
          col: 0,
          message: 'async violation',
        });
      },
    };

    const violations = await runRules([rule], createContext(graph, config));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ASYNC_VIOLATION');
  });

  it('should run multiple rules and combine violations', async () => {
    const graph = createMockGraph({
      nodes: new Set(['/project/src/a.ts']),
      edges: [
        {
          from: '/project/src/a.ts',
          to: '/project/src/b.ts',
          importInfo: {
            specifier: './b',
            line: 1,
            col: 0,
            isDynamic: false,
            isTypeOnly: false,
          },
        },
      ],
    });
    const config = createDefaultConfig();

    const rule1: Rule = {
      name: 'rule-1',
      check({ emitViolation }) {
        emitViolation({
          code: 'R1',
          file: '/a.ts',
          line: 1,
          col: 0,
          message: 'r1',
        });
      },
    };
    const rule2: Rule = {
      name: 'rule-2',
      check({ emitViolation }) {
        emitViolation({
          code: 'R2',
          file: '/b.ts',
          line: 2,
          col: 0,
          message: 'r2',
        });
      },
    };

    const violations = await runRules(
      [rule1, rule2],
      createContext(graph, config),
    );
    expect(violations).toHaveLength(2);
    expect(violations[0].code).toBe('R1');
    expect(violations[1].code).toBe('R2');
  });

  it('should return empty array when rule emits no violations', async () => {
    const graph = createMockGraph();
    const config = createDefaultConfig();

    const rule: Rule = {
      name: 'clean-rule',
      check() {
        // no violations emitted
      },
    };

    const violations = await runRules([rule], createContext(graph, config));
    expect(violations).toHaveLength(0);
  });

  it('should throw when a rule throws', async () => {
    const graph = createMockGraph();
    const config = createDefaultConfig();

    const rule: Rule = {
      name: 'broken-rule',
      check() {
        throw new Error('Rule exploded');
      },
    };

    await expect(
      runRules([rule], createContext(graph, config)),
    ).rejects.toThrow('Rule "broken-rule" threw an error: Rule exploded');
  });

  it('should provide graph, query, config, and emitViolation to rule', async () => {
    const graph = createMockGraph({
      nodes: new Set(['/project/src/a.ts', '/project/src/b.ts']),
      edges: [
        {
          from: '/project/src/a.ts',
          to: '/project/src/b.ts',
          importInfo: {
            specifier: './b',
            line: 1,
            col: 0,
            isDynamic: false,
            isTypeOnly: false,
          },
        },
      ],
    });
    const config = createDefaultConfig({ featuresDir: '/project/src/domains' });

    let receivedContext: RuleContext | null = null;
    const rule: Rule = {
      name: 'spy-rule',
      check(ctx) {
        receivedContext = ctx;
      },
    };

    await runRules([rule], createContext(graph, config));

    expect(receivedContext).not.toBeNull();
    expect(receivedContext!.graph).toBe(graph);
    expect(receivedContext!.query).toBeInstanceOf(GraphQuery);
    expect(receivedContext!.config).toBe(config);
    expect(receivedContext!.config.featuresDir).toBe('/project/src/domains');
    expect(typeof receivedContext!.emitViolation).toBe('function');
  });

  it('should work with emitViolation and query together', async () => {
    const graph = createMockGraph({
      nodes: new Set(['/project/src/a.ts', '/project/src/b.ts']),
      edges: [
        {
          from: '/project/src/a.ts',
          to: '/project/src/b.ts',
          importInfo: {
            specifier: './b',
            line: 3,
            col: 0,
            isDynamic: false,
            isTypeOnly: false,
          },
        },
      ],
      adjacencyList: new Map([
        ['/project/src/a.ts', new Set(['/project/src/b.ts'])],
      ]),
    });
    const config = createDefaultConfig();

    const rule: Rule = {
      name: 'no-b-imports',
      check({ query, emitViolation }) {
        for (const edge of query.edgesTo('src/b.ts').edges) {
          emitViolation({
            code: 'NO_B',
            file: edge.from,
            line: edge.importInfo.line,
            col: edge.importInfo.col,
            message: 'Do not import b.ts',
          });
        }
      },
    };

    const violations = await runRules([rule], createContext(graph, config));
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('NO_B');
    expect(violations[0].line).toBe(3);
  });
});
