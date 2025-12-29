import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { FeatureBoundariesLinter } from '../linter/feature-boundaries-linter.js';

// Mock the filesystem
vi.mock('node:fs/promises', async () => {
  const memfs = await vi.importActual('memfs');
  return (memfs as any).fs.promises;
});

// Mock glob to work with memfs
vi.mock('glob', () => ({
  glob: vi.fn((pattern: string) => {
    // Return files based on what exists in memfs
    const fs = require('memfs').fs;
    if (pattern.includes('button')) {
      return Promise.resolve([
        '/project/src/features/feat-a/components/button.tsx',
        '/project/src/features/feat-a/components/button.stories.tsx',
      ]);
    }
    if (pattern.includes('components')) {
      return Promise.resolve([
        '/project/src/features/feat-a/components/comp-a.tsx',
        '/project/src/features/feat-a/components/comp-b.tsx',
      ]);
    }
    return Promise.resolve([]);
  }),
}));

describe('Extension False Positive - Minimal Example', () => {
  let config: FeatureBoundariesConfig;

  beforeEach(() => {
    vol.reset();
    config = {
      rootDir: '/project',
      srcDir: '/project/src',
      featuresDir: '/project/src/features',
      barrelFiles: ['index.ts'],
      extensions: ['.ts', '.tsx'],
      tsconfigPath: '/project/tsconfig.json',
      exclude: ['**/node_modules/**'],
      includeDynamicImports: false,
      overrides: {},
    };
  });

  it('should NOT detect false cycle when stories imports component with .tsx extension', async () => {
    // Minimal reproduction: component + stories file with explicit extension import
    vol.fromJSON({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/feat-a/components/button.tsx': `
export function Button() {
  return <button>Click me</button>
}
`,
      '/project/src/features/feat-a/components/button.stories.tsx': `
import { Button } from './button.tsx'

export default {
  component: Button
}

export const Default = {}
`,
    });

    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    // Should NOT detect any import cycles
    const cycleViolations = result.violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    );

    expect(cycleViolations).toHaveLength(0);
  });
});
