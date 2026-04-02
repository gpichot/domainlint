import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import type { ParseResult } from '../parser/types.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';
import { DependencyGraphBuilder } from './dependency-graph.js';

let testDir: string;

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `domainlint-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  // Write a minimal tsconfig.json
  writeFileSync(
    join(testDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: {} }),
  );
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeConfig(): FeatureBoundariesConfig {
  return {
    rootDir: testDir,
    srcDir: join(testDir, 'src'),
    featuresDir: join(testDir, 'src/features'),
    barrelFiles: ['index.ts'],
    extensions: ['.ts', '.tsx'],
    tsconfigPath: join(testDir, 'tsconfig.json'),
    exclude: [],
    includeDynamicImports: false,
  };
}

const makeTsConfig = (): ResolvedTsConfig => ({ rootDir: testDir });

function makeFileInfo(path: string): FileInfo {
  return {
    path,
    relativePath: path.replace(`${testDir}/`, ''),
    feature: null,
    isBarrel: false,
  };
}

function makeParseResult(filePath: string, specifiers: string[]): ParseResult {
  return {
    filePath,
    imports: specifiers.map((s) => ({
      specifier: s,
      line: 1,
      col: 1,
      isDynamic: false,
      isTypeOnly: false,
    })),
  };
}

describe('DependencyGraphBuilder', () => {
  describe('graph construction', () => {
    it('builds a graph with all files as nodes', async () => {
      writeFile('src/a.ts', '');
      writeFile('src/b.ts', '');
      const files = [
        makeFileInfo(join(testDir, 'src/a.ts')),
        makeFileInfo(join(testDir, 'src/b.ts')),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.size).toBe(2);
    });

    it('adds an edge for a resolved local import', async () => {
      writeFile('src/a.ts', `import { b } from './b';`);
      writeFile('src/b.ts', 'export const b = 1;');
      const files = [
        makeFileInfo(join(testDir, 'src/a.ts')),
        makeFileInfo(join(testDir, 'src/b.ts')),
      ];
      const parseResults = [
        makeParseResult(join(testDir, 'src/a.ts'), ['./b']),
        makeParseResult(join(testDir, 'src/b.ts'), []),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(1);
    });

    it('does not add edges for external imports', async () => {
      writeFile('src/a.ts', `import { foo } from 'lodash';`);
      const files = [makeFileInfo(join(testDir, 'src/a.ts'))];
      const parseResults = [
        makeParseResult(join(testDir, 'src/a.ts'), ['lodash']),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(0);
    });

    it('does not add edges when the resolved file is not in the files list', async () => {
      writeFile('src/a.ts', '');
      writeFile('src/outside.ts', '');
      const files = [makeFileInfo(join(testDir, 'src/a.ts'))];
      const parseResults = [
        makeParseResult(join(testDir, 'src/a.ts'), ['./outside']),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe('path normalization', () => {
    it('strips extensions from node paths', async () => {
      writeFile('src/a.ts', '');
      writeFile('src/b.ts', '');
      const files = [
        makeFileInfo(join(testDir, 'src/a.ts')),
        makeFileInfo(join(testDir, 'src/b.ts')),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.has(join(testDir, 'src/a'))).toBe(true);
      expect(graph.nodes.has(join(testDir, 'src/b'))).toBe(true);
    });

    it('populates normalizedToOriginalPath map', async () => {
      writeFile('src/a.ts', '');
      const files = [makeFileInfo(join(testDir, 'src/a.ts'))];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, []);
      expect(graph.normalizedToOriginalPath?.get(join(testDir, 'src/a'))).toBe(
        join(testDir, 'src/a.ts'),
      );
    });

    it('edges use normalized paths', async () => {
      writeFile('src/a.ts', '');
      writeFile('src/b.ts', '');
      const files = [
        makeFileInfo(join(testDir, 'src/a.ts')),
        makeFileInfo(join(testDir, 'src/b.ts')),
      ];
      const parseResults = [
        makeParseResult(join(testDir, 'src/a.ts'), ['./b']),
        makeParseResult(join(testDir, 'src/b.ts'), ['./a']),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges[0].from).toBe(join(testDir, 'src/a'));
      expect(graph.edges[0].to).toBe(join(testDir, 'src/b'));
    });
  });

  describe('extension collision handling', () => {
    it('keeps full paths when .ts and .tsx files share the same base name', async () => {
      writeFile('src/ScoreGauge.ts', '');
      writeFile('src/ScoreGauge.tsx', '');
      const files = [
        makeFileInfo(join(testDir, 'src/ScoreGauge.ts')),
        makeFileInfo(join(testDir, 'src/ScoreGauge.tsx')),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has(join(testDir, 'src/ScoreGauge.ts'))).toBe(true);
      expect(graph.nodes.has(join(testDir, 'src/ScoreGauge.tsx'))).toBe(true);
    });

    it('does not produce a false self-cycle when .tsx imports from same-name .ts', async () => {
      writeFile('src/ScoreGauge.ts', 'export const data = 1;');
      writeFile('src/ScoreGauge.tsx', '');
      const files = [
        makeFileInfo(join(testDir, 'src/ScoreGauge.ts')),
        makeFileInfo(join(testDir, 'src/ScoreGauge.tsx')),
      ];
      const parseResults = [
        makeParseResult(join(testDir, 'src/ScoreGauge.tsx'), ['./ScoreGauge']),
        makeParseResult(join(testDir, 'src/ScoreGauge.ts'), []),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, parseResults);

      // Edge should go from .tsx to .ts, not create a self-loop
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].from).toBe(join(testDir, 'src/ScoreGauge.tsx'));
      expect(graph.edges[0].to).toBe(join(testDir, 'src/ScoreGauge.ts'));
    });

    it('still normalizes non-colliding files', async () => {
      writeFile('src/a.ts', '');
      writeFile('src/ScoreGauge.ts', '');
      writeFile('src/ScoreGauge.tsx', '');
      const files = [
        makeFileInfo(join(testDir, 'src/a.ts')),
        makeFileInfo(join(testDir, 'src/ScoreGauge.ts')),
        makeFileInfo(join(testDir, 'src/ScoreGauge.tsx')),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, []);
      // a.ts has no collision, should be normalized
      expect(graph.nodes.has(join(testDir, 'src/a'))).toBe(true);
      // ScoreGauge files collide, should keep full paths
      expect(graph.nodes.has(join(testDir, 'src/ScoreGauge.ts'))).toBe(true);
      expect(graph.nodes.has(join(testDir, 'src/ScoreGauge.tsx'))).toBe(true);
    });
  });

  describe('adjacency list', () => {
    it('updates adjacency list for each edge', async () => {
      writeFile('src/a.ts', '');
      writeFile('src/b.ts', '');
      const files = [
        makeFileInfo(join(testDir, 'src/a.ts')),
        makeFileInfo(join(testDir, 'src/b.ts')),
      ];
      const parseResults = [
        makeParseResult(join(testDir, 'src/a.ts'), ['./b']),
        makeParseResult(join(testDir, 'src/b.ts'), []),
      ];
      const builder = new DependencyGraphBuilder(makeConfig(), makeTsConfig());
      const graph = await builder.buildGraph(files, parseResults);
      expect(
        graph.adjacencyList
          .get(join(testDir, 'src/a'))
          ?.has(join(testDir, 'src/b')),
      ).toBe(true);
    });
  });
});
