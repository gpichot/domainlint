# domainlint

Architecture linter for TypeScript/JavaScript codebases. Enforces feature boundary rules and detects import cycles.

## Installation

```bash
npm install -g domainlint
```

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
