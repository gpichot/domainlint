import { describe, expect, it } from 'vitest';
import type { Violation } from '../graph/types.js';
import { packageCycleRule } from './package-cycle-detector.js';
import type {
  PackageImportEdge,
  WorkspacePackageInfo,
} from './workspace-rules.js';

const packages: WorkspacePackageInfo[] = [
  { name: '@myorg/core', path: '/w/packages/core', relPath: 'packages/core' },
  { name: '@myorg/auth', path: '/w/packages/auth', relPath: 'packages/auth' },
  {
    name: '@myorg/billing',
    path: '/w/packages/billing',
    relPath: 'packages/billing',
  },
];

function runCycleRule(edges: PackageImportEdge[]): Violation[] {
  const violations: Violation[] = [];
  packageCycleRule.check({
    packages,
    edges,
    packageRules: [],
    emitViolation: (result) => {
      violations.push({
        code: result.code || 'noPackageCycle',
        file: result.file,
        line: result.line,
        col: result.col,
        message: result.message,
      });
    },
  });
  return violations;
}

describe('packageCycleRule', () => {
  it('reports no violations when there are no cycles', () => {
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/core',
        file: '/w/packages/auth/src/index.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
    ];

    const violations = runCycleRule(edges);
    expect(violations).toEqual([]);
  });

  it('detects a 2-package cycle', () => {
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/auth',
        file: '/w/packages/core/src/a.ts',
        specifier: '@myorg/auth',
        line: 3,
        col: 1,
      },
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/core',
        file: '/w/packages/auth/src/b.ts',
        specifier: '@myorg/core',
        line: 5,
        col: 1,
      },
    ];

    const violations = runCycleRule(edges);

    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('noPackageCycle');
    expect(violations[0].message).toContain('Package cycle detected');
    expect(violations[0].message).toContain('packages/core');
    expect(violations[0].message).toContain('packages/auth');
  });

  it('detects a 3-package cycle', () => {
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/auth',
        file: '/w/packages/core/src/a.ts',
        specifier: '@myorg/auth',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/billing',
        file: '/w/packages/auth/src/b.ts',
        specifier: '@myorg/billing',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/billing',
        toPackage: 'packages/core',
        file: '/w/packages/billing/src/c.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
    ];

    const violations = runCycleRule(edges);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('Package cycle detected');
  });

  it('reports no violations when there are no edges', () => {
    const violations = runCycleRule([]);
    expect(violations).toEqual([]);
  });

  it('does not report duplicate cycles', () => {
    // Two edges in each direction (from different files) should still
    // produce only one cycle violation
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/auth',
        file: '/w/packages/core/src/a.ts',
        specifier: '@myorg/auth',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/auth',
        file: '/w/packages/core/src/b.ts',
        specifier: '@myorg/auth',
        line: 2,
        col: 1,
      },
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/core',
        file: '/w/packages/auth/src/c.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
    ];

    const violations = runCycleRule(edges);
    expect(violations).toHaveLength(1);
  });

  it('only reports the shortest cycle when a longer one contains it', () => {
    // A→B→A is a 2-cycle, A→B→C→A is a 3-cycle containing {A,B}.
    // Only the 2-cycle should be reported.
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/auth',
        file: '/w/packages/core/src/a.ts',
        specifier: '@myorg/auth',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/core',
        file: '/w/packages/auth/src/b.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/billing',
        file: '/w/packages/auth/src/c.ts',
        specifier: '@myorg/billing',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/billing',
        toPackage: 'packages/core',
        file: '/w/packages/billing/src/d.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
    ];

    const violations = runCycleRule(edges);

    // Only the short cycle (core ↔ auth) should be reported,
    // not the longer core → auth → billing → core
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('packages/core');
    expect(violations[0].message).toContain('packages/auth');
    expect(violations[0].message).not.toContain('packages/billing');
  });

  it('reports independent cycles separately', () => {
    // Two independent cycles: A↔B and C↔D
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/auth',
        file: '/w/packages/core/src/a.ts',
        specifier: '@myorg/auth',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/auth',
        toPackage: 'packages/core',
        file: '/w/packages/auth/src/b.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/billing',
        toPackage: 'packages/shared',
        file: '/w/packages/billing/src/c.ts',
        specifier: '@myorg/shared',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/shared',
        toPackage: 'packages/billing',
        file: '/w/packages/shared/src/d.ts',
        specifier: '@myorg/billing',
        line: 1,
        col: 1,
      },
    ];

    const violations = runCycleRule(edges);

    expect(violations).toHaveLength(2);
  });
});
