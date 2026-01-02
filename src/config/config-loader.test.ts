import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFileSystem } from '../test-utils/setup.js';
import { loadConfig } from './config-loader.js';

// Mock fs module
vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

describe('Config Loader', () => {
  beforeEach(() => {
    vol.reset();
  });

  it('should load default config when no config file exists', async () => {
    createMockFileSystem({});

    const config = await loadConfig('/project');

    expect(config).toMatchObject({
      rootDir: '/project',
      srcDir: '/project/src',
      featuresDir: '/project/src/features',
      barrelFiles: ['index.ts'],
      extensions: ['.ts', '.tsx', '.d.ts'],
      tsconfigPath: '/project/tsconfig.json',
      includeDynamicImports: false,
      overrides: {},
    });
  });

  it('should load and merge config from file', async () => {
    createMockFileSystem({
      '/project/domainlint.json': JSON.stringify({
        srcDir: 'source',
        extensions: ['.ts'],
        includeDynamicImports: true,
      }),
    });

    const config = await loadConfig('/project');

    expect(config).toMatchObject({
      rootDir: '/project',
      srcDir: '/project/source',
      featuresDir: '/project/src/features', // uses default since not overridden
      extensions: ['.ts'], // overridden from config file
      includeDynamicImports: true, // overridden from config file
      overrides: {},
    });
  });

  it('should prioritize CLI overrides over config file', async () => {
    createMockFileSystem({
      '/project/domainlint.json': JSON.stringify({
        srcDir: 'source',
        includeDynamicImports: true,
      }),
    });

    const config = await loadConfig('/project', undefined, {
      srcDir: 'app',
      includeDynamicImports: false,
    });

    expect(config).toMatchObject({
      srcDir: '/project/app', // CLI override wins
      includeDynamicImports: false, // CLI override wins
    });
  });

  it('should load specific config file path', async () => {
    createMockFileSystem({
      '/project/custom-config.json': JSON.stringify({
        srcDir: 'custom',
        extensions: ['.js', '.jsx'],
      }),
    });

    const config = await loadConfig('/project', 'custom-config.json');

    expect(config).toMatchObject({
      srcDir: '/project/custom',
      extensions: ['.js', '.jsx'],
    });
  });

  it('should throw error for invalid config file', async () => {
    createMockFileSystem({
      '/project/domainlint.json': 'invalid json',
    });

    await expect(loadConfig('/project')).rejects.toThrow();
  });
});
