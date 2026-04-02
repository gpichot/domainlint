import type { WorkspaceRule } from './workspace-rules.js';

/**
 * Built-in workspace rule that detects circular dependencies between packages.
 *
 * Builds a directed graph of package-level dependencies from the import edges
 * and reports any cycles found using DFS.
 */
export const packageCycleRule: WorkspaceRule = {
  name: 'package-cycles',
  check({ edges, emitViolation }) {
    // Build package-level adjacency list
    const adjacencyList = new Map<string, Set<string>>();
    // Track one representative edge per (from → to) pair for violation reporting
    const representativeEdge = new Map<
      string,
      { file: string; specifier: string; line: number; col: number }
    >();

    for (const edge of edges) {
      if (!adjacencyList.has(edge.fromPackage)) {
        adjacencyList.set(edge.fromPackage, new Set());
      }
      adjacencyList.get(edge.fromPackage)!.add(edge.toPackage);

      const edgeKey = `${edge.fromPackage}::${edge.toPackage}`;
      if (!representativeEdge.has(edgeKey)) {
        representativeEdge.set(edgeKey, {
          file: edge.file,
          specifier: edge.specifier,
          line: edge.line,
          col: edge.col,
        });
      }
    }

    // Find all cycles using DFS
    const allNodes = new Set<string>();
    for (const edge of edges) {
      allNodes.add(edge.fromPackage);
      allNodes.add(edge.toPackage);
    }

    const globalVisited = new Set<string>();
    const allCycles: string[][] = [];

    for (const node of allNodes) {
      if (globalVisited.has(node)) continue;

      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      const pathStack: string[] = [];

      const cycles = findCyclesDFS(
        node,
        adjacencyList,
        visited,
        recursionStack,
        pathStack,
        globalVisited,
      );

      allCycles.push(...cycles);
    }

    // Deduplicate: normalize each cycle to a canonical sorted key
    const uniqueCycles: string[][] = [];
    const seen = new Set<string>();
    for (const cycle of allCycles) {
      const nodes = cycle.slice(0, -1);
      const key = [...nodes].sort().join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueCycles.push(cycle);
    }

    // Filter out cycles that are supersets of shorter ones.
    // If A→B→A exists, don't also report A→B→C→A.
    const sortedByLength = [...uniqueCycles].sort(
      (a, b) => a.length - b.length,
    );
    const minimalCycles: string[][] = [];
    const minimalNodeSets: Set<string>[] = [];

    for (const cycle of sortedByLength) {
      const nodes = new Set(cycle.slice(0, -1));
      const isSuperset = minimalNodeSets.some((smaller) => {
        if (smaller.size >= nodes.size) return false;
        for (const n of smaller) {
          if (!nodes.has(n)) return false;
        }
        return true;
      });

      if (!isSuperset) {
        minimalCycles.push(cycle);
        minimalNodeSets.push(nodes);
      }
    }

    for (const cycle of minimalCycles) {
      const cycleDisplay = cycle.join(' -> ');
      const edgeKey = `${cycle[0]}::${cycle[1]}`;
      const edge = representativeEdge.get(edgeKey);

      emitViolation({
        code: 'noPackageCycle',
        file: edge?.file ?? cycle[0],
        line: edge?.line ?? 1,
        col: edge?.col ?? 1,
        message: `Package cycle detected: ${cycleDisplay}`,
      });
    }
  },
};

function findCyclesDFS(
  node: string,
  adjacencyList: Map<string, Set<string>>,
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
  const neighbors = adjacencyList.get(node) || new Set();

  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      const found = findCyclesDFS(
        neighbor,
        adjacencyList,
        visited,
        recursionStack,
        pathStack,
        globalVisited,
      );
      cycles.push(...found);
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
