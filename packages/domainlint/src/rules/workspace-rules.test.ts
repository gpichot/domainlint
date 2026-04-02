import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportInfo } from '../parser/types.js';
import type { WorkspacePackage } from '../workspace/workspace-detector.js';
import {
  buildPackageImportEdges,
  buildPackageJsonEdges,
  runWorkspaceRules,
  type WorkspaceRule,
} from './workspace-rules.js';

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

beforeEach(() => vol.reset());

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

describe('buildPackageJsonEdges', () => {
  it('builds edges from package.json dependencies', async () => {
    vol.fromJSON({
      '/workspace/packages/core/package.json': JSON.stringify({
        name: '@myorg/core',
        dependencies: { '@myorg/shared': '^1.0.0' },
      }),
      '/workspace/packages/shared/package.json': JSON.stringify({
        name: '@myorg/shared',
      }),
    });

    const pkgs: WorkspacePackage[] = [
      { path: '/workspace/packages/core', name: '@myorg/core' },
      { path: '/workspace/packages/shared', name: '@myorg/shared' },
    ];

    const edges = await buildPackageJsonEdges('/workspace', pkgs);

    expect(edges).toHaveLength(1);
    expect(edges[0].fromPackage).toBe('packages/core');
    expect(edges[0].toPackage).toBe('packages/shared');
    expect(edges[0].file).toBe('/workspace/packages/core/package.json');
    expect(edges[0].specifier).toBe('@myorg/shared');
  });

  it('reads devDependencies and peerDependencies', async () => {
    vol.fromJSON({
      '/workspace/packages/app/package.json': JSON.stringify({
        name: '@myorg/app',
        devDependencies: { '@myorg/test-utils': '^1.0.0' },
        peerDependencies: { '@myorg/core': '^1.0.0' },
      }),
      '/workspace/packages/core/package.json': JSON.stringify({
        name: '@myorg/core',
      }),
      '/workspace/packages/test-utils/package.json': JSON.stringify({
        name: '@myorg/test-utils',
      }),
    });

    const pkgs: WorkspacePackage[] = [
      { path: '/workspace/packages/app', name: '@myorg/app' },
      { path: '/workspace/packages/core', name: '@myorg/core' },
      { path: '/workspace/packages/test-utils', name: '@myorg/test-utils' },
    ];

    const edges = await buildPackageJsonEdges('/workspace', pkgs);

    expect(edges).toHaveLength(2);
    const targets = edges.map((e) => e.toPackage).sort();
    expect(targets).toEqual(['packages/core', 'packages/test-utils']);
  });

  it('ignores external dependencies', async () => {
    vol.fromJSON({
      '/workspace/packages/core/package.json': JSON.stringify({
        name: '@myorg/core',
        dependencies: { lodash: '^4.0.0', react: '^18.0.0' },
      }),
    });

    const pkgs: WorkspacePackage[] = [
      { path: '/workspace/packages/core', name: '@myorg/core' },
    ];

    const edges = await buildPackageJsonEdges('/workspace', pkgs);

    expect(edges).toEqual([]);
  });

  it('ignores self-dependencies', async () => {
    vol.fromJSON({
      '/workspace/packages/core/package.json': JSON.stringify({
        name: '@myorg/core',
        dependencies: { '@myorg/core': '^1.0.0' },
      }),
    });

    const pkgs: WorkspacePackage[] = [
      { path: '/workspace/packages/core', name: '@myorg/core' },
    ];

    const edges = await buildPackageJsonEdges('/workspace', pkgs);

    expect(edges).toEqual([]);
  });

  it('detects a cycle via package.json deps', async () => {
    vol.fromJSON({
      '/workspace/packages/a/package.json': JSON.stringify({
        name: '@myorg/a',
        dependencies: { '@myorg/b': '^1.0.0' },
      }),
      '/workspace/packages/b/package.json': JSON.stringify({
        name: '@myorg/b',
        dependencies: { '@myorg/a': '^1.0.0' },
      }),
    });

    const pkgs: WorkspacePackage[] = [
      { path: '/workspace/packages/a', name: '@myorg/a' },
      { path: '/workspace/packages/b', name: '@myorg/b' },
    ];

    const edges = await buildPackageJsonEdges('/workspace', pkgs);

    expect(edges).toHaveLength(2);
    expect(edges[0].fromPackage).toBe('packages/a');
    expect(edges[0].toPackage).toBe('packages/b');
    expect(edges[1].fromPackage).toBe('packages/b');
    expect(edges[1].toPackage).toBe('packages/a');
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
