import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadTsConfig,
  resolvePathMapping,
} from '../tsconfig/tsconfig-loader.js';
import { createMockFileSystem } from './setup.js';

// Mock fs module
vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

describe('TsConfig Loader', () => {
  beforeEach(() => {
    vol.reset();
  });

  it('should load basic tsconfig', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
      }),
    });

    const tsconfig = await loadTsConfig('/project/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: {
        '@/*': ['src/*'],
      },
      rootDir: '/project',
    });
  });

  it('should handle extends chain', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        extends: './base.json',
        compilerOptions: {
          paths: {
            '@/*': ['src/*'],
          },
        },
      }),
      '/project/base.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@shared/*': ['shared/*'],
          },
        },
      }),
    });

    const tsconfig = await loadTsConfig('/project/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: {
        '@shared/*': ['shared/*'],
        '@/*': ['src/*'], // local paths override base
      },
      rootDir: '/project',
    });
  });

  it('should throw error for missing tsconfig', async () => {
    createMockFileSystem({});

    await expect(loadTsConfig('/project/tsconfig.json')).rejects.toThrow(
      'Failed to read tsconfig.json',
    );
  });
});

describe('Path Mapping Resolution', () => {
  it('should resolve simple path mapping', () => {
    const paths = { '@/*': ['src/*'] };
    const candidates = resolvePathMapping('@/utils', paths, '.', '/project');

    expect(candidates).toEqual(['/project/src/utils']);
  });

  it('should resolve multiple path mappings', () => {
    const paths = {
      '@/*': ['src/*', 'lib/*'],
      '~/*': ['shared/*'],
    };
    const candidates = resolvePathMapping('@/utils', paths, '.', '/project');

    expect(candidates).toEqual(['/project/src/utils', '/project/lib/utils']);
  });

  it('should handle exact matches without wildcard', () => {
    const paths = { react: ['node_modules/react'] };
    const candidates = resolvePathMapping('react', paths, '.', '/project');

    expect(candidates).toEqual(['/project/node_modules/react']);
  });

  it('should return empty array when no paths match', () => {
    const paths = { '@/*': ['src/*'] };
    const candidates = resolvePathMapping(
      'external-lib',
      paths,
      '.',
      '/project',
    );

    expect(candidates).toEqual([]);
  });

  it('should return empty array when no paths or baseUrl provided', () => {
    const candidates = resolvePathMapping(
      '@/utils',
      undefined,
      undefined,
      '/project',
    );

    expect(candidates).toEqual([]);
  });
});
