import { beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { Violation } from '../graph/types.js';
import { ViolationFilterService } from './violation-filter.js';

describe('ViolationFilterService', () => {
  let filterService: ViolationFilterService;
  let mockConfig: FeatureBoundariesConfig;
  let mockViolations: Violation[];

  beforeEach(() => {
    filterService = new ViolationFilterService();
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

    mockViolations = [
      {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message: 'Import cycle detected: user.ts -> service.ts -> user.ts',
      },
      {
        code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        file: '/project/src/features/billing/invoice.ts',
        line: 1,
        col: 1,
        message: 'Cross-feature deep import not allowed',
      },
      {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/billing/payment.ts',
        line: 1,
        col: 1,
        message:
          'Import cycle detected: payment.ts -> processor.ts -> validator.ts -> payment.ts',
      },
    ];
  });

  describe('filterViolations', () => {
    it('should return all violations when no filters applied', () => {
      const result = filterService.filterViolations(mockViolations, mockConfig);
      expect(result).toHaveLength(3);
    });

    it('should filter violations by feature', () => {
      const result = filterService.filterViolations(
        mockViolations,
        mockConfig,
        {
          feature: 'auth',
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0].file).toContain('auth');
    });

    it('should filter violations by unknown feature', () => {
      const result = filterService.filterViolations(
        mockViolations,
        mockConfig,
        {
          feature: 'unknown',
        },
      );

      expect(result).toHaveLength(0);
    });

    it('should filter cycles by max length', () => {
      const result = filterService.filterViolations(
        mockViolations,
        mockConfig,
        {
          maxCycleLength: 2,
        },
      );

      expect(result).toHaveLength(2); // 1 short cycle + 1 boundary violation
      expect(result.filter((v) => v.code === 'ARCH_IMPORT_CYCLE')).toHaveLength(
        1,
      );
    });

    it('should select shortest cycles when flag is set', () => {
      const duplicateCycles: Violation[] = [
        {
          code: 'ARCH_IMPORT_CYCLE',
          file: '/project/src/features/auth/user.ts',
          line: 1,
          col: 1,
          message: 'Import cycle detected: user.ts -> service.ts -> user.ts', // length 2
        },
        {
          code: 'ARCH_IMPORT_CYCLE',
          file: '/project/src/features/auth/user.ts',
          line: 5,
          col: 1,
          message:
            'Import cycle detected: user.ts -> service.ts -> utils.ts -> user.ts', // length 3
        },
      ];

      const result = filterService.filterViolations(
        duplicateCycles,
        mockConfig,
        {
          shortestCycles: true,
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0].message).toContain('user.ts -> service.ts -> user.ts');
    });

    it('should preserve non-cycle violations when filtering cycles', () => {
      const result = filterService.filterViolations(
        mockViolations,
        mockConfig,
        {
          maxCycleLength: 1, // This should filter out all cycles
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('ARCH_NO_CROSS_FEATURE_DEEP_IMPORT');
    });
  });

  describe('cycle length extraction', () => {
    it('should extract cycle length from total cycle length indicator', () => {
      const violation: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message:
          'Import cycle detected: a -> b -> c (Total cycle length: 5 files)',
      };

      const result = filterService.filterViolations([violation], mockConfig, {
        maxCycleLength: 4,
      });

      expect(result).toHaveLength(0); // Should be filtered out because 5 > 4
    });

    it('should extract cycle length from truncated cycle indicator', () => {
      const violation: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message:
          'Import cycle detected: a -> b -> [...3 more imports in cycle]',
      };

      const result = filterService.filterViolations([violation], mockConfig, {
        maxCycleLength: 4,
      });

      expect(result).toHaveLength(0); // 2 visible + 3 hidden = 5, which exceeds maxCycleLength of 4
    });

    it('should count visible parts for short cycles', () => {
      const violation: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message: 'Import cycle detected: a -> b -> a',
      };

      const result = filterService.filterViolations([violation], mockConfig, {
        maxCycleLength: 1,
      });

      expect(result).toHaveLength(0); // Should be filtered out because cycle length is 2
    });
  });

  describe('analyzeViolations', () => {
    it('should provide correct violation analysis', () => {
      const analysis = filterService.analyzeViolations(mockViolations);

      expect(analysis).toEqual({
        cycleCount: 2,
        boundaryViolationCount: 1,
        totalCount: 3,
        violationsByType: {
          ARCH_IMPORT_CYCLE: 2,
          ARCH_NO_CROSS_FEATURE_DEEP_IMPORT: 1,
        },
      });
    });

    it('should handle empty violations list', () => {
      const analysis = filterService.analyzeViolations([]);

      expect(analysis).toEqual({
        cycleCount: 0,
        boundaryViolationCount: 0,
        totalCount: 0,
        violationsByType: {},
      });
    });

    it('should count multiple boundary violation types', () => {
      const violations: Violation[] = [
        {
          code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
          file: '/project/src/features/auth/user.ts',
          line: 1,
          col: 1,
          message: 'Cross-feature deep import',
        },
        {
          code: 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
          file: '/project/src/features/auth/user.ts',
          line: 1,
          col: 1,
          message: 'Feature import from non-domain',
        },
      ];

      const analysis = filterService.analyzeViolations(violations);

      expect(analysis.boundaryViolationCount).toBe(2);
      expect(analysis.totalCount).toBe(2);
    });
  });
});
