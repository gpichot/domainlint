import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../test-utils/setup.js';
import { FeatureBoundariesLinter } from './feature-boundaries-linter.js';

// Mock fs module completely
vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

// Mock glob to work with memfs
vi.mock('glob', () => ({
  glob: async (pattern: string, options: Record<string, unknown> = {}) => {
    const cwd = (options.cwd as string) || process.cwd();
    const memfsFiles = Object.keys(vol.toJSON());

    // Filter files that are in the cwd and match the pattern
    // Check .tsx before .ts to avoid substring match issues
    const filteredFiles = memfsFiles
      .filter((file) => file.startsWith(cwd))
      .filter((file) => {
        if (pattern.includes('**/*.tsx')) return file.endsWith('.tsx');
        if (pattern.includes('**/*.ts')) return file.endsWith('.ts');
        return true;
      });

    return options.absolute
      ? filteredFiles
      : filteredFiles.map((f) => f.replace(`${cwd}/`, ''));
  },
}));

function createMockFileSystem(files: Record<string, string>) {
  vol.reset();
  vol.fromJSON(files);
}

describe('Extension false positive prevention', () => {
  beforeEach(() => {
    vol.reset();
  });

  it('should NOT detect false cycle when .tsx imports same-name .ts file', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/components/ScoreGauge.ts': `export const data = { score: 100 };`,
      '/project/src/components/ScoreGauge.tsx': `import { data } from './ScoreGauge';
export function ScoreGauge() { return data.score; }`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const cycleViolations = result.violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    );
    expect(cycleViolations).toHaveLength(0);
  });

  it('should NOT detect false self-cycle for files like DimensionTooltip.tsx / .ts', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/components/Shared/DimensionTooltip.ts': `export interface DimensionTooltipProps { label: string; }`,
      '/project/src/components/Shared/DimensionTooltip.tsx': `import type { DimensionTooltipProps } from './DimensionTooltip';
export function DimensionTooltip(props: DimensionTooltipProps) {}`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const cycleViolations = result.violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    );
    expect(cycleViolations).toHaveLength(0);
  });

  it('should still detect real cycles between colliding-name files', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      // Both files import each other — a real cycle
      '/project/src/components/Widget.ts': `import { Widget } from './Widget.tsx';
export const widgetData = 1;`,
      '/project/src/components/Widget.tsx': `import { widgetData } from './Widget';
export function Widget() { return widgetData; }`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const cycleViolations = result.violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    );
    expect(cycleViolations.length).toBeGreaterThan(0);
  });
});
