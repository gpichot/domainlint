import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../test-utils/setup.js';
import { FeatureBoundariesLinter } from './feature-boundaries-linter.js';

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
    // Check .tsx before .ts to avoid substring match issues (**.tsx contains **.ts)
    const filteredFiles = memfsFiles
      .filter((file) => file.startsWith(cwd))
      .filter((file) => {
        if (pattern.includes('**/*.tsx')) return file.endsWith('.tsx');
        if (pattern.includes('**/*.ts')) return file.endsWith('.ts');
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

  describe('Cycles with 3+ files', () => {
    it('should detect a cycle spanning three files', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': `import { c } from './c';`,
        '/project/src/c.ts': `import { a } from './a';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'ARCH_IMPORT_CYCLE'),
      ).toBe(true);
    });

    it('should detect a cycle spanning four files', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': `import { c } from './c';`,
        '/project/src/c.ts': `import { d } from './d';`,
        '/project/src/d.ts': `import { a } from './a';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'ARCH_IMPORT_CYCLE'),
      ).toBe(true);
    });
  });

  describe('includeDynamicImports flag', () => {
    it('should ignore dynamic imports when includeDynamicImports is false', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `const b = import('./b');`,
        '/project/src/b.ts': `const a = import('./a');`,
      });

      const config = createDefaultConfig({ includeDynamicImports: false });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const cycleViolations = result.violations.filter(
        (v) => v.code === 'ARCH_IMPORT_CYCLE',
      );
      expect(cycleViolations).toHaveLength(0);
    });

    it('should detect cycles from dynamic imports when includeDynamicImports is true', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `const b = import('./b');`,
        '/project/src/b.ts': `const a = import('./a');`,
      });

      const config = createDefaultConfig({ includeDynamicImports: true });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'ARCH_IMPORT_CYCLE'),
      ).toBe(true);
    });

    it('should detect cross-feature deep import via dynamic import when includeDynamicImports is true', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/domain/user.ts': `export interface User {}`,
        '/project/src/features/billing/domain/invoice.ts': `const user = import('../../auth/domain/user');`,
      });

      const config = createDefaultConfig({ includeDynamicImports: true });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });
  });

  describe('Type-only imports', () => {
    it('should report type-only cross-feature deep imports as violations', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export type { User } from './domain/user';`,
        '/project/src/features/auth/domain/user.ts': `export interface User {}`,
        '/project/src/features/billing/domain/invoice.ts': `import type { User } from '../../auth/domain/user';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });

    it('should allow type-only imports through the barrel file', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export type { User } from './domain/user';`,
        '/project/src/features/auth/domain/user.ts': `export interface User {}`,
        '/project/src/features/billing/domain/invoice.ts': `import type { User } from '../../auth/index';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
      );
      expect(boundaryViolations).toHaveLength(0);
    });
  });

  describe('Multiple barrel file types', () => {
    it('should treat index.tsx as a barrel when configured', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.tsx': `export function AuthButton() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { AuthButton } from '../../auth/index.tsx';`,
      });

      const config = createDefaultConfig({
        barrelFiles: ['index.ts', 'index.tsx'],
      });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should report a violation when importing a non-barrel tsx file from another feature', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/ui/LoginButton.tsx': `export function LoginButton() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { LoginButton } from '../../auth/ui/LoginButton.tsx';`,
      });

      const config = createDefaultConfig({
        barrelFiles: ['index.ts', 'index.tsx'],
      });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });
  });

  describe('tsconfig path mapping', () => {
    it('should detect cross-feature deep import through path alias', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@features/*': ['src/features/*'] },
          },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/service.ts': `export function authService() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { authService } from '@features/auth/service';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });

    it('should allow cross-feature barrel import through path alias', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@features/*': ['src/features/*'] },
          },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { login } from '@features/auth';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
      );
      expect(boundaryViolations).toHaveLength(0);
    });
  });

  describe('tsconfig extends chain', () => {
    it('should resolve baseUrl from an extended base config', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          extends: './tsconfig.base.json',
          compilerOptions: {},
        }),
        '/project/tsconfig.base.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/service.ts': `export function authService() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { authService } from '../../auth/service';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });

    it('should resolve path aliases defined in the base config', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          extends: './tsconfig.base.json',
          compilerOptions: {},
        }),
        '/project/tsconfig.base.json': JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@auth/*': ['src/features/auth/*'] },
          },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/service.ts': `export function authService() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { authService } from '@auth/service';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });
  });

  describe('Project with no features directory', () => {
    it('should run without cross-feature violations when no feature files exist', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/utils.ts': `export function helper() {}`,
        '/project/src/app.ts': `import { helper } from './utils';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should not crash when featuresDir contains no files', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/lib/helper.ts': `export function helper() {}`,
      });

      const config = createDefaultConfig();
      await expect(
        new FeatureBoundariesLinter(config).lint(),
      ).resolves.toBeDefined();
    });
  });

  describe('Deeply nested features', () => {
    it('should detect cross-feature deep import from a deeply nested file', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/domain/services/auth-service.ts': `export function authService() {}`,
        '/project/src/features/billing/domain/services/billing-service.ts': `import { authService } from '../../../auth/domain/services/auth-service';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some(
          (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        ),
      ).toBe(true);
    });

    it('should allow same-feature imports across deeply nested directories', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/domain/models/user.ts': `export interface User {}`,
        '/project/src/features/auth/domain/services/auth-service.ts': `import { User } from '../models/user';`,
        '/project/src/features/auth/ui/components/LoginForm.ts': `import { User } from '../../domain/models/user';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
      );
      expect(boundaryViolations).toHaveLength(0);
    });
  });

  describe('Non-violation paths (false positive prevention)', () => {
    it('should not report violations for external package imports in feature files', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/service.ts': `import React from 'react'; export function AuthButton() {}`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter((v) =>
        ['ARCH_IMPORT_CYCLE', 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT'].includes(
          v.code,
        ),
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should not report violations for non-feature files importing each other', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/lib/utils.ts': `export function helper() {}`,
        '/project/src/services/app-service.ts': `import { helper } from '../lib/utils';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter((v) =>
        ['ARCH_IMPORT_CYCLE', 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT'].includes(
          v.code,
        ),
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should not produce false cycles when both a.ts and a.tsx exist', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `export const a = 1;`,
        '/project/src/a.tsx': `import { a } from './a';
export function AComponent() { return a; }`,
        '/project/src/b.ts': `import { a } from './a';`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const cycleViolations = result.violations.filter(
        (v) => v.code === 'ARCH_IMPORT_CYCLE',
      );
      expect(cycleViolations).toHaveLength(0);
    });

    it('should not report a cycle for a non-cyclic directed path', async () => {
      createMockFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': `import { c } from './c';`,
        '/project/src/c.ts': `export const c = 1;`,
      });

      const config = createDefaultConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const cycleViolations = result.violations.filter(
        (v) => v.code === 'ARCH_IMPORT_CYCLE',
      );
      expect(cycleViolations).toHaveLength(0);
    });
  });
});
