import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureBoundariesLinter } from '../linter/feature-boundaries-linter.js';
import { createDefaultConfig } from './setup.js';

// Mock fs module completely
vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

// Mock glob to work with memfs
vi.mock('glob', () => ({
  glob: async (pattern: string, options: Record<string, unknown> = {}) => {
    const cwd = (options.cwd as string) || process.cwd();
    const memfsFiles = Object.keys(vol.toJSON());

    // Filter files that are in the cwd and match the pattern
    const filteredFiles = memfsFiles
      .filter((file) => file.startsWith(cwd))
      .filter((file) => {
        if (pattern.includes('**/*.ts')) return file.endsWith('.ts');
        if (pattern.includes('**/*.tsx')) return file.endsWith('.tsx');
        return true;
      });

    return options.absolute
      ? filteredFiles
      : filteredFiles.map((f) => f.replace(`${cwd}/`, ''));
  },
}));

function createMockFileSystem(files: Record<string, string>) {
  vol.reset();
  vol.fromJSON(files);
}

describe('Integration Tests', () => {
  beforeEach(() => {
    vol.reset();
  });

  it('should detect simple import cycle', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/a.ts': `import { b } from './b';`,
      '/project/src/b.ts': `import { a } from './a';`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => v.code === 'ARCH_IMPORT_CYCLE')).toBe(
      true,
    );
  });

  it('should detect cross-feature deep imports', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export function login() {}`,
      '/project/src/features/auth/domain/user.ts': `export interface User {}`,
      '/project/src/features/billing/domain/invoice.ts': `import { User } from '../../auth/domain/user';`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const boundaryViolations = result.violations.filter(
      (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
    );
    expect(boundaryViolations.length).toBeGreaterThan(0);
    expect(boundaryViolations[0].message).toContain(
      'Cross-feature deep import not allowed',
    );
  });

  it('should allow same-feature imports', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export { LoginForm } from './ui/LoginForm';`,
      '/project/src/features/auth/ui/LoginForm.tsx': `import { validateCredentials } from '../domain/auth';`,
      '/project/src/features/auth/domain/auth.ts': `export function validateCredentials() {}`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const boundaryViolations = result.violations.filter(
      (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
    );
    expect(boundaryViolations).toHaveLength(0);
  });

  it('should allow cross-feature imports through barrel', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export function login() {}`,
      '/project/src/features/billing/index.ts': `export function createInvoice() {}`,
      '/project/src/features/billing/domain/invoice.ts': `import { login } from '../auth/index';`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const boundaryViolations = result.violations.filter(
      (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
    );
    expect(boundaryViolations).toHaveLength(0);
  });

  it('should detect feature imports from non-domain directories', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/domain/user.ts': `import { helper } from '../../../lib/utils';`,
      '/project/src/lib/utils.ts': `export function helper() {}`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
    );
    expect(nonDomainViolations.length).toBeGreaterThan(0);
    expect(nonDomainViolations[0].message).toContain(
      'Feature files cannot import from non-domain directories',
    );
  });

  it('should allow feature imports from within same feature', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/domain/user.ts': `export interface User {}`,
      '/project/src/features/auth/services/auth-service.ts': `import { User } from '../domain/user';`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
    );
    expect(nonDomainViolations).toHaveLength(0);
  });

  it('should allow feature imports from other feature barrels', async () => {
    createMockFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export function login() {}`,
      '/project/src/features/billing/domain/invoice.ts': `import { login } from '../auth';`,
    });

    const config = createDefaultConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
    );
    expect(nonDomainViolations).toHaveLength(0);
  });
});
