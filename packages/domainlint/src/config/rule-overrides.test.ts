import { beforeEach, describe, expect, it } from 'vitest';
import type { Violation } from '../graph/types.js';
import {
  checkRuleOverride,
  filterViolationsByOverrides,
} from './rule-overrides.js';
import type { FeatureBoundariesConfig } from './types.js';

describe('Rule Overrides', () => {
  let baseConfig: FeatureBoundariesConfig;

  beforeEach(() => {
    baseConfig = {
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

  describe('checkRuleOverride', () => {
    it('should return error by default', () => {
      const result = checkRuleOverride(
        baseConfig,
        'import-cycles',
        '/project/src/utils/helper.ts',
      );
      expect(result).toEqual({
        shouldRun: true,
        level: 'error',
      });
    });

    it('should apply global overrides for non-feature files', () => {
      const config = {
        ...baseConfig,
        overrides: {
          global: {
            rules: {
              'import-cycles': 'warn' as const,
            },
          },
        },
      };

      const result = checkRuleOverride(
        config,
        'import-cycles',
        '/project/src/utils/helper.ts',
      );
      expect(result).toEqual({
        shouldRun: true,
        level: 'warn',
      });
    });

    it('should disable rules when set to off', () => {
      const config = {
        ...baseConfig,
        overrides: {
          global: {
            rules: {
              'import-cycles': 'off' as const,
            },
          },
        },
      };

      const result = checkRuleOverride(
        config,
        'import-cycles',
        '/project/src/utils/helper.ts',
      );
      expect(result).toEqual({
        shouldRun: false,
        level: 'off',
      });
    });

    it('should apply feature-specific overrides', () => {
      const config = {
        ...baseConfig,
        overrides: {
          features: {
            auth: {
              rules: {
                'cross-feature-imports': 'warn' as const,
              },
            },
          },
        },
      };

      const result = checkRuleOverride(
        config,
        'cross-feature-imports',
        '/project/src/features/auth/services/user.ts',
      );
      expect(result).toEqual({
        shouldRun: true,
        level: 'warn',
      });
    });

    it('should prefer feature-specific overrides over global ones', () => {
      const config = {
        ...baseConfig,
        overrides: {
          global: {
            rules: {
              'import-cycles': 'warn' as const,
            },
          },
          features: {
            auth: {
              rules: {
                'import-cycles': 'off' as const,
              },
            },
          },
        },
      };

      const result = checkRuleOverride(
        config,
        'import-cycles',
        '/project/src/features/auth/index.ts',
      );
      expect(result).toEqual({
        shouldRun: false,
        level: 'off',
      });
    });

    it('should default unused-files to off', () => {
      const result = checkRuleOverride(
        baseConfig,
        'unused-files',
        '/project/src/utils/helper.ts',
      );
      expect(result).toEqual({
        shouldRun: false,
        level: 'off',
      });
    });

    it('should default unused-exports to off', () => {
      const result = checkRuleOverride(
        baseConfig,
        'unused-exports',
        '/project/src/utils/helper.ts',
      );
      expect(result).toEqual({
        shouldRun: false,
        level: 'off',
      });
    });

    it('should enable unused rules when explicitly set to error', () => {
      const config = {
        ...baseConfig,
        overrides: {
          global: {
            rules: {
              'unused-files': 'error' as const,
              'unused-exports': 'error' as const,
            },
          },
        },
      };

      const result = checkRuleOverride(
        config,
        'unused-files',
        '/project/src/utils/helper.ts',
      );
      expect(result).toEqual({
        shouldRun: true,
        level: 'error',
      });
    });
  });

  describe('filterViolationsByOverrides', () => {
    it('should filter out disabled violations', () => {
      const config = {
        ...baseConfig,
        overrides: {
          global: {
            rules: {
              'import-cycles': 'off' as const,
            },
          },
        },
      };

      const violations: Violation[] = [
        {
          code: 'ARCH_IMPORT_CYCLE',
          file: '/project/src/utils/helper.ts',
          line: 1,
          col: 1,
          message: 'Import cycle detected',
        },
      ];

      const result = filterViolationsByOverrides(violations, config);
      expect(result).toEqual([]);
    });

    it('should add level to violations based on overrides', () => {
      const config = {
        ...baseConfig,
        overrides: {
          features: {
            auth: {
              rules: {
                'cross-feature-imports': 'warn' as const,
              },
            },
          },
        },
      };

      const violations: Violation[] = [
        {
          code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
          file: '/project/src/features/auth/services/user.ts',
          line: 1,
          col: 1,
          message: 'Cross-feature import detected',
        },
      ];

      const result = filterViolationsByOverrides(violations, config);
      expect(result).toEqual([
        {
          code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
          file: '/project/src/features/auth/services/user.ts',
          line: 1,
          col: 1,
          message: 'Cross-feature import detected',
          level: 'warn',
        },
      ]);
    });

    it('should filter out unused-file violations by default (off)', () => {
      const violations: Violation[] = [
        {
          code: 'ARCH_UNUSED_FILE',
          file: '/project/src/utils/helper.ts',
          line: 1,
          col: 1,
          message: 'Unused file',
        },
      ];

      const result = filterViolationsByOverrides(violations, baseConfig);
      expect(result).toEqual([]);
    });

    it('should filter out unused-export violations by default (off)', () => {
      const violations: Violation[] = [
        {
          code: 'ARCH_UNUSED_EXPORT',
          file: '/project/src/utils/helper.ts',
          line: 1,
          col: 1,
          message: 'Unused export',
        },
      ];

      const result = filterViolationsByOverrides(violations, baseConfig);
      expect(result).toEqual([]);
    });

    it('should keep unused violations when explicitly enabled', () => {
      const config = {
        ...baseConfig,
        overrides: {
          global: {
            rules: {
              'unused-files': 'error' as const,
            },
          },
        },
      };

      const violations: Violation[] = [
        {
          code: 'ARCH_UNUSED_FILE',
          file: '/project/src/utils/helper.ts',
          line: 1,
          col: 1,
          message: 'Unused file',
        },
      ];

      const result = filterViolationsByOverrides(violations, config);
      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('error');
    });

    it('should default to error level when no override is specified', () => {
      const violations: Violation[] = [
        {
          code: 'ARCH_IMPORT_CYCLE',
          file: '/project/src/utils/helper.ts',
          line: 1,
          col: 1,
          message: 'Import cycle detected',
        },
      ];

      const result = filterViolationsByOverrides(violations, baseConfig);
      expect(result).toEqual([
        {
          code: 'ARCH_IMPORT_CYCLE',
          file: '/project/src/utils/helper.ts',
          line: 1,
          col: 1,
          message: 'Import cycle detected',
          level: 'error',
        },
      ]);
    });
  });
});
