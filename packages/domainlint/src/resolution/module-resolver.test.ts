import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';
import { ModuleResolver } from './module-resolver.js';

let testDir: string;

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

function writeTsConfig(
  relativePath: string,
  config: Record<string, unknown>,
): void {
  writeFile(relativePath, JSON.stringify(config));
}

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `domainlint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  // Write a minimal tsconfig.json
  writeTsConfig('tsconfig.json', { compilerOptions: {} });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeConfig(
  overrides?: Partial<FeatureBoundariesConfig>,
): FeatureBoundariesConfig {
  return {
    rootDir: testDir,
    srcDir: join(testDir, 'src'),
    featuresDir: join(testDir, 'src/features'),
    barrelFiles: ['index.ts'],
    extensions: ['.ts', '.tsx'],
    tsconfigPath: join(testDir, 'tsconfig.json'),
    exclude: [],
    includeDynamicImports: false,
    ...overrides,
  };
}

function makeTsConfig(overrides?: Partial<ResolvedTsConfig>): ResolvedTsConfig {
  return {
    rootDir: testDir,
    ...overrides,
  };
}

describe('ModuleResolver', () => {
  describe('external package detection', () => {
    it('marks npm packages as external', async () => {
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        'lodash',
        join(testDir, 'src/a.ts'),
      );
      expect(result.isExternal).toBe(true);
      expect(result.resolvedPath).toBeNull();
    });

    it('marks node: built-ins as external', async () => {
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        'node:fs',
        join(testDir, 'src/a.ts'),
      );
      expect(result.isExternal).toBe(true);
    });

    it('marks bare node built-in names as external', async () => {
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      for (const builtin of ['fs', 'path', 'os', 'crypto']) {
        const result = await resolver.resolveImport(
          builtin,
          join(testDir, 'src/a.ts'),
        );
        expect(result.isExternal).toBe(true);
      }
    });

    it('preserves the original specifier in the result', async () => {
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        'react',
        join(testDir, 'src/a.ts'),
      );
      expect(result.originalSpecifier).toBe('react');
    });
  });

  describe('relative path resolution', () => {
    it('resolves a relative import with explicit extension', async () => {
      writeFile('src/b.ts', 'export const b = 1;');
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        './b.ts',
        join(testDir, 'src/a.ts'),
      );
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe(join(testDir, 'src/b.ts'));
    });

    it('resolves a relative import by trying configured extensions', async () => {
      writeFile('src/b.ts', 'export const b = 1;');
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        './b',
        join(testDir, 'src/a.ts'),
      );
      expect(result.resolvedPath).toBe(join(testDir, 'src/b.ts'));
    });

    it('resolves a .tsx file when listed in extensions', async () => {
      writeFile('src/Component.tsx', 'export const C = () => null;');
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        './Component',
        join(testDir, 'src/a.ts'),
      );
      expect(result.resolvedPath).toBe(join(testDir, 'src/Component.tsx'));
    });

    it('resolves a directory import to its barrel file', async () => {
      writeFile('src/utils/index.ts', 'export const u = 1;');
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        './utils',
        join(testDir, 'src/a.ts'),
      );
      expect(result.resolvedPath).toBe(join(testDir, 'src/utils/index.ts'));
    });

    it('resolves a parent directory import', async () => {
      writeFile('src/shared.ts', 'export const s = 1;');
      mkdirSync(join(testDir, 'src/features/auth'), { recursive: true });
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        '../../shared',
        join(testDir, 'src/features/auth/service.ts'),
      );
      expect(result.resolvedPath).toBe(join(testDir, 'src/shared.ts'));
    });

    it('returns null resolvedPath when file does not exist', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true });
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result = await resolver.resolveImport(
        './missing',
        join(testDir, 'src/a.ts'),
      );
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('tsconfig path mapping', () => {
    it('resolves a path alias defined in tsconfig paths', async () => {
      writeFile('src/shared/utils.ts', 'export const u = 1;');
      writeTsConfig('tsconfig.json', {
        compilerOptions: {
          baseUrl: 'src',
          paths: { '@shared/*': ['shared/*'] },
        },
      });
      const config = makeConfig();
      const tsconfig = makeTsConfig({
        baseUrl: 'src',
        paths: { '@shared/*': ['shared/*'] },
      });
      const resolver = new ModuleResolver(config, tsconfig);
      const result = await resolver.resolveImport(
        '@shared/utils',
        join(testDir, 'src/a.ts'),
      );
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe(join(testDir, 'src/shared/utils.ts'));
    });

    it('treats unresolvable alias as external when no file matches', async () => {
      writeTsConfig('tsconfig.json', {
        compilerOptions: {
          baseUrl: 'src',
          paths: { '@missing/*': ['missing/*'] },
        },
      });
      const config = makeConfig();
      const tsconfig = makeTsConfig({
        baseUrl: 'src',
        paths: { '@missing/*': ['missing/*'] },
      });
      const resolver = new ModuleResolver(config, tsconfig);
      const result = await resolver.resolveImport(
        '@missing/foo',
        join(testDir, 'src/a.ts'),
      );
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('caching', () => {
    it('returns the same result object for the same specifier + fromFile pair', async () => {
      writeFile('src/b.ts', '');
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result1 = await resolver.resolveImport(
        './b',
        join(testDir, 'src/a.ts'),
      );
      const result2 = await resolver.resolveImport(
        './b',
        join(testDir, 'src/a.ts'),
      );
      expect(result1).toBe(result2);
    });

    it('caches external packages', async () => {
      const resolver = new ModuleResolver(makeConfig(), makeTsConfig());
      const result1 = await resolver.resolveImport(
        'lodash',
        join(testDir, 'src/a.ts'),
      );
      const result2 = await resolver.resolveImport(
        'lodash',
        join(testDir, 'src/a.ts'),
      );
      expect(result1).toBe(result2);
    });
  });
});
