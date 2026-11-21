# domainlint

Architecture linter for TypeScript/JavaScript codebases. Enforces feature boundary rules and detects import cycles.

## Installation

```bash
npm install -g domainlint
```

The analysis core is a native addon (Rust), shipped as prebuilt binaries in per-platform
packages (`domainlint-binding-<platform>`) that your package manager installs automatically as
optional dependencies. No Rust toolchain is needed.

| OS | Architectures |
|----|---------------|
| Linux (glibc) | x64, arm64 |
| Linux (musl, e.g. Alpine) | x64, arm64 |
| macOS | x64, arm64 |
| Windows | x64 |

Don't install with `--omit=optional` / `--no-optional`, or domainlint can't load the addon. On an
unsupported platform you can build it from source with a Rust toolchain
(`pnpm --filter domainlint build:native` in the repository).

## Usage

```bash
domainlint check [path]       # Report violations
domainlint debug <file>       # Debug imports/violations for a single file
```

## Configuration

Create a `domainlint.json` in your project root:

```json
{
  "srcDir": "src",
  "featuresDir": "src/features",
  "barrelFiles": ["index.ts"],
  "extensions": [".ts", ".tsx"],
  "includeDynamicImports": false
}
```

## Using with AI agents

`domainlint` ships agent-facing skills (Claude Code, Cursor, Copilot, etc.) via
[`@tanstack/intent`](https://www.npmjs.com/package/@tanstack/intent). Install them once per project:

```bash
npx @tanstack/intent@latest install
```

This wires the skills bundled with `domainlint` (in `node_modules/domainlint/skills/`) into your agent so it knows how to configure the linter, write custom rules, and triage violations.

## Commands

<!-- commands -->
<!-- commandsstop -->
