import { dirname } from 'node:path';
import { ResolverFactory } from 'oxc-resolver';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';

export interface ResolvedImport {
  originalSpecifier: string;
  resolvedPath: string | null;
  isExternal: boolean;
}

export class ModuleResolver {
  private resolver: ResolverFactory;
  private resolutionCache = new Map<string, ResolvedImport>();

  constructor(config: FeatureBoundariesConfig, tsconfig: ResolvedTsConfig) {
    const tsconfigOption = config.tsconfigPath
      ? { configFile: config.tsconfigPath, references: 'auto' as const }
      : undefined;

    this.resolver = new ResolverFactory({
      tsconfig: tsconfigOption,
      extensions: config.extensions,
      mainFiles: config.barrelFiles.map((b) => b.replace(/\.[^.]+$/, '')),
      conditionNames: ['node', 'import', 'require'],
    });
  }

  async resolveImport(
    specifier: string,
    fromFile: string,
  ): Promise<ResolvedImport> {
    const cacheKey = `${specifier}::${fromFile}`;
    const cached = this.resolutionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const fromDir = dirname(fromFile);
    const resolved = this.resolver.sync(fromDir, specifier);

    let result: ResolvedImport;

    if (resolved.path) {
      // Check if it resolved into node_modules — treat as external
      if (resolved.path.includes('/node_modules/')) {
        result = {
          originalSpecifier: specifier,
          resolvedPath: null,
          isExternal: true,
        };
      } else {
        result = {
          originalSpecifier: specifier,
          resolvedPath: resolved.path,
          isExternal: false,
        };
      }
    } else if (resolved.error) {
      // Could not resolve — treat as external (npm package or node builtin)
      result = {
        originalSpecifier: specifier,
        resolvedPath: null,
        isExternal: true,
      };
    } else {
      result = {
        originalSpecifier: specifier,
        resolvedPath: null,
        isExternal: true,
      };
    }

    this.resolutionCache.set(cacheKey, result);
    return result;
  }
}
