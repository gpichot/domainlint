# Roadmap

Items ordered by priority. Each section is designed to be handled independently by a dedicated agent.

---

## 1. Monorepo migration

**Status:** done
**Scope:** repo restructuring, prerequisite for the docs package

Migrated to a pnpm monorepo. CLI lives at `packages/domainlint/`, workspace root is private.

```
packages/
  domainlint/       # CLI
```

---

## 2. Tests — Core logic coverage

**Status:** done
**Scope:** unit tests for the modules that have none today

The core business logic is currently only exercised indirectly through integration tests.
Add direct tests for:

- `rules/cycle-detector.ts` — self-loops, 3-node cycles, deduplication
- `rules/feature-boundary-validator.ts` — edge cases in feature ownership detection, multiple barrel types
- `resolution/module-resolver.ts` — relative paths, tsconfig path mapping, extension resolution, caching, external package detection
- `parser/swc-parser.ts` — re-exports, type-only imports, dynamic imports, syntax errors
- `files/file-discovery.ts` — glob patterns, exclusion, barrel detection
- `graph/dependency-graph.ts` — graph construction, path normalization

Follow conventions from `TESTING.md` (memfs, behavioral style, colocated files).

---

## 3. Tests — Integration scenarios

**Status:** done
**Scope:** extend `src/linter/integration.test.ts`

All scenarios covered (16 total):
- Cycles with 3+ files (3-node and 4-node cycles)
- `includeDynamicImports` flag (false: ignored, true: cycle + cross-feature detected)
- Type-only imports (violations still reported; barrel imports allowed)
- Multiple barrel file types (`index.tsx` recognised as barrel when configured)
- tsconfig path mapping (`paths` + `baseUrl`: violation via alias, barrel via alias)
- `tsconfig extends` chain (baseUrl and path aliases inherited from base config)
- Project with no features directory (no crash, no false positives)
- Deeply nested features (cross-feature detected; same-feature allowed)
- Non-violation paths (external packages, non-feature files, acyclic graphs)

---

## 4. Tests — Coverage reporting in CI

**Status:** done
**Scope:** `.github/workflows/ci.yml`

- Added `coverage` job to CI (Vitest v8 coverage, lcov reporter)
- Set 70% minimum threshold for lines, functions, branches, and statements
- lcov reporter output available for future Codecov integration

---

## 5. Release — release-please

**Status:** done
**Scope:** replace manual release flow with release-please

Replaced `test.yml`, `onPushToMain.yml`, and `onRelease.yml` with a single `ci.yml` workflow:
- `test` job runs on all pushes/PRs (matrix: OS + Node versions)
- `release-please` job runs on push to `main`, creates/updates a Release PR
- `publish` job runs when release-please creates a GitHub release → publishes to npm

Config: `release-please-config.json` + `.release-please-manifest.json` at repo root, targeting `packages/domainlint`.

Conventional commit format: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.

---

## 6. Custom rules support

**Status:** not implemented
**Scope:** new feature, non-trivial

Allow users to define additional import restriction rules in `domainlint.json`:

```json
{
  "rules": [
    {
      "from": "src/features/**",
      "deny": ["src/lib/**", "src/utils/**"],
      "message": "Features must not import from shared lib directly"
    }
  ]
}
```

Design notes:
- Rules are path-glob pairs (`from` + `deny`)
- Evaluated after resolution, same as R2
- New violation code: `ARCH_CUSTOM_RULE`
- Documented in `SPEC.md` as R4+

---

## 7. Documentation

**Status:** done
**Scope:** several independent doc files

- `CONTRIBUTING.md` — setup, branch conventions, commit format, PR process
- `README.md` improvements — add badge for CI, npm version, a usage GIF or screenshot
- Inline JSDoc on public APIs: `FeatureBoundariesLinter`, `ModuleResolver`, `CycleDetector`, `FeatureBoundaryValidator`
- Document known limitations (no `extends` deep chain, Windows paths, symlinks)

---

## 8. Config validation

**Status:** done
**Scope:** `src/config/config-loader.ts`

- Validate that `srcDir` and `featuresDir` exist
- Validate `barrelFiles` entries are non-empty strings
- Validate `extensions` start with `.`
- Return clear errors (exit code 2) with actionable messages instead of silent wrong behavior

---

## 9. tsconfig `extends` chain

**Status:** partial, relies on `tsc --showConfig` with fallback
**Scope:** `src/tsconfig/tsconfig-loader.ts`

- Ensure `extends` resolution is reliable without requiring `tsc` installed
- Implement pure-TS `extends` resolution as fallback
- Add tests for 2-level inheritance and monorepo-style tsconfig

---

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
