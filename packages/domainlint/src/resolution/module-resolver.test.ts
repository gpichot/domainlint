import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';
import { ModuleResolver } from './module-resolver.js';

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

beforeEach(() => vol.reset());

const baseConfig: FeatureBoundariesConfig = {
  rootDir: '/project',
  srcDir: '/project/src',
  featuresDir: '/project/src/features',
  barrelFiles: ['index.ts'],
  extensions: ['.ts', '.tsx'],
  tsconfigPath: '/project/tsconfig.json',
  exclude: [],
  includeDynamicImports: false,
};

const baseTsconfig: ResolvedTsConfig = {
  rootDir: '/project',
};

describe('ModuleResolver', () => {
  describe('external package detection', () => {
    it('marks npm packages as external', async () => {
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        'lodash',
        '/project/src/a.ts',
      );
      expect(result.isExternal).toBe(true);
      expect(result.resolvedPath).toBeNull();
    });

    it('marks node: built-ins as external', async () => {
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        'node:fs',
        '/project/src/a.ts',
      );
      expect(result.isExternal).toBe(true);
    });

    it('marks bare node built-in names as external', async () => {
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      for (const builtin of ['fs', 'path', 'os', 'crypto']) {
        const result = await resolver.resolveImport(
          builtin,
          '/project/src/a.ts',
        );
        expect(result.isExternal).toBe(true);
      }
    });

    it('preserves the original specifier in the result', async () => {
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport('react', '/project/src/a.ts');
      expect(result.originalSpecifier).toBe('react');
    });
  });

  describe('relative path resolution', () => {
    it('resolves a relative import with explicit extension', async () => {
      vol.fromJSON({ '/project/src/b.ts': 'export const b = 1;' });
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        './b.ts',
        '/project/src/a.ts',
      );
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe('/project/src/b.ts');
    });

    it('resolves a relative import by trying configured extensions', async () => {
      vol.fromJSON({ '/project/src/b.ts': 'export const b = 1;' });
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport('./b', '/project/src/a.ts');
      expect(result.resolvedPath).toBe('/project/src/b.ts');
    });

    it('resolves a .tsx file when listed in extensions', async () => {
      vol.fromJSON({
        '/project/src/Component.tsx': 'export const C = () => null;',
      });
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        './Component',
        '/project/src/a.ts',
      );
      expect(result.resolvedPath).toBe('/project/src/Component.tsx');
    });

    it('resolves a directory import to its barrel file', async () => {
      vol.fromJSON({ '/project/src/utils/index.ts': 'export const u = 1;' });
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        './utils',
        '/project/src/a.ts',
      );
      expect(result.resolvedPath).toBe('/project/src/utils/index.ts');
    });

    it('resolves a parent directory import', async () => {
      vol.fromJSON({ '/project/src/shared.ts': 'export const s = 1;' });
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        '../../shared',
        '/project/src/features/auth/service.ts',
      );
      expect(result.resolvedPath).toBe('/project/src/shared.ts');
    });

    it('returns null resolvedPath when file does not exist', async () => {
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result = await resolver.resolveImport(
        './missing',
        '/project/src/a.ts',
      );
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('tsconfig path mapping', () => {
    it('resolves a path alias defined in tsconfig paths', async () => {
      vol.fromJSON({ '/project/src/shared/utils.ts': 'export const u = 1;' });
      const tsconfig: ResolvedTsConfig = {
        rootDir: '/project',
        baseUrl: 'src',
        paths: { '@shared/*': ['shared/*'] },
      };
      const resolver = new ModuleResolver(baseConfig, tsconfig);
      const result = await resolver.resolveImport(
        '@shared/utils',
        '/project/src/a.ts',
      );
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe('/project/src/shared/utils.ts');
    });

    it('treats unresolvable alias as external when no file matches', async () => {
      const tsconfig: ResolvedTsConfig = {
        rootDir: '/project',
        baseUrl: 'src',
        paths: { '@missing/*': ['missing/*'] },
      };
      const resolver = new ModuleResolver(baseConfig, tsconfig);
      const result = await resolver.resolveImport(
        '@missing/foo',
        '/project/src/a.ts',
      );
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('caching', () => {
    it('returns the same result for the same specifier + fromFile pair', async () => {
      vol.fromJSON({ '/project/src/b.ts': '' });
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result1 = await resolver.resolveImport('./b', '/project/src/a.ts');
      const result2 = await resolver.resolveImport('./b', '/project/src/a.ts');
      expect(result1).toBe(result2); // same object reference due to caching
    });

    it('caches external packages', async () => {
      const resolver = new ModuleResolver(baseConfig, baseTsconfig);
      const result1 = await resolver.resolveImport(
        'lodash',
        '/project/src/a.ts',
      );
      const result2 = await resolver.resolveImport(
        'lodash',
        '/project/src/a.ts',
      );
      expect(result1).toBe(result2);
    });
  });
});
