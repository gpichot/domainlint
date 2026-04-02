import { describe, expect, it } from 'vitest';
import type { ImportInfo } from '../parser/types.js';
import type { WorkspacePackage } from '../workspace/workspace-detector.js';
import {
  buildPackageImportEdges,
  runWorkspaceRules,
  type WorkspaceRule,
} from './workspace-rules.js';

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

describe('buildPackageImportEdges', () => {
  it('builds edges from file imports to workspace packages', () => {
    const fileImports = new Map([
      [
        '/workspace/packages/core/src/service.ts',
        [makeImport('@myorg/feature-auth', 5, 1)],
      ],
    ]);

    const edges = buildPackageImportEdges('/workspace', packages, fileImports);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      fromPackage: 'packages/core',
      toPackage: 'packages/feature-auth',
      file: '/workspace/packages/core/src/service.ts',
      specifier: '@myorg/feature-auth',
      line: 5,
      col: 1,
    });
  });

  it('skips self-imports', () => {
    const fileImports = new Map([
      ['/workspace/packages/core/src/a.ts', [makeImport('@myorg/core')]],
    ]);

    const edges = buildPackageImportEdges('/workspace', packages, fileImports);

    expect(edges).toEqual([]);
  });

  it('skips relative imports and node builtins', () => {
    const fileImports = new Map([
      [
        '/workspace/packages/core/src/index.ts',
        [makeImport('./utils'), makeImport('node:fs'), makeImport('lodash')],
      ],
    ]);

    const edges = buildPackageImportEdges('/workspace', packages, fileImports);

    expect(edges).toEqual([]);
  });

  it('handles subpath imports', () => {
    const fileImports = new Map([
      [
        '/workspace/packages/core/src/index.ts',
        [makeImport('@myorg/feature-auth/utils')],
      ],
    ]);

    const edges = buildPackageImportEdges('/workspace', packages, fileImports);

    expect(edges).toHaveLength(1);
    expect(edges[0].specifier).toBe('@myorg/feature-auth/utils');
  });

  it('avoids prefix collisions (core vs core-utils)', () => {
    const pkgs: WorkspacePackage[] = [
      { path: '/workspace/packages/core', name: '@myorg/core' },
      { path: '/workspace/packages/core-utils', name: '@myorg/core-utils' },
    ];

    const fileImports = new Map([
      [
        '/workspace/packages/core-utils/src/helper.ts',
        [makeImport('@myorg/core')],
      ],
    ]);

    const edges = buildPackageImportEdges('/workspace', pkgs, fileImports);

    expect(edges).toHaveLength(1);
    expect(edges[0].fromPackage).toBe('packages/core-utils');
    expect(edges[0].toPackage).toBe('packages/core');
  });
});

describe('runWorkspaceRules', () => {
  it('runs rules and collects violations', async () => {
    const rule: WorkspaceRule = {
      name: 'test-rule',
      check({ emitViolation }) {
        emitViolation({
          code: 'TEST_VIOLATION',
          file: '/test.ts',
          line: 1,
          col: 1,
          message: 'Test violation',
        });
      },
    };

    const violations = await runWorkspaceRules([rule], {
      packages: [],
      edges: [],
      packageRules: [],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('TEST_VIOLATION');
  });

  it('auto-generates violation code from rule name', async () => {
    const rule: WorkspaceRule = {
      name: 'my-custom-rule',
      check({ emitViolation }) {
        emitViolation({
          file: '/test.ts',
          line: 1,
          col: 1,
          message: 'Test',
        });
      },
    };

    const violations = await runWorkspaceRules([rule], {
      packages: [],
      edges: [],
      packageRules: [],
    });

    expect(violations[0].code).toBe('CUSTOM_MY_CUSTOM_RULE');
  });

  it('propagates errors from rules', async () => {
    const rule: WorkspaceRule = {
      name: 'bad-rule',
      check() {
        throw new Error('Rule exploded');
      },
    };

    await expect(
      runWorkspaceRules([rule], {
        packages: [],
        edges: [],
        packageRules: [],
      }),
    ).rejects.toThrow(
      'Workspace rule "bad-rule" threw an error: Rule exploded',
    );
  });
});
