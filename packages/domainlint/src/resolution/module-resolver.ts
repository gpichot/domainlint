import { dirname, extname, join, resolve } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import { normalizePath } from '../normalize-path.js';
import { resolvePathMapping } from '../tsconfig/tsconfig-loader.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';

export interface ResolvedImport {
  originalSpecifier: string;
  resolvedPath: string | null;
  isExternal: boolean;
}

export class ModuleResolver {
  private fileExistsCache = new Map<string, boolean>();
  private resolutionCache = new Map<string, ResolvedImport>();

  constructor(
    private config: FeatureBoundariesConfig,
    private tsconfig: ResolvedTsConfig,
    private fs: FileSystem = nodeFileSystem,
  ) {}

  async resolveImport(
    specifier: string,
    fromFile: string,
  ): Promise<ResolvedImport> {
    // Create cache key for this specific import context
    const cacheKey = `${specifier}::${fromFile}`;

    // Check resolution cache first
    const cached = this.resolutionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Skip external packages
    if (this.isExternalPackage(specifier)) {
      const result = {
        originalSpecifier: specifier,
        resolvedPath: null,
        isExternal: true,
      };
      this.resolutionCache.set(cacheKey, result);
      return result;
    }

    let resolvedPath: string | null = null;

    // Try relative resolution first
    if (this.isRelativeImport(specifier)) {
      resolvedPath = await this.resolveRelativeImport(specifier, fromFile);
    } else {
      // Try tsconfig path mapping
      resolvedPath = await this.resolvePathMappedImport(specifier, fromFile);
    }

    const result = {
      originalSpecifier: specifier,
      resolvedPath,
      isExternal: resolvedPath === null,
    };

    // Cache the result
    this.resolutionCache.set(cacheKey, result);
    return result;
  }

  private isExternalPackage(specifier: string): boolean {
    // External packages don't start with ./ or ../
    if (this.isRelativeImport(specifier)) {
      return false;
    }

    // Check if it's a Node.js built-in module
    if (specifier.startsWith('node:') || this.isNodeBuiltin(specifier)) {
      return true;
    }

    // If tsconfig path mapping exists for this specifier, it might be internal
    if (this.tsconfig.paths) {
      const mappings = resolvePathMapping(
        specifier,
        this.tsconfig.paths,
        this.tsconfig.baseUrl,
        this.tsconfig.rootDir,
      );
      if (mappings.length > 0) {
        return false;
      }
    }

    // Assume it's an external package if it doesn't start with any common internal patterns
    return true;
  }

  private isRelativeImport(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../');
  }

  private isNodeBuiltin(specifier: string): boolean {
    const builtins = [
      'assert',
      'buffer',
      'child_process',
      'cluster',
      'crypto',
      'dgram',
      'dns',
      'domain',
      'events',
      'fs',
      'http',
      'https',
      'net',
      'os',
      'path',
      'punycode',
      'querystring',
      'readline',
      'stream',
      'string_decoder',
      'tls',
      'tty',
      'url',
      'util',
      'v8',
      'vm',
      'zlib',
    ];
    return builtins.includes(specifier);
  }

  private async resolveRelativeImport(
    specifier: string,
    fromFile: string,
  ): Promise<string | null> {
    const fromDir = dirname(fromFile);
    const targetPath = normalizePath(resolve(fromDir, specifier));

    return await this.resolveFile(targetPath);
  }

  private async resolvePathMappedImport(
    specifier: string,
    fromFile: string,
  ): Promise<string | null> {
    // Try tsconfig path mapping
    if (this.tsconfig.paths && this.tsconfig.baseUrl) {
      const mappings = resolvePathMapping(
        specifier,
        this.tsconfig.paths,
        this.tsconfig.baseUrl,
        this.tsconfig.rootDir,
      );

      for (const mapping of mappings) {
        const resolved = await this.resolveFile(mapping);
        if (resolved) {
          return resolved;
        }
      }
    }

    // Fallback to baseUrl resolution
    if (this.tsconfig.baseUrl) {
      const baseUrlPath = resolve(this.tsconfig.rootDir, this.tsconfig.baseUrl);
      const targetPath = normalizePath(resolve(baseUrlPath, specifier));
      return await this.resolveFile(targetPath);
    }

    return null;
  }

  private async resolveFile(basePath: string): Promise<string | null> {
    // Try exact path first
    if (await this.fileExists(basePath)) {
      return basePath;
    }

    // Try with configured extensions
    for (const ext of this.config.extensions) {
      const pathWithExt = basePath + ext;
      if (await this.fileExists(pathWithExt)) {
        return pathWithExt;
      }
    }

    // Try index files
    for (const barrel of this.config.barrelFiles) {
      const indexPath = normalizePath(join(basePath, barrel));
      if (await this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    // Try index files with extensions
    for (const barrel of this.config.barrelFiles) {
      const barrelName = barrel.replace(extname(barrel), '');
      for (const ext of this.config.extensions) {
        const indexPath = normalizePath(join(basePath, barrelName + ext));
        if (await this.fileExists(indexPath)) {
          return indexPath;
        }
      }
    }

    return null;
  }

  private async fileExists(path: string): Promise<boolean> {
    // Check cache first
    const cached = this.fileExistsCache.get(path);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const stats = await this.fs.stat(path);
      const exists = stats.isFile();
      this.fileExistsCache.set(path, exists);
      return exists;
    } catch {
      this.fileExistsCache.set(path, false);
      return false;
    }
  }
}
