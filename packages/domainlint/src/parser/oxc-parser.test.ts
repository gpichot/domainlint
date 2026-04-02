import { vol } from 'memfs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { createTestFs } from '../test-utils/setup.js';
import { parseFile } from './oxc-parser.js';

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

const configWithDynamicImports: FeatureBoundariesConfig = {
  ...config,
  includeDynamicImports: true,
};

describe('parseFile', () => {
  describe('static imports', () => {
    it('extracts a simple static import', async () => {
      vol.fromJSON({ '/project/src/a.ts': `import { foo } from './foo';` });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifier).toBe('./foo');
      expect(result.imports[0].isDynamic).toBe(false);
      expect(result.imports[0].isTypeOnly).toBe(false);
    });

    it('extracts multiple imports', async () => {
      vol.fromJSON({
        '/project/src/a.ts': [
          `import { foo } from './foo';`,
          `import { bar } from './bar';`,
          `import { baz } from 'baz';`,
        ].join('\n'),
      });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports).toHaveLength(3);
      expect(result.imports.map((i) => i.specifier)).toEqual([
        './foo',
        './bar',
        'baz',
      ]);
    });

    it('extracts type-only imports', async () => {
      vol.fromJSON({
        '/project/src/a.ts': `import type { Foo } from './foo';`,
      });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifier).toBe('./foo');
      expect(result.imports[0].isTypeOnly).toBe(true);
    });

    it('returns empty imports for a file with no imports', async () => {
      vol.fromJSON({ '/project/src/a.ts': `export const x = 1;` });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports).toHaveLength(0);
    });
  });

  describe('re-exports', () => {
    it('extracts export * from re-exports', async () => {
      vol.fromJSON({ '/project/src/index.ts': `export * from './service';` });
      const result = await parseFile('/project/src/index.ts', config, testFs);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifier).toBe('./service');
    });

    it('extracts named re-exports', async () => {
      vol.fromJSON({
        '/project/src/index.ts': `export { foo, bar } from './utils';`,
      });
      const result = await parseFile('/project/src/index.ts', config, testFs);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifier).toBe('./utils');
    });

    it('extracts type-only re-exports', async () => {
      vol.fromJSON({
        '/project/src/index.ts': `export type { Foo } from './types';`,
      });
      const result = await parseFile('/project/src/index.ts', config, testFs);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].isTypeOnly).toBe(true);
    });
  });

  describe('dynamic imports', () => {
    it('ignores dynamic imports when includeDynamicImports is false', async () => {
      vol.fromJSON({ '/project/src/a.ts': `const m = import('./module');` });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports).toHaveLength(0);
    });

    it('extracts dynamic imports when includeDynamicImports is true', async () => {
      vol.fromJSON({ '/project/src/a.ts': `const m = import('./module');` });
      const result = await parseFile(
        '/project/src/a.ts',
        configWithDynamicImports,
        testFs,
      );
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifier).toBe('./module');
      expect(result.imports[0].isDynamic).toBe(true);
    });
  });

  describe('TSX files', () => {
    it('parses a .tsx file with JSX syntax', async () => {
      vol.fromJSON({
        '/project/src/Component.tsx': [
          `import React from 'react';`,
          `import { helper } from './helper';`,
          `export const Component = () => <div />;`,
        ].join('\n'),
      });
      const result = await parseFile(
        '/project/src/Component.tsx',
        config,
        testFs,
      );
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].specifier).toBe('react');
      expect(result.imports[1].specifier).toBe('./helper');
    });
  });

  describe('error handling', () => {
    it('throws an error when the file has a syntax error', async () => {
      vol.fromJSON({
        '/project/src/broken.ts': `this is not valid typescript @@@@`,
      });
      await expect(
        parseFile('/project/src/broken.ts', config, testFs),
      ).rejects.toThrow(/Failed to parse/);
    });
  });

  describe('line and column positions', () => {
    it('reports correct line and column for a single import', async () => {
      vol.fromJSON({ '/project/src/a.ts': `import { foo } from './foo';` });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports[0].line).toBe(1);
      expect(result.imports[0].col).toBe(1);
    });

    it('reports correct line for imports on different lines', async () => {
      vol.fromJSON({
        '/project/src/a.ts': [
          `import { foo } from './foo';`,
          `import { bar } from './bar';`,
          ``,
          `import { baz } from './baz';`,
        ].join('\n'),
      });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports[0].line).toBe(1);
      expect(result.imports[1].line).toBe(2);
      expect(result.imports[2].line).toBe(4);
    });

    it('reports correct column for indented imports', async () => {
      vol.fromJSON({
        '/project/src/a.ts': `  import { foo } from './foo';`,
      });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.imports[0].line).toBe(1);
      expect(result.imports[0].col).toBe(3);
    });

    it('reports correct positions for re-exports', async () => {
      vol.fromJSON({
        '/project/src/index.ts': [
          `export * from './a';`,
          `export { foo } from './b';`,
        ].join('\n'),
      });
      const result = await parseFile('/project/src/index.ts', config, testFs);
      expect(result.imports[0].line).toBe(1);
      expect(result.imports[1].line).toBe(2);
    });

    it('reports correct positions for dynamic imports', async () => {
      vol.fromJSON({
        '/project/src/a.ts': [
          `const x = 1;`,
          `const m = import('./module');`,
        ].join('\n'),
      });
      const result = await parseFile(
        '/project/src/a.ts',
        configWithDynamicImports,
        testFs,
      );
      expect(result.imports[0].line).toBe(2);
    });
  });

  describe('result structure', () => {
    it('returns the correct filePath in the result', async () => {
      vol.fromJSON({ '/project/src/a.ts': `export const x = 1;` });
      const result = await parseFile('/project/src/a.ts', config, testFs);
      expect(result.filePath).toBe('/project/src/a.ts');
    });
  });
});
