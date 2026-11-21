# Benchmarks

Reproducible speed comparison of `domainlint check` against other tools that
detect import cycles and/or boundary violations:

| Tool | What it runs |
|------|--------------|
| domainlint | `domainlint check .` (cycles + feature boundaries) |
| madge | `madge --circular` (cycles only) |
| dependency-cruiser | `depcruise` with a `no-circular` + "no deep cross-feature import" config |
| ESLint | `eslint-plugin-import-x` `no-cycle` rule (cycles only) |

Nothing large is committed: projects are generated on demand.

## Run

```bash
pnpm install
pnpm --filter domainlint build
node benchmarks/run.mjs
```

Options:

```bash
node benchmarks/run.mjs --sizes 20x25,100x100,200x100 --runs 5 --json results.json
node benchmarks/run.mjs --tools domainlint,madge
```

`--sizes` takes `<features>x<filesPerFeature>`. Each tool gets one warm-up run,
then the median of `--runs` timed runs is reported (wall clock, including
process start-up).

Competitor tools are installed once into `benchmarks/.tools/` at pinned
versions; fixtures go to `benchmarks/.fixtures/`. Both are gitignored.

## Generate a fixture only

```bash
node benchmarks/generate.mjs /tmp/fixture --features 100 --files 100
```

Generated projects use a `@/*` tsconfig path alias, ~20% barrel imports across
features, ~0.5% deep cross-feature imports (violations), and a 2-file cycle in
every 9th feature. Generation is deterministic (`--seed`).

## Caveats

- Synthetic code: small, uniform files. Real projects have bigger files, which
  favours fast parsers (oxc), and more `node_modules` imports.
- madge and the ESLint rule only detect cycles; domainlint and
  dependency-cruiser also check boundaries in the same run.
- Results depend heavily on disk and CPU; compare numbers from the same machine.
