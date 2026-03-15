import { extname } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
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
  ) {
    this.resolver = new ModuleResolver(config, tsconfig);
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

    // Add all files as nodes (using normalized paths)
    for (const file of files) {
      const normalizedPath = this.normalizeModulePath(file.path);
      nodes.add(normalizedPath);
      adjacencyList.set(normalizedPath, new Set());
      normalizedToOriginal.set(normalizedPath, file.path);
    }

    // Process each file's imports
    for (const parseResult of parseResults) {
      const fromFile = parseResult.filePath;
      const normalizedFromFile = this.normalizeModulePath(fromFile);

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

          if (nodes.has(normalizedResolvedPath)) {
            const edge: DependencyEdge = {
              from: normalizedFromFile,
              to: normalizedResolvedPath,
              importInfo,
            };

            edges.push(edge);

            // Update adjacency list
            const fromAdjacency = adjacencyList.get(normalizedFromFile);
            if (fromAdjacency) {
              fromAdjacency.add(normalizedResolvedPath);
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
