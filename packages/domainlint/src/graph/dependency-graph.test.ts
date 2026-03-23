import { vol } from 'memfs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import type { ParseResult } from '../parser/types.js';
import { createTestFs } from '../test-utils/setup.js';
import type { ResolvedTsConfig } from '../tsconfig/types.js';
import { DependencyGraphBuilder } from './dependency-graph.js';

beforeEach(() => vol.reset());

const testFs = createTestFs();

const config: FeatureBoundariesConfig = {
  rootDir: '/project',
  srcDir: '/project/src',
  featuresDir: '/project/src/features',
  barrelFiles: ['index.ts'],
  extensions: ['.ts', '.tsx'],
  tsconfigPath: '/project/tsconfig.json',
  exclude: [],
  includeDynamicImports: false,
};

const tsconfig: ResolvedTsConfig = { rootDir: '/project' };

function makeFileInfo(path: string): FileInfo {
  return {
    path,
    relativePath: path.replace('/project/', ''),
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
    exports: [],
  };
}

describe('DependencyGraphBuilder', () => {
  describe('graph construction', () => {
    it('builds a graph with all files as nodes', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/b.ts': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/b.ts'),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.size).toBe(2);
    });

    it('adds an edge for a resolved local import', async () => {
      vol.fromJSON({
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': 'export const b = 1;',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/b.ts'),
      ];
      const parseResults = [
        makeParseResult('/project/src/a.ts', ['./b']),
        makeParseResult('/project/src/b.ts', []),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(1);
    });

    it('does not add edges for external imports', async () => {
      vol.fromJSON({ '/project/src/a.ts': `import { foo } from 'lodash';` });
      const files = [makeFileInfo('/project/src/a.ts')];
      const parseResults = [makeParseResult('/project/src/a.ts', ['lodash'])];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(0);
    });

    it('does not add edges when the resolved file is not in the files list', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/outside.ts': '',
      });
      const files = [makeFileInfo('/project/src/a.ts')];
      const parseResults = [
        makeParseResult('/project/src/a.ts', ['./outside']),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe('path normalization', () => {
    it('strips extensions from node paths', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/b.ts': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/b.ts'),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.has('/project/src/a')).toBe(true);
      expect(graph.nodes.has('/project/src/b')).toBe(true);
    });

    it('populates normalizedToOriginalPath map', async () => {
      vol.fromJSON({ '/project/src/a.ts': '' });
      const files = [makeFileInfo('/project/src/a.ts')];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      expect(graph.normalizedToOriginalPath?.get('/project/src/a')).toBe(
        '/project/src/a.ts',
      );
    });

    it('edges use normalized paths', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/b.ts': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/b.ts'),
      ];
      const parseResults = [
        makeParseResult('/project/src/a.ts', ['./b']),
        makeParseResult('/project/src/b.ts', ['./a']),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges[0].from).toBe('/project/src/a');
      expect(graph.edges[0].to).toBe('/project/src/b');
    });
  });

  describe('extension collision handling', () => {
    it('keeps full paths when .ts and .tsx files share the same base name', async () => {
      vol.fromJSON({
        '/project/src/ScoreGauge.ts': '',
        '/project/src/ScoreGauge.tsx': '',
      });
      const files = [
        makeFileInfo('/project/src/ScoreGauge.ts'),
        makeFileInfo('/project/src/ScoreGauge.tsx'),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has('/project/src/ScoreGauge.ts')).toBe(true);
      expect(graph.nodes.has('/project/src/ScoreGauge.tsx')).toBe(true);
    });

    it('does not produce a false self-cycle when .tsx imports from same-name .ts', async () => {
      vol.fromJSON({
        '/project/src/ScoreGauge.ts': 'export const data = 1;',
        '/project/src/ScoreGauge.tsx': '',
      });
      const files = [
        makeFileInfo('/project/src/ScoreGauge.ts'),
        makeFileInfo('/project/src/ScoreGauge.tsx'),
      ];
      const parseResults = [
        makeParseResult('/project/src/ScoreGauge.tsx', ['./ScoreGauge']),
        makeParseResult('/project/src/ScoreGauge.ts', []),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);

      // Edge should go from .tsx to .ts, not create a self-loop
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].from).toBe('/project/src/ScoreGauge.tsx');
      expect(graph.edges[0].to).toBe('/project/src/ScoreGauge.ts');
    });

    it('still normalizes non-colliding files', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/ScoreGauge.ts': '',
        '/project/src/ScoreGauge.tsx': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/ScoreGauge.ts'),
        makeFileInfo('/project/src/ScoreGauge.tsx'),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      // a.ts has no collision, should be normalized
      expect(graph.nodes.has('/project/src/a')).toBe(true);
      // ScoreGauge files collide, should keep full paths
      expect(graph.nodes.has('/project/src/ScoreGauge.ts')).toBe(true);
      expect(graph.nodes.has('/project/src/ScoreGauge.tsx')).toBe(true);
    });
  });

  describe('adjacency list', () => {
    it('updates adjacency list for each edge', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/b.ts': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/b.ts'),
      ];
      const parseResults = [
        makeParseResult('/project/src/a.ts', ['./b']),
        makeParseResult('/project/src/b.ts', []),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);
      expect(
        graph.adjacencyList.get('/project/src/a')?.has('/project/src/b'),
      ).toBe(true);
    });
  });
});
