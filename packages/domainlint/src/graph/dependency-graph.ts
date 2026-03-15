import { extname } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import type { ParseResult } from '../parser/types.js';
import type { ResolvedImport } from '../resolution/module-resolver.js';
import { ModuleResolver } from '../resolution/module-resolver.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';
import type { DependencyEdge, DependencyGraph } from './types.js';

export class DependencyGraphBuilder {
  private resolver: ModuleResolver;

  constructor(
    private config: FeatureBoundariesConfig,
    tsconfig: ResolvedTsConfig,
    fs: FileSystem = nodeFileSystem,
  ) {
    this.resolver = new ModuleResolver(config, tsconfig, fs);
  }

  /**
   * Normalize file paths by removing extensions to prevent false positive cycles
   * when the same module is imported with and without extensions
   */
  private normalizeModulePath(filePath: string): string {
    const ext = extname(filePath);
    const allowedExtensions = this.config.extensions;

    // Remove extension if it's a TypeScript/JavaScript file extension
    if (allowedExtensions.includes(ext)) {
      return filePath.slice(0, -ext.length);
    }

    return filePath;
  }

  /**
   * Determine the node key for a file path. Files that collide after
   * extension stripping (e.g. Foo.ts and Foo.tsx) keep their full
   * original path to avoid being merged into a single graph node.
   */
  private getNodeKey(filePath: string, collisions: Set<string>): string {
    const normalized = this.normalizeModulePath(filePath);
    return collisions.has(normalized) ? filePath : normalized;
  }

  async buildGraph(
    files: FileInfo[],
    parseResults: ParseResult[],
  ): Promise<DependencyGraph> {
    const nodes = new Set<string>();
    const edges: DependencyEdge[] = [];
    const adjacencyList = new Map<string, Set<string>>();

    // Track mapping from node keys to original paths
    const normalizedToOriginal = new Map<string, string>();

    // Detect collisions: multiple files that normalize to the same path
    const normalizedCount = new Map<string, number>();
    for (const file of files) {
      const normalized = this.normalizeModulePath(file.path);
      normalizedCount.set(
        normalized,
        (normalizedCount.get(normalized) || 0) + 1,
      );
    }
    const collisions = new Set<string>();
    for (const [normalized, count] of normalizedCount) {
      if (count > 1) {
        collisions.add(normalized);
      }
    }

    // Add all files as nodes
    for (const file of files) {
      const nodeKey = this.getNodeKey(file.path, collisions);
      nodes.add(nodeKey);
      adjacencyList.set(nodeKey, new Set());
      normalizedToOriginal.set(nodeKey, file.path);
    }

    // Process each file's imports
    for (const parseResult of parseResults) {
      const fromFile = parseResult.filePath;
      const fromKey = this.getNodeKey(fromFile, collisions);

      for (const importInfo of parseResult.imports) {
        const resolved = await this.resolver.resolveImport(
          importInfo.specifier,
          fromFile,
        );

        // Only include edges to local files
        if (!resolved.isExternal && resolved.resolvedPath) {
          const toKey = this.getNodeKey(resolved.resolvedPath, collisions);

          if (nodes.has(toKey)) {
            const edge: DependencyEdge = {
              from: fromKey,
              to: toKey,
              importInfo,
            };

            edges.push(edge);

            // Update adjacency list
            const fromAdjacency = adjacencyList.get(fromKey);
            if (fromAdjacency) {
              fromAdjacency.add(toKey);
            }
          }
        }
      }
    }

    return {
      nodes,
      edges,
      adjacencyList,
      normalizedToOriginalPath: normalizedToOriginal,
    };
  }
}
