import { vol } from 'memfs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { createTestGlob } from '../test-utils/setup.js';
import { discoverFiles, getBarrelPath, getFeature } from './file-discovery.js';

beforeEach(() => vol.reset());

const testGlob = createTestGlob();

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

describe('discoverFiles', () => {
  it('discovers all .ts files in srcDir', async () => {
    vol.fromJSON({
      '/project/src/a.ts': '',
      '/project/src/b.ts': '',
    });
    const files = await discoverFiles(config, testGlob);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('/project/src/a.ts');
    expect(paths).toContain('/project/src/b.ts');
  });

  it('discovers .tsx files as well', async () => {
    vol.fromJSON({ '/project/src/Component.tsx': '' });
    const files = await discoverFiles(config, testGlob);
    expect(files.map((f) => f.path)).toContain('/project/src/Component.tsx');
  });

  it('excludes files matching exclude patterns', async () => {
    vol.fromJSON({
      '/project/src/a.ts': '',
      '/project/src/node_modules/pkg/index.ts': '',
    });
    const files = await discoverFiles(
      { ...config, exclude: ['**/node_modules/**'] },
      testGlob,
    );
    const paths = files.map((f) => f.path);
    expect(paths).toContain('/project/src/a.ts');
    expect(paths).not.toContain('/project/src/node_modules/pkg/index.ts');
  });

  it('sets feature to null for files outside featuresDir', async () => {
    vol.fromJSON({ '/project/src/shared/utils.ts': '' });
    const files = await discoverFiles(config, testGlob);
    const utils = files.find((f) => f.path.endsWith('utils.ts'));
    expect(utils?.feature).toBeNull();
  });

  it('sets feature name for files inside featuresDir', async () => {
    vol.fromJSON({ '/project/src/features/auth/service.ts': '' });
    const files = await discoverFiles(config, testGlob);
    const service = files.find((f) => f.path.endsWith('service.ts'));
    expect(service?.feature).toBe('auth');
  });

  it('marks barrel files correctly', async () => {
    vol.fromJSON({
      '/project/src/features/auth/index.ts': '',
      '/project/src/features/auth/service.ts': '',
    });
    const files = await discoverFiles(config, testGlob);
    const barrel = files.find((f) => f.path.endsWith('auth/index.ts'));
    const service = files.find((f) => f.path.endsWith('service.ts'));
    expect(barrel?.isBarrel).toBe(true);
    expect(service?.isBarrel).toBe(false);
  });

  it('returns relativePath relative to rootDir', async () => {
    vol.fromJSON({ '/project/src/a.ts': '' });
    const files = await discoverFiles(config, testGlob);
    const file = files.find((f) => f.path.endsWith('a.ts'));
    expect(file?.relativePath).toBe('src/a.ts');
  });

  it('deduplicates files found by multiple extension patterns', async () => {
    vol.fromJSON({ '/project/src/a.ts': '' });
    const files = await discoverFiles(config, testGlob);
    const count = files.filter((f) => f.path.endsWith('a.ts')).length;
    expect(count).toBe(1);
  });
});

describe('getFeature', () => {
  it('returns null for a file outside featuresDir', () => {
    expect(getFeature('/project/src/shared/utils.ts', config)).toBeNull();
  });

  it('returns the feature name for a file inside featuresDir', () => {
    expect(getFeature('/project/src/features/auth/service.ts', config)).toBe(
      'auth',
    );
  });

  it('returns the feature name for a deeply nested file', () => {
    expect(
      getFeature('/project/src/features/billing/components/invoice.ts', config),
    ).toBe('billing');
  });

  it('returns the feature name for a barrel file', () => {
    expect(getFeature('/project/src/features/auth/index.ts', config)).toBe(
      'auth',
    );
  });
});

describe('getBarrelPath', () => {
  it('returns the path to the first barrel file for a given feature', () => {
    const barrelPath = getBarrelPath('auth', config);
    expect(barrelPath).toBe('/project/src/features/auth/index.ts');
  });

  it('uses the first barrel file when multiple are configured', () => {
    const multiBarrelConfig = {
      ...config,
      barrelFiles: ['index.ts', 'index.tsx'],
    };
    const barrelPath = getBarrelPath('billing', multiBarrelConfig);
    expect(barrelPath).toBe('/project/src/features/billing/index.ts');
  });
});
