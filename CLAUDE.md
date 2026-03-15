# domainlint

Architecture linter for TypeScript/JavaScript codebases. Enforces feature boundary rules and detects import cycles.

## What it does

Two core rules:
- **R1** – No import cycles across the module graph
- **R2** – Cross-feature imports must go through barrel files only (`src/features/<name>/index.ts`)

## Tech stack

- **Runtime**: Node.js ≥18, TypeScript, ESM
- **CLI**: oclif
- **Parser**: SWC (fast TS/JS AST parsing)
- **Tests**: vitest
- **Linter/formatter**: Biome
- **Package manager**: pnpm

## Project structure

```
src/
  commands/       # CLI commands: check.ts, debug.ts
  config/         # Config loading and types
  files/          # File discovery and feature ownership
  graph/          # Dependency graph structures
  linter/         # Main linting engine (FeatureBoundariesLinter)
  parser/         # SWC-based import extractor
  resolution/     # Module resolver (handles tsconfig paths)
  rules/          # CycleDetector, FeatureBoundaryValidator
  reporter/       # Colored CLI output
  services/       # LintOrchestrator, StatisticsCalculator, ViolationFilter
  tsconfig/       # tsconfig.json parser
```

## CLI commands

```bash
domainlint check [path]       # Main command — reports violations
domainlint debug <file>       # Debug imports/violations for a single file
```

## Common tasks

```bash
pnpm test:run         # Run tests once
pnpm build            # Compile TypeScript to dist/
pnpm lint             # Biome check
pnpm lint:fix         # Biome auto-fix
```

## Configuration

Config file: `domainlint.json` (or via CLI flags). Key options:
- `srcDir` (default: `src`)
- `featuresDir` (default: `src/features`)
- `barrelFiles` (default: `["index.ts"]`)
- `extensions` (default: `[".ts", ".tsx"]`)
- `includeDynamicImports` (default: `false`)

## Violation codes

- `ARCH_IMPORT_CYCLE` — circular dependency detected
- `ARCH_NO_CROSS_FEATURE_DEEP_IMPORT` — cross-feature import bypasses barrel

## Exit codes

- `0` — no violations
- `1` — violations found
- `2` — internal error

## Testing

See `TESTING.md` for conventions (colocation, memfs, behavioral style).

## Spec

See `SPEC.md` for the full formal specification.

## Pull requests

Use conventional commits for PR names. Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`

Examples:
- `feat(rules): add import depth limit rule`
- `fix(resolver): handle symlinked node_modules`
- `docs(readme): update configuration options`

## Docs

The `docs/` directory contains an Astro/Starlight site. When changing CLI commands, flags, or user-facing behaviour, update the relevant pages under `docs/src/content/docs/` as well.

## Roadmap

At the start of every task, read `ROADMAP.md` to understand the current state of the project.
Once the task is complete, update `ROADMAP.md` to reflect the new status of any items worked on.
