import type { DependencyGraph } from '../graph/types.js';
import type { Rule } from './rules.js';

export const cycleRule: Rule = {
  name: 'import-cycles',
  check({ graph, emitViolation }) {
    const globalVisited = new Set<string>();
    const reportedCycleStarts = new Set<string>();

    for (const node of graph.nodes) {
      if (!globalVisited.has(node)) {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const pathStack: string[] = [];

        const cycles = findAllCyclesDFS(
          node,
          graph,
          visited,
          recursionStack,
          pathStack,
          globalVisited,
        );

        for (const cycle of cycles) {
          const startFile = cycle[0];
          if (!reportedCycleStarts.has(startFile)) {
            const originalCycle = cycle.map(
              (path) => graph.normalizedToOriginalPath?.get(path) || path,
            );
            const cycleDisplay = originalCycle.join(' -> ');

            const firstEdge = graph.edges.find(
              (edge) => edge.from === cycle[0] && edge.to === cycle[1],
            );

            emitViolation({
              code: 'ARCH_IMPORT_CYCLE',
              file: graph.normalizedToOriginalPath?.get(cycle[0]) || cycle[0],
              line: firstEdge?.importInfo.line || 1,
              col: firstEdge?.importInfo.col || 1,
              message: `Import cycle detected: ${cycleDisplay}`,
            });
            reportedCycleStarts.add(startFile);
          }
        }
      }
    }
  },
};

function findAllCyclesDFS(
  node: string,
  graph: DependencyGraph,
  visited: Set<string>,
  recursionStack: Set<string>,
  pathStack: string[],
  globalVisited: Set<string>,
): string[][] {
  visited.add(node);
  globalVisited.add(node);
  recursionStack.add(node);
  pathStack.push(node);

  const cycles: string[][] = [];
  const neighbors = graph.adjacencyList.get(node) || new Set();

  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      const foundCycles = findAllCyclesDFS(
        neighbor,
        graph,
        visited,
        recursionStack,
        pathStack,
        globalVisited,
      );
      cycles.push(...foundCycles);
    } else if (recursionStack.has(neighbor)) {
      const cycleStartIndex = pathStack.indexOf(neighbor);
      const cycle = pathStack.slice(cycleStartIndex).concat([neighbor]);
      cycles.push(cycle);
    }
  }

  recursionStack.delete(node);
  pathStack.pop();
  return cycles;
}
