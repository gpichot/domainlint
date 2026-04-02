import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { FeatureBoundariesLinter } from './feature-boundaries-linter.js';

let testDir: string;

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

function createFileSystem(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const relativePath = path.replace('/project/', '');
    writeFile(relativePath, content);
  }
}

function createConfig(
  overrides: Partial<FeatureBoundariesConfig> = {},
): FeatureBoundariesConfig {
  return {
    rootDir: testDir,
    srcDir: join(testDir, 'src'),
    featuresDir: join(testDir, 'src/features'),
    barrelFiles: ['index.ts'],
    extensions: ['.ts', '.tsx', '.d.ts'],
    tsconfigPath: join(testDir, 'tsconfig.json'),
    exclude: ['**/node_modules/**', '**/dist/**'],
    includeDynamicImports: false,
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `domainlint-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Extension false positive prevention', () => {
  it('should NOT detect false cycle when .tsx imports same-name .ts file', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/components/ScoreGauge.ts': `export const data = { score: 100 };`,
      '/project/src/components/ScoreGauge.tsx': `import { data } from './ScoreGauge';
export function ScoreGauge() { return data.score; }`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const cycleViolations = result.violations.filter(
      (v) => v.code === 'noImportCycle',
    );
    expect(cycleViolations).toHaveLength(0);
  });

  it('should NOT detect false self-cycle for files like DimensionTooltip.tsx / .ts', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/components/Shared/DimensionTooltip.ts': `export interface DimensionTooltipProps { label: string; }`,
      '/project/src/components/Shared/DimensionTooltip.tsx': `import type { DimensionTooltipProps } from './DimensionTooltip';
export function DimensionTooltip(props: DimensionTooltipProps) {}`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const cycleViolations = result.violations.filter(
      (v) => v.code === 'noImportCycle',
    );
    expect(cycleViolations).toHaveLength(0);
  });

  it('should still detect real cycles between colliding-name files', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      // Both files import each other — a real cycle
      '/project/src/components/Widget.ts': `import { Widget } from './Widget.tsx';
export const widgetData = 1;`,
      '/project/src/components/Widget.tsx': `import { widgetData } from './Widget';
export function Widget() { return widgetData; }`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const cycleViolations = result.violations.filter(
      (v) => v.code === 'noImportCycle',
    );
    expect(cycleViolations.length).toBeGreaterThan(0);
  });
});
