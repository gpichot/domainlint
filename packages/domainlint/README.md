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

## Commands

<!-- commands -->
<!-- commandsstop -->
