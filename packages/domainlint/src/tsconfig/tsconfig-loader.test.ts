import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFileSystem } from '../test-utils/setup.js';
import { loadTsConfig, resolvePathMapping } from './tsconfig-loader.js';

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

  it('should handle extends chain (single level)', async () => {
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
        '@/*': ['src/*'],
      },
      rootDir: '/project',
    });
  });

  it('should handle 2-level extends chain (A extends B extends C)', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        extends: './tsconfig.app.json',
        compilerOptions: {
          paths: {
            '@app/*': ['src/app/*'],
          },
        },
      }),
      '/project/tsconfig.app.json': JSON.stringify({
        extends: './tsconfig.base.json',
        compilerOptions: {
          paths: {
            '@features/*': ['src/features/*'],
          },
        },
      }),
      '/project/tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@shared/*': ['src/shared/*'],
          },
        },
      }),
    });

    const tsconfig = await loadTsConfig('/project/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: {
        '@shared/*': ['src/shared/*'],
        '@features/*': ['src/features/*'],
        '@app/*': ['src/app/*'],
      },
      rootDir: '/project',
    });
  });

  it('should handle monorepo-style extends (extends from parent directory)', async () => {
    createMockFileSystem({
      '/repo/tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@monorepo/*': ['packages/*/src'],
          },
        },
      }),
      '/repo/packages/my-app/tsconfig.json': JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          paths: {
            '@/*': ['src/*'],
          },
        },
      }),
    });

    const tsconfig = await loadTsConfig('/repo/packages/my-app/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: {
        '@monorepo/*': ['packages/*/src'],
        '@/*': ['src/*'],
      },
      rootDir: '/repo/packages/my-app',
    });
  });

  it('should handle extends as an array (TypeScript 5.0+)', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        extends: ['./base-a.json', './base-b.json'],
        compilerOptions: {
          paths: {
            '@app/*': ['src/*'],
          },
        },
      }),
      '/project/base-a.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@shared/*': ['shared/*'],
          },
        },
      }),
      '/project/base-b.json': JSON.stringify({
        compilerOptions: {
          paths: {
            '@utils/*': ['utils/*'],
          },
        },
      }),
    });

    const tsconfig = await loadTsConfig('/project/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: {
        '@shared/*': ['shared/*'],
        '@utils/*': ['utils/*'],
        '@app/*': ['src/*'],
      },
      rootDir: '/project',
    });
  });

  it('should handle extends without .json extension', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        extends: './base',
        compilerOptions: { paths: { '@/*': ['src/*'] } },
      }),
      '/project/base.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
    });

    const tsconfig = await loadTsConfig('/project/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
      rootDir: '/project',
    });
  });

  it('should handle node_modules extends', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        extends: 'tsconfig-strict',
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      }),
      '/project/node_modules/tsconfig-strict/tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
        },
      }),
    });

    const tsconfig = await loadTsConfig('/project/tsconfig.json');

    expect(tsconfig).toMatchObject({
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
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
