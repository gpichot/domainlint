import { describe, expect, it } from 'vitest';
import type { Violation } from '../graph/types.js';
import { ColoredReporter } from '../reporter/colored-reporter.js';
import { createDefaultConfig } from './setup.js';

describe('ColoredReporter', () => {
  const cycleViolation: Violation = {
    code: 'ARCH_IMPORT_CYCLE',
    file: '/project/src/a.ts',
    line: 1,
    col: 1,
    message:
      'Import cycle detected: /project/src/a.ts -> /project/src/b.ts -> /project/src/a.ts',
  };

  const boundaryViolation: Violation = {
    code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
    file: '/project/src/features/billing/invoice.ts',
    line: 2,
    col: 10,
    message:
      'Cross-feature deep import not allowed. Import "../../auth/domain/user" resolves to "/project/src/features/auth/domain/user.ts" but should import from feature barrel "/project/src/features/auth/index.ts" instead.',
  };

  it('should format cycle violations without colors', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatViolation(cycleViolation, '/project');

    expect(result).toContain('src/a.ts:1:1 ERROR ARCH_IMPORT_CYCLE');
    expect(result).toContain('Import cycle detected:');
    expect(result).toContain('./src/a.ts ->');
    expect(result).toContain('./src/b.ts ->');
  });

  it('should format boundary violations with structured layout', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatViolation(boundaryViolation, '/project');

    expect(result).toContain(
      'src/features/billing/invoice.ts:2:10 ERROR ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
    );
    expect(result).toContain('Cross-feature deep import not allowed');
    expect(result).toContain('Import:        "../../auth/domain/user"');
    expect(result).toContain(
      'Resolves to:   "./src/features/auth/domain/user.ts"',
    );
    expect(result).toContain('Should use:    "./src/features/auth/index.ts"');
  });

  it('should format summary with no violations', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatSummary([]);

    expect(result).toBe('✓ No violations found');
  });

  it('should format summary with violations', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatSummary([cycleViolation, boundaryViolation]);

    expect(result).toBe(
      '✗ Found 1 import cycle and 1 boundary violation (2 total violations)',
    );
  });

  it('should format summary with only cycle violations', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatSummary([cycleViolation]);

    expect(result).toBe('✗ Found 1 import cycle (1 total violation)');
  });

  it('should format summary with only boundary violations', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatSummary([boundaryViolation]);

    expect(result).toBe('✗ Found 1 boundary violation (1 total violation)');
  });

  it('should handle multiple violations of the same type', () => {
    const reporter = new ColoredReporter({ colors: false });

    const result = reporter.formatSummary([cycleViolation, cycleViolation]);

    expect(result).toBe('✗ Found 2 import cycles (2 total violations)');
  });

  it('should truncate long import cycles', () => {
    const longCycleViolation: Violation = {
      code: 'ARCH_IMPORT_CYCLE',
      file: '/project/src/a.ts',
      line: 1,
      col: 1,
      message:
        'Import cycle detected: /project/src/a.ts -> /project/src/b.ts -> /project/src/c.ts -> /project/src/d.ts -> /project/src/e.ts -> /project/src/f.ts -> /project/src/g.ts -> /project/src/h.ts -> /project/src/a.ts',
    };

    const reporter = new ColoredReporter({ colors: false });
    const result = reporter.formatViolation(longCycleViolation, '/project');

    expect(result).toContain('src/a.ts:1:1 ERROR ARCH_IMPORT_CYCLE');
    expect(result).toContain('Import cycle detected:');
    expect(result).toContain('./src/a.ts');
    expect(result).toContain('./src/b.ts');
    expect(result).toContain('./src/c.ts');
    expect(result).toContain('[... 3 more imports in cycle]');
    expect(result).toContain('./src/g.ts');
    expect(result).toContain('./src/h.ts');
    expect(result).toContain('(Total cycle length: 9 files)');
  });

  it('should not truncate short import cycles', () => {
    const reporter = new ColoredReporter({ colors: false });
    const result = reporter.formatViolation(cycleViolation, '/project');

    expect(result).not.toContain('[... more imports in cycle]');
    expect(result).not.toContain('(Total cycle length:');
  });

  describe('Domain Summary', () => {
    it('should format domain summary with violations grouped by feature', () => {
      const authViolation: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message: 'Import cycle in auth feature',
      };

      const billingViolation: Violation = {
        code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        file: '/project/src/features/billing/invoice.ts',
        line: 1,
        col: 1,
        message: 'Boundary violation in billing',
      };

      const globalViolation: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/utils.ts',
        line: 1,
        col: 1,
        message: 'Global cycle',
      };

      const reporter = new ColoredReporter({ colors: false });
      const config = createDefaultConfig();
      const result = reporter.formatDomainSummary(
        [authViolation, billingViolation, globalViolation],
        config,
      );

      expect(result).toContain('Feature Status:');
      expect(result).toContain('Feature: auth (1 violation)');
      expect(result).toContain('• 1 import cycle');
      expect(result).toContain('Feature: billing (1 violation)');
      expect(result).toContain('• 1 boundary violation');
      expect(result).toContain('Global (non-feature files) (1 violation)');
    });

    it('should return empty string when no violations', () => {
      const reporter = new ColoredReporter({ colors: false });
      const config = createDefaultConfig();
      const result = reporter.formatDomainSummary([], config);

      expect(result).toBe('');
    });

    it('should handle multiple violations in same domain', () => {
      const authCycle: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message: 'Cycle 1',
      };

      const authBoundary: Violation = {
        code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        file: '/project/src/features/auth/login.ts',
        line: 1,
        col: 1,
        message: 'Boundary 1',
      };

      const reporter = new ColoredReporter({ colors: false });
      const config = createDefaultConfig();
      const result = reporter.formatDomainSummary(
        [authCycle, authBoundary],
        config,
      );

      expect(result).toContain('Feature: auth (2 violations)');
      expect(result).toContain('• 1 import cycle');
      expect(result).toContain('• 1 boundary violation');
    });

    it('should handle non-domain import violations', () => {
      const nonDomainViolation: Violation = {
        code: 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
        file: '/project/src/features/auth/user.ts',
        line: 5,
        col: 10,
        message: 'Feature files cannot import from non-domain directories',
      };

      const reporter = new ColoredReporter({ colors: false });
      const config = createDefaultConfig();
      const result = reporter.formatDomainSummary([nonDomainViolation], config);

      expect(result).toContain('Feature Status:');
      expect(result).toContain('Feature: auth (1 violation)');
      expect(result).toContain('• 1 boundary violation');
    });

    it('should display file count and LOC in feature summary', () => {
      const authViolation: Violation = {
        code: 'ARCH_IMPORT_CYCLE',
        file: '/project/src/features/auth/user.ts',
        line: 1,
        col: 1,
        message: 'Import cycle in auth feature',
      };

      const featureStats = [
        {
          feature: 'auth',
          fileCount: 5,
          linesOfCode: 120,
          dependencies: ['users', 'permissions'],
        },
        {
          feature: 'billing',
          fileCount: 3,
          linesOfCode: 85,
          dependencies: ['auth'],
        },
      ];

      const reporter = new ColoredReporter({ colors: false });
      const config = createDefaultConfig();
      const result = reporter.formatDomainSummary(
        [authViolation],
        config,
        ['auth', 'billing'],
        featureStats,
      );

      expect(result).toContain('Feature Status:');
      expect(result).toContain(
        'Feature: auth (1 violation, 5 files, 120 lines)',
      );
      expect(result).toContain('• 1 import cycle');
      expect(result).toContain('• Dependencies: → users, permissions'); // Dependencies now in detail line
      expect(result).toContain('• billing'); // Clean feature with stats and deps
      expect(result).toContain('→ auth'); // Dependencies for clean features
    });

    it('should truncate long dependency lists with ellipsis', () => {
      const featureStats = [
        {
          feature: 'dashboard',
          fileCount: 8,
          linesOfCode: 240,
          dependencies: [
            'auth',
            'users',
            'permissions',
            'analytics',
            'reports',
            'settings',
            'notifications',
            'billing',
          ],
        },
      ];

      const reporter = new ColoredReporter({ colors: false });
      const config = createDefaultConfig();
      const result = reporter.formatDomainSummary(
        [],
        config,
        ['dashboard'],
        featureStats,
      );

      expect(result).toContain('Feature Status:');
      expect(result).toContain('• dashboard');
      expect(result).toContain(
        '→ auth, users, permissions, analytics, reports...',
      );
    });
  });
});
