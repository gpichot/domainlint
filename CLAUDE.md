# domainlint

Architecture linter for TypeScript/JavaScript codebases. Enforces feature boundary rules and detects import cycles.

## What it does

Two core rules:
- **R1** – No import cycles across the module graph
- **R2** – Cross-feature imports must go through barrel files only (`src/features/<name>/index.ts`)

## Tech stack

- **Core**: Rust (stable, Cargo workspace) — parsing with `oxc_parser`, resolution with `oxc_resolver` (handles tsconfig paths), graph + built-in rules
- **Bridge**: napi-rs addon (`crates/domainlint-graph-napi`), built with `@napi-rs/cli`. There is no JS fallback: a missing addon exits with code 2
- **Runtime**: Node.js ≥18, TypeScript, ESM
- **CLI**: oclif
- **Tests**: vitest (JS), `cargo test` (Rust)
- **Linter/formatter**: oxlint (`.oxlintrc.json`) + oxfmt (`.oxfmtrc.json`); clippy + rustfmt for Rust
- **Package manager**: pnpm (monorepo)

## Project structure

```
crates/
  domainlint-graph/        # Rust core: discovery, parse, resolve, graph, built-in rules (lib + `domainlint-rs` CLI)
  domainlint-graph-napi/   # napi-rs addon exposing the core to Node (`lint`, `parseImports`, `resolveImports`)
packages/domainlint/
  src/
    commands/      # CLI commands: check.ts, debug.ts
    config/        # Config loading, types, rule overrides
    files/         # FileInfo + feature ownership (discovery itself is native)
    graph/         # DependencyGraph types + GraphQuery (custom rule API)
    linter/        # Main linting engine (FeatureBoundariesLinter)
    native/        # Addon loader + pipeline rebuilding the JS graph from typed arrays
    parser/        # Import types only
    rules/         # Custom Rule API + workspace rules (noPackageImport, noPackageCycle)
    reporter/      # Colored CLI output
    services/      # LintOrchestrator, StatisticsCalculator, ViolationFilter
    workspace/     # Workspace detection and per-package runner
    path-utils.ts
  npm/<platform>/  # Prebuilt `domainlint-binding-<platform>` packages
  scripts/         # ensure-native, inject-optional-deps, generate-schema
benchmarks/        # Benchmark fixtures generator + runner
docs/              # Astro/Starlight docs site
```

## CLI commands

```bash
domainlint check [path]       # Main command — reports violations
domainlint debug <file>       # Debug imports/violations for a single file
```

## Common tasks

```bash
pnpm --filter domainlint build:native   # Build the napi addon (tests auto-build it if missing)
pnpm test:run         # Run tests once
pnpm build            # Compile TypeScript to dist/
pnpm lint             # oxlint
pnpm lint:fix         # oxlint --fix
pnpm format           # oxfmt (write)
pnpm format:check     # oxfmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

## Configuration

Config file: `domainlint.json` (or via CLI flags). Key options:
- `srcDir` (default: `src`)
- `featuresDir` (default: `src/features`)
- `barrelFiles` (default: `["index.ts"]`)
- `extensions` (default: `[".ts", ".tsx", ".d.ts"]`)
- `includeDynamicImports` (default: `false`)

## Violation codes

- `noImportCycle` — circular dependency detected
- `noFeatureImportFromNonDomain` — feature file imports from outside the features directory
- `noCrossFeatureDeepImport` — cross-feature import bypasses barrel
- `noPackageImport` — workspace mode: import denied by `packageRules`
- `noPackageCycle` — workspace mode: circular dependency between packages

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
