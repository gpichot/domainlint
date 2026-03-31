import { describe, expect, it } from 'vitest';
import type { PackageRule } from '../config/types.js';
import type { ImportInfo } from '../parser/types.js';
import type { WorkspacePackage } from '../workspace/workspace-detector.js';
import { validatePackageBoundaries } from './package-boundary-validator.js';

const packages: WorkspacePackage[] = [
  { path: '/workspace/packages/core', name: '@myorg/core' },
  { path: '/workspace/packages/feature-auth', name: '@myorg/feature-auth' },
  {
    path: '/workspace/packages/feature-billing',
    name: '@myorg/feature-billing',
  },
  { path: '/workspace/packages/shared', name: '@myorg/shared' },
];

function makeImport(specifier: string, line = 1, col = 1): ImportInfo {
  return { specifier, line, col, isDynamic: false, isTypeOnly: false };
}

describe('validatePackageBoundaries', () => {
  it('returns no violations when there are no package rules', () => {
    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: [],
      fileImports: new Map([
        [
          '/workspace/packages/core/src/index.ts',
          [makeImport('@myorg/feature-auth')],
        ],
      ]),
    });

    expect(violations).toEqual([]);
  });

  it('reports a violation when a denied package is imported', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/service.ts',
          [makeImport('@myorg/feature-auth', 5, 1)],
        ],
      ]),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      code: 'ARCH_NO_PACKAGE_IMPORT',
      file: '/workspace/packages/core/src/service.ts',
      line: 5,
      col: 1,
      message:
        'Package "packages/core" is not allowed to import from "packages/feature-auth" (@myorg/feature-auth)',
    });
  });

  it('does not report violations for allowed imports', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/index.ts',
          [makeImport('@myorg/shared')],
        ],
      ]),
    });

    expect(violations).toEqual([]);
  });

  it('does not report violations for self-imports', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        ['/workspace/packages/core/src/a.ts', [makeImport('@myorg/core')]],
      ]),
    });

    expect(violations).toEqual([]);
  });

  it('ignores relative imports and node builtins', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/index.ts',
          [
            makeImport('./utils'),
            makeImport('../shared'),
            makeImport('node:fs'),
            makeImport('lodash'),
          ],
        ],
      ]),
    });

    expect(violations).toEqual([]);
  });

  it('handles subpath imports (e.g., @myorg/feature-auth/utils)', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/index.ts',
          [makeImport('@myorg/feature-auth/utils')],
        ],
      ]),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('@myorg/feature-auth/utils');
  });

  it('supports multiple deny patterns', () => {
    const rules: PackageRule[] = [
      {
        from: 'packages/core',
        deny: ['packages/feature-auth', 'packages/feature-billing'],
      },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/index.ts',
          [
            makeImport('@myorg/feature-auth'),
            makeImport('@myorg/feature-billing'),
            makeImport('@myorg/shared'),
          ],
        ],
      ]),
    });

    expect(violations).toHaveLength(2);
  });

  it('applies rules only to matching source packages', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    // feature-auth importing feature-billing should be fine (rule only applies to core)
    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/feature-auth/src/index.ts',
          [makeImport('@myorg/feature-billing')],
        ],
      ]),
    });

    expect(violations).toEqual([]);
  });

  it('supports glob patterns in from field', () => {
    const rules: PackageRule[] = [
      { from: 'packages/feature-*', deny: ['packages/core'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/feature-auth/src/index.ts',
          [makeImport('@myorg/core')],
        ],
        [
          '/workspace/packages/feature-billing/src/index.ts',
          [makeImport('@myorg/core')],
        ],
      ]),
    });

    expect(violations).toHaveLength(2);
  });

  it('reports violations from multiple files', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/a.ts',
          [makeImport('@myorg/feature-auth', 3, 1)],
        ],
        [
          '/workspace/packages/core/src/b.ts',
          [makeImport('@myorg/feature-billing', 7, 1)],
        ],
      ]),
    });

    expect(violations).toHaveLength(2);
    expect(violations[0].file).toBe('/workspace/packages/core/src/a.ts');
    expect(violations[1].file).toBe('/workspace/packages/core/src/b.ts');
  });

  it('attributes files to correct package when paths share a prefix', () => {
    const prefixPackages: WorkspacePackage[] = [
      { path: '/workspace/packages/core', name: '@myorg/core' },
      { path: '/workspace/packages/core-utils', name: '@myorg/core-utils' },
    ];

    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/core-utils'] },
    ];

    // File in core-utils importing core should NOT trigger the rule
    // (rule applies to core, not core-utils)
    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages: prefixPackages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core-utils/src/helper.ts',
          [makeImport('@myorg/core')],
        ],
      ]),
    });

    expect(violations).toEqual([]);
  });

  it('reports violation for correct package with prefix collision', () => {
    const prefixPackages: WorkspacePackage[] = [
      { path: '/workspace/packages/core', name: '@myorg/core' },
      { path: '/workspace/packages/core-utils', name: '@myorg/core-utils' },
    ];

    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/core-utils'] },
    ];

    // File in core importing core-utils SHOULD trigger the rule
    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages: prefixPackages,
      packageRules: rules,
      fileImports: new Map([
        [
          '/workspace/packages/core/src/index.ts',
          [makeImport('@myorg/core-utils')],
        ],
      ]),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('"packages/core"');
    expect(violations[0].message).toContain('"packages/core-utils"');
  });

  it('handles files not belonging to any package', () => {
    const rules: PackageRule[] = [
      { from: 'packages/core', deny: ['packages/feature-*'] },
    ];

    const violations = validatePackageBoundaries({
      workspaceRoot: '/workspace',
      packages,
      packageRules: rules,
      fileImports: new Map([
        ['/workspace/scripts/build.ts', [makeImport('@myorg/feature-auth')]],
      ]),
    });

    expect(violations).toEqual([]);
  });
});
