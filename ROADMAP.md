# Roadmap

Items ordered by priority. Each section is designed to be handled independently by a dedicated agent.

---

## 1. Tests — Core logic coverage

**Status:** critical gap
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

## 2. Tests — Integration scenarios

**Status:** partially covered (7 scenarios)
**Scope:** extend `src/linter/integration.test.ts`

Missing scenarios:
- Cycles with 3+ files
- `includeDynamicImports` flag
- Type-only imports
- Multiple barrel file types (`index.tsx`, `index.js`)
- tsconfig path mapping (`paths` + `baseUrl`)
- `tsconfig extends` chain
- Project with no features directory
- Deeply nested features
- Non-violation paths that could produce false positives

---

## 3. Tests — Coverage reporting in CI

**Status:** script exists (`pnpm test:coverage`), not wired into CI
**Scope:** `.github/workflows/test.yml`

- Add coverage step to CI (Vitest v8 coverage)
- Set a minimum threshold (e.g. 70% lines)
- Optionally upload to Codecov or similar

---

## 4. Release — release-please

**Status:** currently manual version bumps + ad-hoc GitHub Actions
**Scope:** replace `onPushToMain.yml` release logic

- Add `release-please` GitHub Action on push to `main`
- Use `node` release type (updates `package.json` version)
- Auto-generates `CHANGELOG.md` from Conventional Commits
- Creates GitHub release on merge of release PR
- Wire existing `onRelease.yml` (npm publish) to the release event

Conventional commit format to enforce: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.

---

## 5. Custom rules support

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

## 6. Documentation

**Status:** README + SPEC exist, gaps elsewhere
**Scope:** several independent doc files

- `CONTRIBUTING.md` — setup, branch conventions, commit format, PR process
- `README.md` improvements — add badge for CI, npm version, a usage GIF or screenshot
- Inline JSDoc on public APIs: `FeatureBoundariesLinter`, `ModuleResolver`, `CycleDetector`, `FeatureBoundaryValidator`
- Document known limitations (no `extends` deep chain, Windows paths, symlinks)

---

## 7. Config validation

**Status:** no validation on config values
**Scope:** `src/config/config-loader.ts`

- Validate that `srcDir` and `featuresDir` exist
- Validate `barrelFiles` entries are non-empty strings
- Validate `extensions` start with `.`
- Return clear errors (exit code 2) with actionable messages instead of silent wrong behavior

---

## 8. tsconfig `extends` chain

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
