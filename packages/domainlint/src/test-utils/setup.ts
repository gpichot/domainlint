import { fs as memfs, vol } from 'memfs';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { GlobFunction } from '../files/file-discovery.js';
import type { FileSystem } from '../fs.js';

export function createMockFileSystem(files: Record<string, string>) {
  vol.reset();
  vol.fromJSON(files);
}

export function createTestFs(): FileSystem {
  return {
    readFile: (path, encoding) =>
      memfs.promises.readFile(path, encoding) as Promise<string>,
    stat: async (path) => {
      const s = await memfs.promises.stat(path);
      return { isFile: () => s.isFile() };
    },
  };
}

export function createTestGlob(): GlobFunction {
  return async (pattern, options) => {
    const cwd = options.cwd ?? process.cwd();
    const ext = pattern.replace('**/*', '');
    return Object.keys(vol.toJSON())
      .filter((f) => f.startsWith(cwd))
      .filter((f) => f.endsWith(ext));
  };
}

export function createDefaultConfig(
  overrides: Partial<FeatureBoundariesConfig> = {},
): FeatureBoundariesConfig {
  return {
    rootDir: '/project',
    srcDir: '/project/src',
    featuresDir: '/project/src/features',
    barrelFiles: ['index.ts'],
    extensions: ['.ts', '.tsx', '.d.ts'],
    tsconfigPath: '/project/tsconfig.json',
    exclude: ['**/node_modules/**', '**/dist/**'],
    includeDynamicImports: false,
    ...overrides,
  };
}
