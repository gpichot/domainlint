import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import type { LintResult } from '../linter/feature-boundaries-linter.js';
import { StatisticsCalculator } from './statistics-calculator.js';

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

describe('StatisticsCalculator', () => {
  let calculator: StatisticsCalculator;
  let mockConfig: FeatureBoundariesConfig;

  beforeEach(() => {
    vol.reset();
    calculator = new StatisticsCalculator();
    mockConfig = {
      rootDir: '/project',
      srcDir: '/project/src',
      featuresDir: '/project/src/features',
      barrelFiles: ['index.ts'],
      extensions: ['.ts', '.tsx'],
      tsconfigPath: '/project/tsconfig.json',
      exclude: [],
      includeDynamicImports: false,
    };
  });

  describe('calculateFeatureStats', () => {
    it('should calculate basic feature statistics', async () => {
      vol.fromJSON({
        '/project/src/features/auth/user.ts': 'export interface User {}',
        '/project/src/features/auth/service.ts': `import { User } from './user';\nexport class AuthService {}`,
        '/project/src/features/billing/invoice.ts': 'export class Invoice {}',
      });

      const allFiles: FileInfo[] = [
        {
          path: '/project/src/features/auth/user.ts',
          relativePath: 'src/features/auth/user.ts',
          feature: 'auth',
          isBarrel: false,
        },
        {
          path: '/project/src/features/auth/service.ts',
          relativePath: 'src/features/auth/service.ts',
          feature: 'auth',
          isBarrel: false,
        },
        {
          path: '/project/src/features/billing/invoice.ts',
          relativePath: 'src/features/billing/invoice.ts',
          feature: 'billing',
          isBarrel: false,
        },
      ];

      const mockLintResult: LintResult = {
        violations: [],
        fileCount: 3,
        analysisTimeMs: 100,
        dependencyGraph: {
          nodes: new Set([
            '/project/src/features/auth/user.ts',
            '/project/src/features/auth/service.ts',
            '/project/src/features/billing/invoice.ts',
          ]),
          edges: [
            {
              from: '/project/src/features/auth/service.ts',
              to: '/project/src/features/auth/user.ts',
              importInfo: {
                specifier: './user',
                line: 1,
                col: 1,
                isDynamic: false,
                isTypeOnly: false,
              },
            },
          ],
          adjacencyList: new Map(),
        },
      };

      const stats = await calculator.calculateFeatureStats(
        allFiles,
        mockConfig,
        mockLintResult,
      );

      expect(stats).toHaveLength(2);

      const authStats = stats.find((s) => s.feature === 'auth');
      expect(authStats).toEqual({
        feature: 'auth',
        fileCount: 2,
        linesOfCode: 3, // 1 line from user.ts + 2 lines from service.ts
        dependencies: [],
      });

      const billingStats = stats.find((s) => s.feature === 'billing');
      expect(billingStats).toEqual({
        feature: 'billing',
        fileCount: 1,
        linesOfCode: 1,
        dependencies: [],
      });
    });

    it('should track cross-feature dependencies', async () => {
      const allFiles: FileInfo[] = [
        {
          path: '/project/src/features/auth/user.ts',
          relativePath: 'src/features/auth/user.ts',
          feature: 'auth',
          isBarrel: false,
        },
        {
          path: '/project/src/features/billing/invoice.ts',
          relativePath: 'src/features/billing/invoice.ts',
          feature: 'billing',
          isBarrel: false,
        },
      ];

      const mockLintResult: LintResult = {
        violations: [],
        fileCount: 2,
        analysisTimeMs: 100,
        dependencyGraph: {
          nodes: new Set([
            '/project/src/features/auth/user.ts',
            '/project/src/features/billing/invoice.ts',
          ]),
          edges: [
            {
              from: '/project/src/features/billing/invoice.ts',
              to: '/project/src/features/auth/user.ts',
              importInfo: {
                specifier: '../auth/user',
                line: 1,
                col: 1,
                isDynamic: false,
                isTypeOnly: false,
              },
            },
          ],
          adjacencyList: new Map(),
        },
      };

      const stats = await calculator.calculateFeatureStats(
        allFiles,
        mockConfig,
        mockLintResult,
      );

      const billingStats = stats.find((s) => s.feature === 'billing');
      expect(billingStats?.dependencies).toEqual(['auth']);
    });

    it('should handle normalized paths correctly', async () => {
      const allFiles: FileInfo[] = [
        {
          path: '/project/src/features/auth/user.ts',
          relativePath: 'src/features/auth/user.ts',
          feature: 'auth',
          isBarrel: false,
        },
      ];

      const mockLintResult: LintResult = {
        violations: [],
        fileCount: 1,
        analysisTimeMs: 100,
        dependencyGraph: {
          nodes: new Set(['/project/src/features/auth/user']), // normalized (no .ts)
          edges: [],
          adjacencyList: new Map(),
          normalizedToOriginalPath: new Map([
            [
              '/project/src/features/auth/user',
              '/project/src/features/auth/user.ts',
            ],
          ]),
        },
      };

      const stats = await calculator.calculateFeatureStats(
        allFiles,
        mockConfig,
        mockLintResult,
      );

      expect(stats).toHaveLength(1);
      expect(stats[0].feature).toBe('auth');
    });

    it('should skip line counting when includeLineCount is false', async () => {
      const calculatorNoLines = new StatisticsCalculator({
        includeLineCount: false,
      });

      const allFiles: FileInfo[] = [
        {
          path: '/project/src/features/auth/user.ts',
          relativePath: 'src/features/auth/user.ts',
          feature: 'auth',
          isBarrel: false,
        },
      ];

      const mockLintResult: LintResult = {
        violations: [],
        fileCount: 1,
        analysisTimeMs: 100,
        dependencyGraph: {
          nodes: new Set(['/project/src/features/auth/user.ts']),
          edges: [],
          adjacencyList: new Map(),
        },
      };

      const stats = await calculatorNoLines.calculateFeatureStats(
        allFiles,
        mockConfig,
        mockLintResult,
      );

      expect(stats[0].linesOfCode).toBe(0);
    });
  });

  describe('discoverAllFeatures', () => {
    it('should discover unique features from files', async () => {
      const allFiles: FileInfo[] = [
        {
          path: '/project/src/features/auth/user.ts',
          relativePath: 'src/features/auth/user.ts',
          feature: 'auth',
          isBarrel: false,
        },
        {
          path: '/project/src/features/auth/service.ts',
          relativePath: 'src/features/auth/service.ts',
          feature: 'auth',
          isBarrel: false,
        },
        {
          path: '/project/src/features/billing/invoice.ts',
          relativePath: 'src/features/billing/invoice.ts',
          feature: 'billing',
          isBarrel: false,
        },
        {
          path: '/project/src/lib/utils.ts',
          relativePath: 'src/lib/utils.ts',
          feature: null,
          isBarrel: false,
        },
      ];

      const features = await calculator.discoverAllFeatures(
        allFiles,
        mockConfig,
      );

      expect(features).toEqual(['auth', 'billing']);
    });

    it('should return empty array when no features found', async () => {
      const allFiles: FileInfo[] = [
        {
          path: '/project/src/lib/utils.ts',
          relativePath: 'src/lib/utils.ts',
          feature: null,
          isBarrel: false,
        },
      ];

      const features = await calculator.discoverAllFeatures(
        allFiles,
        mockConfig,
      );

      expect(features).toEqual([]);
    });
  });
});
