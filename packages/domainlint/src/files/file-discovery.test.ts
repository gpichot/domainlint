import { describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { getBarrelPath, getFeature } from './file-discovery.js';

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

describe('getFeature edge cases', () => {
  it('handles dot segments, sibling dirs and the features dir itself', () => {
    expect(
      getFeature('/project/src/features/auth/../billing/x.ts', config),
    ).toBe('billing');
    expect(
      getFeature('/project/src/features/../shared/x.ts', config),
    ).toBeNull();
    expect(getFeature('/project/src/features-extra/a/x.ts', config)).toBeNull();
    expect(getFeature('/project/src/features', config)).toBeNull();
    expect(getFeature('/project/src/features/.hidden/x.ts', config)).toBe(
      '.hidden',
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
