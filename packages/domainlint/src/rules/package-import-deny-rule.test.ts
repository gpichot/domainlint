import { describe, expect, it } from 'vitest';
import type { PackageImportRestriction } from '../config/types.js';
import type { Violation } from '../graph/types.js';
import { packageImportDenyRule } from './package-import-deny-rule.js';
import type {
  PackageImportEdge,
  WorkspacePackageInfo,
} from './workspace-rules.js';

const packages: WorkspacePackageInfo[] = [
  {
    name: '@myorg/core',
    path: '/workspace/packages/core',
    relPath: 'packages/core',
  },
  {
    name: '@myorg/feature-auth',
    path: '/workspace/packages/feature-auth',
    relPath: 'packages/feature-auth',
  },
  {
    name: '@myorg/feature-billing',
    path: '/workspace/packages/feature-billing',
    relPath: 'packages/feature-billing',
  },
  {
    name: '@myorg/shared',
    path: '/workspace/packages/shared',
    relPath: 'packages/shared',
  },
];

function runDenyRule(
  edges: PackageImportEdge[],
  packageRules: PackageImportRestriction[],
): Violation[] {
  const violations: Violation[] = [];
  packageImportDenyRule.check({
    packages,
    edges,
    packageRules,
    emitViolation: (result) => {
      violations.push({
        code: result.code || 'noPackageImport',
        file: result.file,
        line: result.line,
        col: result.col,
        message: result.message,
      });
    },
  });
  return violations;
}

describe('packageImportDenyRule', () => {
  it('returns no violations when there are no rules', () => {
    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/feature-auth',
        file: '/workspace/packages/core/src/service.ts',
        specifier: '@myorg/feature-auth',
        line: 5,
        col: 1,
      },
    ];

    const violations = runDenyRule(edges, []);
    expect(violations).toEqual([]);
  });

  it('reports a violation when a denied package is imported', () => {
    const rules: PackageImportRestriction[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/feature-auth',
        file: '/workspace/packages/core/src/service.ts',
        specifier: '@myorg/feature-auth',
        line: 5,
        col: 1,
      },
    ];

    const violations = runDenyRule(edges, rules);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      code: 'noPackageImport',
      file: '/workspace/packages/core/src/service.ts',
      line: 5,
      col: 1,
      message:
        'Package "packages/core" is not allowed to import from "packages/feature-auth" (@myorg/feature-auth)',
    });
  });

  it('does not report violations for allowed imports', () => {
    const rules: PackageImportRestriction[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/core',
        toPackage: 'packages/shared',
        file: '/workspace/packages/core/src/index.ts',
        specifier: '@myorg/shared',
        line: 1,
        col: 1,
      },
    ];

    const violations = runDenyRule(edges, rules);
    expect(violations).toEqual([]);
  });

  it('applies rules only to matching source packages', () => {
    const rules: PackageImportRestriction[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/feature-auth',
        toPackage: 'packages/feature-billing',
        file: '/workspace/packages/feature-auth/src/index.ts',
        specifier: '@myorg/feature-billing',
        line: 1,
        col: 1,
      },
    ];

    const violations = runDenyRule(edges, rules);
    expect(violations).toEqual([]);
  });

  it('supports glob patterns in from field', () => {
    const rules: PackageImportRestriction[] = [
      { from: 'packages/feature-*', deny: ['packages/core'] },
    ];

    const edges: PackageImportEdge[] = [
      {
        fromPackage: 'packages/feature-auth',
        toPackage: 'packages/core',
        file: '/workspace/packages/feature-auth/src/index.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
      {
        fromPackage: 'packages/feature-billing',
        toPackage: 'packages/core',
        file: '/workspace/packages/feature-billing/src/index.ts',
        specifier: '@myorg/core',
        line: 1,
        col: 1,
      },
    ];

    const violations = runDenyRule(edges, rules);
    expect(violations).toHaveLength(2);
  });
});
