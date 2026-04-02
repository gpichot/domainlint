import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { FeatureBoundariesLinter } from './feature-boundaries-linter.js';

let testDir: string;

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

function createFileSystem(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    // Convert absolute virtual paths to relative
    const relativePath = path.replace('/project/', '');
    writeFile(relativePath, content);
  }
}

function createConfig(
  overrides: Partial<FeatureBoundariesConfig> = {},
): FeatureBoundariesConfig {
  return {
    rootDir: testDir,
    srcDir: join(testDir, 'src'),
    featuresDir: join(testDir, 'src/features'),
    barrelFiles: ['index.ts'],
    extensions: ['.ts', '.tsx', '.d.ts'],
    tsconfigPath: join(testDir, 'tsconfig.json'),
    exclude: ['**/node_modules/**', '**/dist/**'],
    includeDynamicImports: false,
    ...overrides,
  };
}

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `domainlint-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Integration Tests', () => {
  it('should detect simple import cycle', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/a.ts': `import { b } from './b';`,
      '/project/src/b.ts': `import { a } from './a';`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => v.code === 'noImportCycle')).toBe(
      true,
    );
  });

  it('should detect cross-feature deep imports', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export function login() {}`,
      '/project/src/features/auth/domain/user.ts': `export interface User {}`,
      '/project/src/features/billing/domain/invoice.ts': `import { User } from '../../auth/domain/user';`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const boundaryViolations = result.violations.filter(
      (v) => v.code === 'noCrossFeatureDeepImport',
    );
    expect(boundaryViolations.length).toBeGreaterThan(0);
    expect(boundaryViolations[0].message).toContain(
      'Cross-feature deep import not allowed',
    );
  });

  it('should allow same-feature imports', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export { LoginForm } from './ui/LoginForm';`,
      '/project/src/features/auth/ui/LoginForm.tsx': `import { validateCredentials } from '../domain/auth';`,
      '/project/src/features/auth/domain/auth.ts': `export function validateCredentials() {}`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const boundaryViolations = result.violations.filter(
      (v) => v.code === 'noCrossFeatureDeepImport',
    );
    expect(boundaryViolations).toHaveLength(0);
  });

  it('should allow cross-feature imports through barrel', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export function login() {}`,
      '/project/src/features/billing/index.ts': `export function createInvoice() {}`,
      '/project/src/features/billing/domain/invoice.ts': `import { login } from '../auth/index';`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const boundaryViolations = result.violations.filter(
      (v) => v.code === 'noCrossFeatureDeepImport',
    );
    expect(boundaryViolations).toHaveLength(0);
  });

  it('should detect feature imports from non-domain directories when rule is enabled', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/domain/user.ts': `import { helper } from '../../../lib/utils';`,
      '/project/src/lib/utils.ts': `export function helper() {}`,
    });

    const config = createConfig({
      overrides: {
        global: {
          rules: { 'no-external-feature-imports': 'error' },
        },
      },
    });
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'noFeatureImportFromNonDomain',
    );
    expect(nonDomainViolations.length).toBeGreaterThan(0);
    expect(nonDomainViolations[0].message).toContain(
      'Feature files cannot import from non-domain directories',
    );
  });

  it('should not report feature imports from non-domain directories by default', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/domain/user.ts': `import { helper } from '../../../lib/utils';`,
      '/project/src/lib/utils.ts': `export function helper() {}`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'noFeatureImportFromNonDomain',
    );
    expect(nonDomainViolations).toHaveLength(0);
  });

  it('should allow feature imports from within same feature', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/domain/user.ts': `export interface User {}`,
      '/project/src/features/auth/services/auth-service.ts': `import { User } from '../domain/user';`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'noFeatureImportFromNonDomain',
    );
    expect(nonDomainViolations).toHaveLength(0);
  });

  it('should allow feature imports from other feature barrels', async () => {
    createFileSystem({
      '/project/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.' },
      }),
      '/project/src/features/auth/index.ts': `export function login() {}`,
      '/project/src/features/billing/domain/invoice.ts': `import { login } from '../auth';`,
    });

    const config = createConfig();
    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    const nonDomainViolations = result.violations.filter(
      (v) => v.code === 'noFeatureImportFromNonDomain',
    );
    expect(nonDomainViolations).toHaveLength(0);
  });

  describe('Cycles with 3+ files', () => {
    it('should detect a cycle spanning three files', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': `import { c } from './c';`,
        '/project/src/c.ts': `import { a } from './a';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(result.violations.some((v) => v.code === 'noImportCycle')).toBe(
        true,
      );
    });

    it('should detect a cycle spanning four files', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': `import { c } from './c';`,
        '/project/src/c.ts': `import { d } from './d';`,
        '/project/src/d.ts': `import { a } from './a';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(result.violations.some((v) => v.code === 'noImportCycle')).toBe(
        true,
      );
    });
  });

  describe('includeDynamicImports flag', () => {
    it('should ignore dynamic imports when includeDynamicImports is false', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `const b = import('./b');`,
        '/project/src/b.ts': `const a = import('./a');`,
      });

      const config = createConfig({ includeDynamicImports: false });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const cycleViolations = result.violations.filter(
        (v) => v.code === 'noImportCycle',
      );
      expect(cycleViolations).toHaveLength(0);
    });

    it('should detect cycles from dynamic imports when includeDynamicImports is true', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `const b = import('./b');`,
        '/project/src/b.ts': `const a = import('./a');`,
      });

      const config = createConfig({ includeDynamicImports: true });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(result.violations.some((v) => v.code === 'noImportCycle')).toBe(
        true,
      );
    });

    it('should detect cross-feature deep import via dynamic import when includeDynamicImports is true', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/domain/user.ts': `export interface User {}`,
        '/project/src/features/billing/domain/invoice.ts': `const user = import('../../auth/domain/user');`,
      });

      const config = createConfig({ includeDynamicImports: true });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });
  });

  describe('Type-only imports', () => {
    it('should report type-only cross-feature deep imports as violations', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export type { User } from './domain/user';`,
        '/project/src/features/auth/domain/user.ts': `export interface User {}`,
        '/project/src/features/billing/domain/invoice.ts': `import type { User } from '../../auth/domain/user';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });

    it('should allow type-only imports through the barrel file', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export type { User } from './domain/user';`,
        '/project/src/features/auth/domain/user.ts': `export interface User {}`,
        '/project/src/features/billing/domain/invoice.ts': `import type { User } from '../../auth/index';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'noCrossFeatureDeepImport',
      );
      expect(boundaryViolations).toHaveLength(0);
    });
  });

  describe('Multiple barrel file types', () => {
    it('should treat index.tsx as a barrel when configured', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.tsx': `export function AuthButton() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { AuthButton } from '../../auth/index.tsx';`,
      });

      const config = createConfig({
        barrelFiles: ['index.ts', 'index.tsx'],
      });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'noCrossFeatureDeepImport',
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should report a violation when importing a non-barrel tsx file from another feature', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/ui/LoginButton.tsx': `export function LoginButton() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { LoginButton } from '../../auth/ui/LoginButton.tsx';`,
      });

      const config = createConfig({
        barrelFiles: ['index.ts', 'index.tsx'],
      });
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });
  });

  describe('tsconfig path mapping', () => {
    it('should detect cross-feature deep import through path alias', async () => {
      createFileSystem({
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

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });

    it('should allow cross-feature barrel import through path alias', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@features/*': ['src/features/*'] },
          },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/billing/domain/invoice.ts': `import { login } from '@features/auth';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'noCrossFeatureDeepImport',
      );
      expect(boundaryViolations).toHaveLength(0);
    });
  });

  describe('tsconfig extends chain', () => {
    it('should resolve baseUrl from an extended base config', async () => {
      createFileSystem({
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

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });

    it('should resolve path aliases defined in the base config', async () => {
      createFileSystem({
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

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });
  });

  describe('Project with no features directory', () => {
    it('should run without cross-feature violations when no feature files exist', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/utils.ts': `export function helper() {}`,
        '/project/src/app.ts': `import { helper } from './utils';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'noCrossFeatureDeepImport',
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should not crash when featuresDir contains no files', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/lib/helper.ts': `export function helper() {}`,
      });

      const config = createConfig();
      await expect(
        new FeatureBoundariesLinter(config).lint(),
      ).resolves.toBeDefined();
    });
  });

  describe('Deeply nested features', () => {
    it('should detect cross-feature deep import from a deeply nested file', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/index.ts': `export function login() {}`,
        '/project/src/features/auth/domain/services/auth-service.ts': `export function authService() {}`,
        '/project/src/features/billing/domain/services/billing-service.ts': `import { authService } from '../../../auth/domain/services/auth-service';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      expect(
        result.violations.some((v) => v.code === 'noCrossFeatureDeepImport'),
      ).toBe(true);
    });

    it('should allow same-feature imports across deeply nested directories', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/domain/models/user.ts': `export interface User {}`,
        '/project/src/features/auth/domain/services/auth-service.ts': `import { User } from '../models/user';`,
        '/project/src/features/auth/ui/components/LoginForm.ts': `import { User } from '../../domain/models/user';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter(
        (v) => v.code === 'noCrossFeatureDeepImport',
      );
      expect(boundaryViolations).toHaveLength(0);
    });
  });

  describe('Non-violation paths (false positive prevention)', () => {
    it('should not report violations for external package imports in feature files', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/features/auth/service.ts': `import React from 'react'; export function AuthButton() {}`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter((v) =>
        ['noImportCycle', 'noCrossFeatureDeepImport'].includes(v.code),
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should not report violations for non-feature files importing each other', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/lib/utils.ts': `export function helper() {}`,
        '/project/src/services/app-service.ts': `import { helper } from '../lib/utils';`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const boundaryViolations = result.violations.filter((v) =>
        ['noImportCycle', 'noCrossFeatureDeepImport'].includes(v.code),
      );
      expect(boundaryViolations).toHaveLength(0);
    });

    it('should not report a cycle for a non-cyclic directed path', async () => {
      createFileSystem({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.' },
        }),
        '/project/src/a.ts': `import { b } from './b';`,
        '/project/src/b.ts': `import { c } from './c';`,
        '/project/src/c.ts': `export const c = 1;`,
      });

      const config = createConfig();
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      const cycleViolations = result.violations.filter(
        (v) => v.code === 'noImportCycle',
      );
      expect(cycleViolations).toHaveLength(0);
    });
  });
});
