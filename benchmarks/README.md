# Benchmarks

Reproducible speed comparison of `domainlint check` against other tools, in
three scenarios:

| Scenario | What is checked | Tools |
|----------|-----------------|-------|
| `cycles` | Import cycles only | domainlint, oxlint `import/no-cycle`, madge, dependency-cruiser, ESLint `import-x/no-cycle` |
| `boundaries` | "Domain" rule only: cross-feature imports must go through the feature's `index.ts` | domainlint, oxlint + `eslint-plugin-boundaries` (JS plugin), dependency-cruiser, ESLint `eslint-plugin-boundaries` |
| `full` | Both, in one run (what you'd put in CI) | domainlint, oxlint (no-cycle + boundaries JS plugin), dependency-cruiser, ESLint (import-x + boundaries) |

madge has no boundaries rule, so it only runs in `cycles`. oxlint has no native
one either; it runs [`eslint-plugin-boundaries`](https://www.jsboundaries.dev/)
through its alpha `jsPlugins` API.

Not included: [`oxlint-plugin-boundaries`](https://www.npmjs.com/package/oxlint-plugin-boundaries)
(0.1.0, alpha). It enforces an element-type allow-matrix by file path but has no
entry-point (barrel) rule, so it can't express this scenario.

Nothing large is committed: projects are generated on demand.

## Run

```bash
pnpm install
pnpm --filter domainlint build
node benchmarks/run.mjs
```

`domainlint-rs (prototype)` is the Rust spike in `crates/domainlint-graph`. It is
skipped with a warning unless built:

```bash
cargo build --release -p domainlint-graph
```

Options:

```bash
node benchmarks/run.mjs --scenarios boundaries --sizes 100x100,200x100 --runs 5
node benchmarks/run.mjs --tools domainlint,oxlint --json results.json
```

- `--sizes` takes `<features>x<filesPerFeature>`.
- Each tool gets one warm-up run, then the median of `--runs` timed runs is
  reported (wall clock, including process start-up).
- The `findings` column is a sanity check that each tool actually detected the
  seeded problems. Units differ between tools (madge counts cycles, others
  count offending files or imports), so compare magnitudes, not exact numbers.

Competitor tools are installed once into `benchmarks/.tools/` at pinned
versions (gitignored). Fixtures are generated under the OS temp dir
(`--out` to change it): oxlint always honours `.gitignore`, so fixtures can't
live inside this repository.

Per-scenario tool configs live in [`configs/`](./configs).

## Generate a fixture only

```bash
node benchmarks/generate.mjs /tmp/fixture --features 100 --files 100
```

Generated projects use a `@/*` tsconfig path alias, ~20% barrel imports across
features, ~0.5% deep cross-feature imports (violations), and a 2-file cycle in
every 9th feature. Generation is deterministic (`--seed`).

## Caveats

- Synthetic code: small, uniform files. Real projects have bigger files, which
  favours native parsers (domainlint, oxlint), and more `node_modules` imports.
- Results depend heavily on disk and CPU; compare numbers from the same machine.
