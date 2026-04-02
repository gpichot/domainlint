import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo } from './workspace-detector.js';
import { runWorkspaceLint } from './workspace-runner.js';

// Mock dependencies
vi.mock('../config/config-loader.js', () => ({
  loadConfig: vi.fn(),
}));

// Use a class for the mock so `new` works properly
vi.mock('../linter/feature-boundaries-linter.js', () => {
  // biome-ignore lint/complexity/noStaticOnlyClass: needed for vi.mock
  class MockFeatureBoundariesLinter {
    static lintMock = vi.fn();
    lint = MockFeatureBoundariesLinter.lintMock;
  }
  return { FeatureBoundariesLinter: MockFeatureBoundariesLinter };
});

import { loadConfig } from '../config/config-loader.js';
import { FeatureBoundariesLinter } from '../linter/feature-boundaries-linter.js';

const mockLoadConfig = vi.mocked(loadConfig);
// Access the static lintMock from the mocked class
const getLintMock = () =>
  (FeatureBoundariesLinter as unknown as { lintMock: ReturnType<typeof vi.fn> })
    .lintMock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runWorkspaceLint', () => {
  const workspace: WorkspaceInfo = {
    root: '/workspace',
    type: 'pnpm',
    packages: [
      { path: '/workspace/packages/core', name: '@my/core' },
      { path: '/workspace/packages/ui', name: '@my/ui' },
    ],
  };

  it('skips packages where loadConfig fails (no srcDir)', async () => {
    mockLoadConfig.mockRejectedValue(
      new Error(
        'Invalid config: "srcDir" does not exist: /workspace/packages/core/src',
      ),
    );

    const result = await runWorkspaceLint(workspace);

    expect(result.packageResults).toHaveLength(2);
    expect(result.packageResults[0].skipped).toBe(true);
    expect(result.packageResults[0].skipReason).toBe(
      'No src/features directory found',
    );
    expect(result.packageResults[1].skipped).toBe(true);
    expect(result.totalFileCount).toBe(0);
    expect(result.hasViolations).toBe(false);
  });

  it('lints packages successfully', async () => {
    const mockConfig = {
      rootDir: '/workspace/packages/core',
      srcDir: '/workspace/packages/core/src',
      featuresDir: '/workspace/packages/core/src/features',
      barrelFiles: ['index.ts'],
      extensions: ['.ts'],
      tsconfigPath: '/workspace/packages/core/tsconfig.json',
      exclude: [],
      includeDynamicImports: false,
    };

    mockLoadConfig.mockResolvedValue(mockConfig);

    const mockLintResult = {
      violations: [],
      fileCount: 5,
      analysisTimeMs: 50,
      dependencyGraph: {
        nodes: new Set<string>(),
        edges: [],
        adjacencyList: new Map(),
      },
      parseResults: [],
    };

    getLintMock().mockResolvedValue(mockLintResult);

    const result = await runWorkspaceLint(workspace);

    expect(result.packageResults).toHaveLength(2);
    expect(result.packageResults[0].skipped).toBe(false);
    expect(result.packageResults[0].result.fileCount).toBe(5);
    expect(result.totalFileCount).toBe(10);
    expect(result.hasViolations).toBe(false);
    expect(result.type).toBe('pnpm');
  });

  it('reports violations from individual packages', async () => {
    const mockConfig = {
      rootDir: '/workspace/packages/core',
      srcDir: '/workspace/packages/core/src',
      featuresDir: '/workspace/packages/core/src/features',
      barrelFiles: ['index.ts'],
      extensions: ['.ts'],
      tsconfigPath: '/workspace/packages/core/tsconfig.json',
      exclude: [],
      includeDynamicImports: false,
    };

    mockLoadConfig.mockResolvedValue(mockConfig);

    const violation = {
      code: 'noImportCycle',
      file: '/workspace/packages/core/src/a.ts',
      line: 1,
      col: 1,
      message: 'Import cycle detected: a -> b -> a',
    };

    getLintMock()
      .mockResolvedValueOnce({
        violations: [violation],
        fileCount: 3,
        analysisTimeMs: 30,
        dependencyGraph: {
          nodes: new Set<string>(),
          edges: [],
          adjacencyList: new Map(),
        },
        parseResults: [],
      })
      .mockResolvedValueOnce({
        violations: [],
        fileCount: 3,
        analysisTimeMs: 30,
        dependencyGraph: {
          nodes: new Set<string>(),
          edges: [],
          adjacencyList: new Map(),
        },
        parseResults: [],
      });

    const result = await runWorkspaceLint(workspace);

    expect(result.hasViolations).toBe(true);
    expect(result.packageResults[0].result.violations).toHaveLength(1);
    expect(result.packageResults[1].result.violations).toHaveLength(0);
  });

  it('handles linting errors gracefully', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Invalid tsconfig'));

    const result = await runWorkspaceLint(workspace);

    expect(result.packageResults[0].skipped).toBe(true);
    expect(result.packageResults[0].skipReason).toContain('Invalid tsconfig');
    expect(result.packageResults[1].skipped).toBe(true);
  });

  it('passes configOverrides to loadConfig', async () => {
    const mockConfig = {
      rootDir: '/workspace/packages/core',
      srcDir: '/workspace/packages/core/lib',
      featuresDir: '/workspace/packages/core/lib/features',
      barrelFiles: ['index.ts'],
      extensions: ['.ts'],
      tsconfigPath: '/workspace/packages/core/tsconfig.json',
      exclude: [],
      includeDynamicImports: false,
    };

    mockLoadConfig.mockResolvedValue(mockConfig);

    getLintMock().mockResolvedValue({
      violations: [],
      fileCount: 1,
      analysisTimeMs: 10,
      dependencyGraph: {
        nodes: new Set<string>(),
        edges: [],
        adjacencyList: new Map(),
      },
      parseResults: [],
    });

    const singlePkgWorkspace: WorkspaceInfo = {
      root: '/workspace',
      type: 'pnpm',
      packages: [{ path: '/workspace/packages/core', name: '@my/core' }],
    };

    await runWorkspaceLint(singlePkgWorkspace, {
      configOverrides: { srcDir: 'lib' },
    });

    expect(mockLoadConfig).toHaveBeenCalledWith(
      '/workspace/packages/core',
      undefined,
      { srcDir: 'lib' },
    );
  });
});
