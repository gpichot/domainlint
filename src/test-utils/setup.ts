import { vol } from 'memfs';
import type { FeatureBoundariesConfig } from '../config/types.js';

export function createMockFileSystem(files: Record<string, string>) {
  vol.reset();
  vol.fromJSON(files);
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
