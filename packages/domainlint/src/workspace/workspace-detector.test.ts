import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectWorkspace,
  parsePnpmWorkspaceYaml,
} from './workspace-detector.js';

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

vi.mock('glob', () => ({
  glob: async (pattern: string, options: { cwd?: string } = {}) => {
    const cwd = options.cwd || process.cwd();
    // Simple glob expansion for "packages/*" style patterns
    const allPaths = Object.keys(vol.toJSON());
    const dirs = new Set<string>();
    for (const p of allPaths) {
      if (p.startsWith(cwd)) {
        const rel = p.slice(cwd.length + 1);
        // Match "packages/*" pattern
        if (pattern.endsWith('/*')) {
          const prefix = pattern.slice(0, -2);
          if (rel.startsWith(prefix + '/')) {
            const rest = rel.slice(prefix.length + 1);
            const firstDir = rest.split('/')[0];
            dirs.add(`${cwd}/${prefix}/${firstDir}`);
          }
        }
      }
    }
    return [...dirs];
  },
}));

beforeEach(() => vol.reset());

describe('parsePnpmWorkspaceYaml', () => {
  it('parses simple packages list', () => {
    const yaml = `packages:\n  - packages/*\n  - apps/*\n`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['packages/*', 'apps/*']);
  });

  it('handles quoted patterns', () => {
    const yaml = `packages:\n  - 'packages/*'\n  - "apps/*"\n`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['packages/*', 'apps/*']);
  });

  it('returns empty array for no packages key', () => {
    const yaml = `someOtherKey:\n  - foo\n`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual([]);
  });

  it('stops at next top-level key', () => {
    const yaml = `packages:\n  - packages/*\ncatalog:\n  react: ^18\n`;
    expect(parsePnpmWorkspaceYaml(yaml)).toEqual(['packages/*']);
  });
});

describe('detectWorkspace', () => {
  it('detects pnpm workspace', async () => {
    vol.fromJSON({
      '/workspace/pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      '/workspace/packages/core/package.json': JSON.stringify({
        name: '@my/core',
      }),
      '/workspace/packages/ui/package.json': JSON.stringify({
        name: '@my/ui',
      }),
    });

    const result = await detectWorkspace('/workspace');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('pnpm');
    expect(result!.root).toBe('/workspace');
    expect(result!.packages).toHaveLength(2);
    expect(result!.packages.map((p) => p.name)).toEqual(['@my/core', '@my/ui']);
  });

  it('detects npm workspace from package.json', async () => {
    vol.fromJSON({
      '/workspace/package.json': JSON.stringify({
        name: 'my-monorepo',
        workspaces: ['packages/*'],
      }),
      '/workspace/packages/lib/package.json': JSON.stringify({
        name: '@my/lib',
      }),
    });

    const result = await detectWorkspace('/workspace');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('npm');
    expect(result!.packages).toHaveLength(1);
    expect(result!.packages[0].name).toBe('@my/lib');
  });

  it('detects yarn workspace with yarn.lock present', async () => {
    vol.fromJSON({
      '/workspace/package.json': JSON.stringify({
        name: 'my-monorepo',
        workspaces: ['packages/*'],
      }),
      '/workspace/yarn.lock': '',
      '/workspace/packages/app/package.json': JSON.stringify({
        name: '@my/app',
      }),
    });

    const result = await detectWorkspace('/workspace');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('yarn');
  });

  it('detects yarn classic workspaces format', async () => {
    vol.fromJSON({
      '/workspace/package.json': JSON.stringify({
        name: 'my-monorepo',
        workspaces: { packages: ['packages/*'] },
      }),
      '/workspace/yarn.lock': '',
      '/workspace/packages/app/package.json': JSON.stringify({
        name: '@my/app',
      }),
    });

    const result = await detectWorkspace('/workspace');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('yarn');
    expect(result!.packages).toHaveLength(1);
  });

  it('returns null when no workspace config found', async () => {
    vol.fromJSON({
      '/project/package.json': JSON.stringify({ name: 'simple-project' }),
      '/project/src/index.ts': '',
    });

    const result = await detectWorkspace('/project');
    expect(result).toBeNull();
  });

  it('skips directories without package.json', async () => {
    vol.fromJSON({
      '/workspace/pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      '/workspace/packages/core/package.json': JSON.stringify({
        name: '@my/core',
      }),
      '/workspace/packages/no-pkg/src/index.ts': 'export {}',
    });

    const result = await detectWorkspace('/workspace');

    expect(result).not.toBeNull();
    expect(result!.packages).toHaveLength(1);
    expect(result!.packages[0].name).toBe('@my/core');
  });
});
