import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { FeatureBoundariesLinter } from '../linter/feature-boundaries-linter.js';
import { loadNativeBinding } from './native-binding.js';
import { runNativePipeline, toNativeOptions } from './native-pipeline.js';

// Behavioural coverage of the native core (parsing, resolution, graph, built-in rules), driven
// through the same entry points the CLI uses. Ports the semantics of the former JS parser,
// resolver, graph builder, cycle detector and feature-boundary validator tests.

let dir: string;

function write(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function config(
  overrides: Partial<FeatureBoundariesConfig> = {},
): FeatureBoundariesConfig {
  return {
    rootDir: dir,
    srcDir: join(dir, 'src'),
    featuresDir: join(dir, 'src/features'),
    barrelFiles: ['index.ts'],
    extensions: ['.ts', '.tsx', '.d.ts'],
    tsconfigPath: join(dir, 'tsconfig.json'),
    exclude: ['**/node_modules/**', '**/dist/**'],
    includeDynamicImports: false,
    ...overrides,
  };
}

const TSCONFIG = JSON.stringify({
  compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
});

beforeEach(() => {
  dir = join(
    tmpdir(),
    `domainlint-native-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, 'src/features'), { recursive: true });
  write({ 'tsconfig.json': TSCONFIG });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(overrides: Partial<FeatureBoundariesConfig> = {}) {
  return runNativePipeline(config(overrides));
}

function rel(p: string): string {
  return p.replace(`${dir}/`, '');
}

describe('native parsing', () => {
  it('extracts static imports, re-exports and type-only flags, keeping externals', () => {
    write({
      'src/a.ts': [
        `import { x } from './b';`,
        `import type { T } from './b';`,
        `import fs from 'node:fs';`,
        `import React from 'react';`,
        `export * from './b';`,
        `export { y } from './b';`,
        `export type { U } from './b';`,
        `export const local = 1;`,
      ].join('\n'),
      'src/b.ts':
        'export const x = 1; export const y = 2; export type T = 1; export type U = 1;',
    });
    const r = run();
    const a = r.parseResults.find((p) => p.filePath.endsWith('src/a.ts'));
    expect(
      a?.imports.map((i) => [i.specifier, i.line, i.isTypeOnly, i.isDynamic]),
    ).toEqual([
      ['./b', 1, false, false],
      ['./b', 2, true, false],
      ['node:fs', 3, false, false],
      ['react', 4, false, false],
      ['./b', 5, false, false],
      ['./b', 6, false, false],
      ['./b', 7, true, false],
    ]);
    // externals produce no edge
    expect(r.graph.edges).toHaveLength(5);
  });

  it('reports 1-based line/column, indented imports and UTF-16 columns', () => {
    write({
      'src/a.ts': `\n\n  import { b } from './b';\nconst s = '😀'; export { b } from './b';\n`,
      'src/b.ts': 'export const b = 1;',
    });
    const a = run().parseResults.find((p) => p.filePath.endsWith('a.ts'));
    expect(a?.imports.map((i) => [i.line, i.col])).toEqual([
      [3, 3],
      [4, 17],
    ]);
  });

  it('only extracts string-literal dynamic imports when enabled', () => {
    write({
      'src/a.ts': `export const f = () => import('./b');\nexport const g = (n: string) => import(n);`,
      'src/b.ts': 'export const b = 1;',
    });
    const off = run().parseResults.find((p) => p.filePath.endsWith('a.ts'));
    expect(off?.imports).toEqual([]);
    const on = run({ includeDynamicImports: true }).parseResults.find((p) =>
      p.filePath.endsWith('a.ts'),
    );
    expect(on?.imports).toEqual([
      {
        specifier: './b',
        line: 1,
        col: 24,
        isDynamic: true,
        isTypeOnly: false,
      },
    ]);
  });

  it('parses .tsx files with JSX', () => {
    write({
      'src/App.tsx': `import { b } from './b';\nexport const App = () => <div>{b}</div>;`,
      'src/b.ts': 'export const b = 1;',
    });
    const r = run();
    expect(r.graph.edges).toHaveLength(1);
  });

  it('throws "Failed to parse <file>" on a syntax error', async () => {
    write({ 'src/bad.ts': 'import { from ;;; <<<' });
    const linter = new FeatureBoundariesLinter(config());
    await expect(linter.lint()).rejects.toThrow(
      /Linting failed: Failed to parse .*src\/bad\.ts: /,
    );
  });

  it('throws when the tsconfig is missing', async () => {
    rmSync(join(dir, 'tsconfig.json'));
    const linter = new FeatureBoundariesLinter(config());
    await expect(linter.lint()).rejects.toThrow(
      /Failed to read tsconfig\.json/,
    );
  });
});

describe('native resolution', () => {
  it('resolves extensions, directory barrels, parent dirs and aliases; drops externals', () => {
    write({
      'src/a.ts': [
        `import './util/x';`,
        `import './dir';`,
        `import '../src/util/x';`,
        `import '@/util/x';`,
        `import './missing';`,
        `import 'some-pkg';`,
        `import 'fs';`,
      ].join('\n'),
      'src/util/x.ts': 'export const x = 1;',
      'src/dir/index.ts': 'export const d = 1;',
    });
    const r = run();
    const targets = r.graph.edges.map((e) =>
      rel(r.graph.normalizedToOriginalPath?.get(e.to) ?? e.to),
    );
    expect(targets).toEqual([
      'src/util/x.ts',
      'src/dir/index.ts',
      'src/util/x.ts',
      'src/util/x.ts',
    ]);
  });

  it('resolveImports returns null for external and unresolved specifiers', () => {
    write({
      'src/a.ts': '',
      'src/util/x.ts': 'export const x = 1;',
    });
    const native = loadNativeBinding();
    const res = native.resolveImports(
      toNativeOptions(config()),
      join(dir, 'src/a.ts'),
      ['./util/x', '@/util/x', 'react', 'node:fs', './nope'],
    );
    expect(res.map((p) => (p ? rel(p) : p))).toEqual([
      'src/util/x.ts',
      'src/util/x.ts',
      null,
      null,
      null,
    ]);
  });
});

describe('native graph', () => {
  it('strips extensions from node keys and maps them back to original paths', () => {
    write({
      'src/a.ts': `import './b';`,
      'src/b.tsx': `export const b = 1;`,
    });
    const g = run().graph;
    expect([...g.nodes].map(rel)).toEqual(['src/a', 'src/b']);
    expect(rel(g.normalizedToOriginalPath?.get(`${dir}/src/b`) ?? '')).toBe(
      'src/b.tsx',
    );
    expect(g.edges.map((e) => [rel(e.from), rel(e.to)])).toEqual([
      ['src/a', 'src/b'],
    ]);
    expect([...(g.adjacencyList.get(`${dir}/src/a`) ?? [])].map(rel)).toEqual([
      'src/b',
    ]);
  });

  it('keeps full paths as keys for Foo.ts / Foo.tsx collisions and sorts files', () => {
    write({
      'src/Foo.tsx': `import { f } from './Foo';`,
      'src/Foo.ts': `export const f = 1;`,
      'src/a.ts': '',
    });
    const r = run();
    expect(r.files.map((f) => rel(f.path))).toEqual([
      'src/Foo.ts',
      'src/Foo.tsx',
      'src/a.ts',
    ]);
    expect([...r.graph.nodes].map(rel)).toEqual([
      'src/Foo.ts',
      'src/Foo.tsx',
      'src/a',
    ]);
    expect(r.violations).toEqual([]);
  });

  it('does not add edges for files outside the discovered set', () => {
    write({
      'src/a.ts': `import '../lib/other';`,
      'lib/other.ts': 'export const o = 1;',
    });
    expect(run().graph.edges).toEqual([]);
  });

  it('reports file info: relative path, feature and barrel flag', () => {
    write({
      'src/features/auth/index.ts': '',
      'src/features/auth/user.ts': '',
      'src/shared.ts': '',
    });
    const files = run().files;
    expect(files.map((f) => [f.relativePath, f.feature, f.isBarrel])).toEqual([
      ['src/features/auth/index.ts', 'auth', true],
      ['src/features/auth/user.ts', 'auth', false],
      ['src/shared.ts', null, false],
    ]);
  });
});

describe('native built-in rules', () => {
  it('detects self-loops, 3-node cycles and independent cycles, once per start', () => {
    write({
      'src/self.ts': `import './self';`,
      'src/a.ts': `\nimport './b';`,
      'src/b.ts': `import './c';`,
      'src/c.ts': `import './a';`,
      'src/x.ts': `import './y';`,
      'src/y.ts': `import './x';`,
    });
    const cycles = run().violations.filter((v) => v.code === 'noImportCycle');
    expect(cycles.map((v) => v.message.replaceAll(`${dir}/`, ''))).toEqual([
      'Import cycle detected: src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts',
      'Import cycle detected: src/self.ts -> src/self.ts',
      'Import cycle detected: src/x.ts -> src/y.ts -> src/x.ts',
    ]);
    // line/col come from the first edge of the cycle
    expect(cycles[0]).toMatchObject({ line: 2, col: 1 });
  });

  it('reports no cycles for DAGs with shared nodes', () => {
    write({
      'src/a.ts': `import './b'; import './c';`,
      'src/b.ts': `import './d';`,
      'src/c.ts': `import './d';`,
      'src/d.ts': '',
    });
    expect(run().violations).toEqual([]);
  });

  it('produces JS-identical boundary messages', () => {
    write({
      'src/features/a/index.ts': '',
      'src/features/b/inner.ts': '',
      'src/features/a/use.ts': `import '../b/inner';\nimport '../../shared';`,
      'src/shared.ts': '',
    });
    const v = run({
      overrides: {
        global: { rules: { 'no-external-feature-imports': 'error' } },
      },
    }).violations;
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({
      code: 'noCrossFeatureDeepImport',
      file: `${dir}/src/features/a/use.ts`,
      line: 1,
      col: 1,
      message: `Cross-feature deep import not allowed. Import "../b/inner" resolves to "${dir}/src/features/b/inner.ts" but should import from feature barrel "${dir}/src/features/b/index.ts" instead.`,
    });
    expect(v[1]).toMatchObject({
      code: 'noFeatureImportFromNonDomain',
      line: 2,
      message: `Feature files cannot import from non-domain directories. Import "../../shared" resolves to "${dir}/src/shared.ts" which is outside the features directory. Feature files should only import from within features or feature barrel files.`,
    });
  });

  it('honours multiple barrel files', () => {
    write({
      'src/features/a/use.ts': `import '../b';`,
      'src/features/b/index.tsx': '',
    });
    expect(run({ barrelFiles: ['index.ts', 'index.tsx'] }).violations).toEqual(
      [],
    );
    expect(run().violations.map((v) => v.code)).toEqual([
      'noCrossFeatureDeepImport',
    ]);
  });

  it('does not compute a rule that is off globally and in every feature override', () => {
    write({
      'src/features/a/use.ts': `import '../b/inner';`,
      'src/features/b/inner.ts': '',
    });
    const off = { 'cross-feature-imports': 'off' as const };
    expect(run({ overrides: { global: { rules: off } } }).violations).toEqual(
      [],
    );
    // re-enabled for one feature: still computed, filtered later in JS
    expect(
      run({
        overrides: {
          global: { rules: off },
          features: { a: { rules: { 'cross-feature-imports': 'warn' } } },
        },
      }).violations,
    ).toHaveLength(1);
  });
});
