import { describe, expect, it } from 'vitest';
import { GraphQuery } from '../graph/graph-query.js';
import type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from '../graph/types.js';
import { createDefaultConfig } from '../test-utils/setup.js';
import { runCustomRules } from './custom-rules.js';
import { cycleRule } from './cycle-detector.js';

function makeGraph(
  edges: [string, string][],
  normalizedToOriginalPath?: Map<string, string>,
): DependencyGraph {
  const nodes = new Set<string>();
  const adjacencyList = new Map<string, Set<string>>();
  const graphEdges: DependencyEdge[] = [];

  for (const [from, to] of edges) {
    nodes.add(from);
    nodes.add(to);
    if (!adjacencyList.has(from)) adjacencyList.set(from, new Set());
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

  for (const node of nodes) {
    if (!adjacencyList.has(node)) adjacencyList.set(node, new Set());
  }

  return { nodes, edges: graphEdges, adjacencyList, normalizedToOriginalPath };
}

async function detectCycles(graph: DependencyGraph): Promise<Violation[]> {
  const config = createDefaultConfig();
  const query = new GraphQuery(graph, config);
  return runCustomRules([cycleRule], { graph, query, config });
}

describe('cycleRule', () => {
  it('has the expected rule name', () => {
    expect(cycleRule.name).toBe('import-cycles');
  });

  it('returns no violations for an empty graph', async () => {
    const graph: DependencyGraph = {
      nodes: new Set(),
      edges: [],
      adjacencyList: new Map(),
    };
    expect(await detectCycles(graph)).toHaveLength(0);
  });

  it('returns no violations for a linear graph', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(await detectCycles(graph)).toHaveLength(0);
  });

  it('returns no violations for a DAG with shared nodes', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['c', 'd'],
    ]);
    expect(await detectCycles(graph)).toHaveLength(0);
  });

  it('detects a self-loop', async () => {
    const graph = makeGraph([['a', 'a']]);
    const violations = await detectCycles(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_IMPORT_CYCLE');
    expect(violations[0].file).toBe('a');
    expect(violations[0].message).toMatch(/import cycle/i);
  });

  it('detects a simple 2-node cycle', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const violations = await detectCycles(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_IMPORT_CYCLE');
    expect(violations[0].message).toContain('a');
    expect(violations[0].message).toContain('b');
  });

  it('detects a 3-node cycle', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ]);
    const violations = await detectCycles(graph);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ARCH_IMPORT_CYCLE');
    expect(violations[0].message).toContain('a');
    expect(violations[0].message).toContain('b');
    expect(violations[0].message).toContain('c');
  });

  it('detects two independent cycles', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['b', 'a'],
      ['c', 'd'],
      ['d', 'c'],
    ]);
    const violations = await detectCycles(graph);
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.code === 'ARCH_IMPORT_CYCLE')).toBe(true);
  });

  it('does not report the same cycle start twice', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const violations = await detectCycles(graph);
    const files = violations.map((v) => v.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('includes line information from the first edge of the cycle', async () => {
    const graph = makeGraph([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const [violation] = await detectCycles(graph);
    expect(typeof violation.line).toBe('number');
    expect(typeof violation.col).toBe('number');
  });

  it('uses original paths from normalizedToOriginalPath map when available', async () => {
    const normalizedToOriginalPath = new Map([
      ['a', '/project/src/a.ts'],
      ['b', '/project/src/b.ts'],
    ]);
    const graph = makeGraph(
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
      normalizedToOriginalPath,
    );
    const [violation] = await detectCycles(graph);
    expect(violation.file).toBe('/project/src/a.ts');
    expect(violation.message).toContain('/project/src/a.ts');
    expect(violation.message).toContain('/project/src/b.ts');
  });
});
