import { relative } from 'node:path';
import { minimatch } from 'minimatch';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import { getBarrelPath, getFeature } from '../files/file-discovery.js';
import type { DependencyEdge, DependencyGraph } from './types.js';

export interface EdgeQueryResult {
  edges: DependencyEdge[];
  violations(
    code: string,
    message: string | ((edge: DependencyEdge) => string),
  ): {
    code: string;
    file: string;
    line: number;
    col: number;
    message: string;
  }[];
}

function matchesGlob(
  filePath: string,
  pattern: string,
  rootDir: string,
): boolean {
  const rel = relative(rootDir, filePath);
  return minimatch(rel, pattern);
}

function createEdgeQueryResult(edges: DependencyEdge[]): EdgeQueryResult {
  return {
    edges,
    violations(code, message) {
      return edges.map((edge) => ({
        code,
        file: edge.from,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: typeof message === 'function' ? message(edge) : message,
      }));
    },
  };
}

export class GraphQuery {
  private reverseAdjacencyList: Map<string, Set<string>> | null = null;
  private fileInfoMap: Map<string, FileInfo> | null = null;

  constructor(
    private graph: DependencyGraph,
    private config: FeatureBoundariesConfig,
    files?: FileInfo[],
  ) {
    if (files) {
      this.fileInfoMap = new Map<string, FileInfo>();
      for (const file of files) {
        this.fileInfoMap.set(file.path, file);
        if (graph.normalizedToOriginalPath) {
          for (const [normalized, original] of graph.normalizedToOriginalPath) {
            if (original === file.path) {
              this.fileInfoMap.set(normalized, file);
              break;
            }
          }
        }
      }
    }
  }

  // --- Edge querying ---

  edgesFrom(glob: string): EdgeQueryResult {
    const filtered = this.graph.edges.filter((e) =>
      matchesGlob(e.from, glob, this.config.rootDir),
    );
    return createEdgeQueryResult(filtered);
  }

  edgesTo(glob: string): EdgeQueryResult {
    const filtered = this.graph.edges.filter((e) =>
      matchesGlob(e.to, glob, this.config.rootDir),
    );
    return createEdgeQueryResult(filtered);
  }

  edgesBetween(fromGlob: string, toGlob: string): EdgeQueryResult {
    const filtered = this.graph.edges.filter(
      (e) =>
        matchesGlob(e.from, fromGlob, this.config.rootDir) &&
        matchesGlob(e.to, toGlob, this.config.rootDir),
    );
    return createEdgeQueryResult(filtered);
  }

  // --- Node querying ---

  filesMatching(glob: string): string[] {
    return [...this.graph.nodes].filter((n) =>
      matchesGlob(n, glob, this.config.rootDir),
    );
  }

  featureOf(file: string): string | null {
    return getFeature(file, this.config);
  }

  importsOf(file: string): string[] {
    return [...(this.graph.adjacencyList.get(file) ?? [])];
  }

  importersOf(file: string): string[] {
    return [...(this.getReverseAdjacencyList().get(file) ?? [])];
  }

  // --- Transitive analysis ---

  dependsOn(file: string, target: string): boolean {
    const visited = new Set<string>();
    const stack = [file];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of this.graph.adjacencyList.get(current) ?? []) {
        stack.push(neighbor);
      }
    }
    return false;
  }

  dependenciesOf(file: string): string[] {
    const visited = new Set<string>();
    const stack = [...(this.graph.adjacencyList.get(file) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of this.graph.adjacencyList.get(current) ?? []) {
        stack.push(neighbor);
      }
    }
    return [...visited];
  }

  dependentsOf(file: string): string[] {
    const reverse = this.getReverseAdjacencyList();
    const visited = new Set<string>();
    const stack = [...(reverse.get(file) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of reverse.get(current) ?? []) {
        stack.push(neighbor);
      }
    }
    return [...visited];
  }

  // --- Aggregates ---

  fanOut(file: string): number {
    return this.graph.adjacencyList.get(file)?.size ?? 0;
  }

  fanIn(file: string): number {
    return this.getReverseAdjacencyList().get(file)?.size ?? 0;
  }

  // --- File info ---

  fileInfo(file: string): FileInfo | undefined {
    return this.fileInfoMap?.get(file);
  }

  isBarrel(file: string): boolean {
    return this.fileInfoMap?.get(file)?.isBarrel ?? false;
  }

  barrelPathFor(feature: string): string {
    return getBarrelPath(feature, this.config);
  }

  originalPath(file: string): string {
    return this.graph.normalizedToOriginalPath?.get(file) ?? file;
  }

  // --- Internal ---

  private getReverseAdjacencyList(): Map<string, Set<string>> {
    if (this.reverseAdjacencyList) return this.reverseAdjacencyList;

    const reverse = new Map<string, Set<string>>();
    for (const [node, neighbors] of this.graph.adjacencyList) {
      for (const neighbor of neighbors) {
        if (!reverse.has(neighbor)) {
          reverse.set(neighbor, new Set());
        }
        reverse.get(neighbor)!.add(node);
      }
    }
    this.reverseAdjacencyList = reverse;
    return reverse;
  }
}
