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
    createMockFileSystem({
      '/project/src/.keep': '',
      '/project/src/features/.keep': '',
    });

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
      '/project/source/.keep': '',
      '/project/src/features/.keep': '',
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
      '/project/app/.keep': '',
      '/project/src/features/.keep': '',
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
      '/project/custom/.keep': '',
      '/project/src/features/.keep': '',
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

  describe('config validation', () => {
    it('should throw when srcDir does not exist', async () => {
      createMockFileSystem({
        '/project/src/features/.keep': '',
      });

      // Override srcDir to a non-existent directory
      await expect(
        loadConfig('/project', undefined, { srcDir: 'nonexistent' }),
      ).rejects.toThrow('"srcDir" does not exist');
    });

    it('should throw when featuresDir does not exist', async () => {
      createMockFileSystem({
        '/project/src/.keep': '',
      });

      await expect(loadConfig('/project')).rejects.toThrow(
        '"featuresDir" does not exist',
      );
    });

    it('should throw for barrelFiles entry that is an empty string', async () => {
      createMockFileSystem({
        '/project/domainlint.json': JSON.stringify({
          barrelFiles: ['index.ts', ''],
        }),
        '/project/src/.keep': '',
        '/project/src/features/.keep': '',
      });

      await expect(loadConfig('/project')).rejects.toThrow(
        '"barrelFiles" entries must be non-empty strings',
      );
    });

    it('should throw for extensions entry missing leading dot', async () => {
      createMockFileSystem({
        '/project/domainlint.json': JSON.stringify({
          extensions: ['.ts', 'tsx'],
        }),
        '/project/src/.keep': '',
        '/project/src/features/.keep': '',
      });

      await expect(loadConfig('/project')).rejects.toThrow(
        '"extensions" entries must start with \'.\'',
      );
    });

    it('should accept valid barrelFiles and extensions', async () => {
      createMockFileSystem({
        '/project/domainlint.json': JSON.stringify({
          barrelFiles: ['index.ts', 'index.js'],
          extensions: ['.ts', '.tsx', '.js'],
        }),
        '/project/src/.keep': '',
        '/project/src/features/.keep': '',
      });

      await expect(loadConfig('/project')).resolves.toMatchObject({
        barrelFiles: ['index.ts', 'index.js'],
        extensions: ['.ts', '.tsx', '.js'],
      });
    });
  });
});
