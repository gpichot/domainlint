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

  describe('duplicate .ts/.tsx files', () => {
    it('keeps both files as separate nodes when a.ts and a.tsx both exist', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/a.tsx': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/a.tsx'),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has('/project/src/a.ts')).toBe(true);
      expect(graph.nodes.has('/project/src/a.tsx')).toBe(true);
    });

    it('resolves edges correctly when .ts and .tsx coexist', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/a.tsx': '',
        '/project/src/b.ts': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/a.tsx'),
        makeFileInfo('/project/src/b.ts'),
      ];
      // b.ts imports ./a which resolves to a.ts (first extension match)
      const parseResults = [
        makeParseResult('/project/src/b.ts', ['./a']),
        makeParseResult('/project/src/a.ts', []),
        makeParseResult('/project/src/a.tsx', []),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, parseResults);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].from).toBe('/project/src/b');
      expect(graph.edges[0].to).toBe('/project/src/a.ts');
    });

    it('does not collapse non-colliding files', async () => {
      vol.fromJSON({
        '/project/src/a.ts': '',
        '/project/src/b.tsx': '',
      });
      const files = [
        makeFileInfo('/project/src/a.ts'),
        makeFileInfo('/project/src/b.tsx'),
      ];
      const builder = new DependencyGraphBuilder(config, tsconfig, testFs);
      const graph = await builder.buildGraph(files, []);
      // Non-colliding files should still be normalized
      expect(graph.nodes.has('/project/src/a')).toBe(true);
      expect(graph.nodes.has('/project/src/b')).toBe(true);
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
