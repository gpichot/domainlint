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

  async buildGraph(
    files: FileInfo[],
    parseResults: ParseResult[],
  ): Promise<DependencyGraph> {
    const nodes = new Set<string>();
    const edges: DependencyEdge[] = [];
    const adjacencyList = new Map<string, Set<string>>();

    // Track mapping from normalized paths to original paths
    const normalizedToOriginal = new Map<string, string>();

    // Detect collisions: multiple files normalizing to the same path (e.g. a.ts + a.tsx)
    const normalizedCount = new Map<string, number>();
    for (const file of files) {
      const normalized = this.normalizeModulePath(file.path);
      normalizedCount.set(
        normalized,
        (normalizedCount.get(normalized) || 0) + 1,
      );
    }
    const collisions = new Set(
      [...normalizedCount.entries()]
        .filter(([, count]) => count > 1)
        .map(([path]) => path),
    );

    // Add all files as nodes (using normalized paths, but keep original for collisions)
    for (const file of files) {
      const normalizedPath = this.normalizeModulePath(file.path);
      const nodeKey = collisions.has(normalizedPath)
        ? file.path
        : normalizedPath;
      nodes.add(nodeKey);
      adjacencyList.set(nodeKey, new Set());
      normalizedToOriginal.set(nodeKey, file.path);
    }

    // Process each file's imports
    for (const parseResult of parseResults) {
      const fromFile = parseResult.filePath;
      const normalizedFromFile = this.normalizeModulePath(fromFile);
      const fromNodeKey = collisions.has(normalizedFromFile)
        ? fromFile
        : normalizedFromFile;

      for (const importInfo of parseResult.imports) {
        const resolved = await this.resolver.resolveImport(
          importInfo.specifier,
          fromFile,
        );

        // Only include edges to local files
        if (!resolved.isExternal && resolved.resolvedPath) {
          const normalizedResolvedPath = this.normalizeModulePath(
            resolved.resolvedPath,
          );
          const toNodeKey = collisions.has(normalizedResolvedPath)
            ? resolved.resolvedPath
            : normalizedResolvedPath;

          if (nodes.has(toNodeKey)) {
            const edge: DependencyEdge = {
              from: fromNodeKey,
              to: toNodeKey,
              importInfo,
            };

            edges.push(edge);

            // Update adjacency list
            const fromAdjacency = adjacencyList.get(fromNodeKey);
            if (fromAdjacency) {
              fromAdjacency.add(toNodeKey);
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
