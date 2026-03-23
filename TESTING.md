# Testing

## Stack

- **vitest** — test runner
- **memfs** — virtual filesystem (no real I/O in tests)

## Conventions

### Colocation

Test files live next to the source file they cover:

```
src/linter/feature-boundaries-linter.ts
src/linter/feature-boundaries-linter.test.ts   ← colocated
```

Exception: `src/test-utils/setup.ts` contains shared helpers usable across all tests.

### Behavioral over unit

Prefer tests that exercise behavior through the public API, not internal implementation details.

**Prefer:**
```ts
// Drive through FeatureBoundariesLinter, assert on violations
const result = await linter.lint();
expect(result.violations).toContainEqual(
  expect.objectContaining({ code: 'noImportCycle' }),
);
```

**Avoid:**
```ts
// Testing internal graph structure or private methods
expect(graph._nodes.size).toBe(3);
```

This keeps tests resilient to refactoring and focuses on what matters: correct violation reporting.

### Filesystem mocking with memfs

Mock `node:fs/promises` and `glob` at the top of any test that needs a filesystem:

```ts
import { vol } from 'memfs';
import { beforeEach, vi } from 'vitest';

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

vi.mock('glob', () => ({
  glob: async (pattern, options = {}) => {
    const cwd = options.cwd || process.cwd();
    return Object.keys(vol.toJSON())
      .filter((f) => f.startsWith(cwd))
      .filter((f) => (pattern.includes('**/*.ts') ? f.endsWith('.ts') : true));
  },
}));

beforeEach(() => vol.reset());
```

Then populate the virtual FS with `vol.fromJSON()`:

```ts
vol.fromJSON({
  '/project/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
  '/project/src/features/auth/index.ts': `export * from './service';`,
  '/project/src/features/auth/service.ts': `export const login = () => {};`,
  '/project/src/features/billing/index.ts': `import { login } from '../auth/service';`, // violation
});
```

### Shared helpers

`src/test-utils/setup.ts` exports:

- `createMockFileSystem(files)` — resets and populates `vol`
- `createDefaultConfig(overrides?)` — returns a `FeatureBoundariesConfig` rooted at `/project`

Use these instead of duplicating config boilerplate.

## Running tests

```bash
pnpm test:run    # run once
pnpm test        # watch mode
```
