# domainlint

A TypeScript/JavaScript linter that enforces architectural boundaries and detects import cycles in feature-based codebases.

## What it does

`domainlint` helps maintain clean architecture in domain-driven or feature-based projects by:

- **🏗️ Enforcing feature boundaries**: Ensures that code within features only imports from allowed locations (other features via barrel files, same feature internal files)
- **🚫 Preventing non-domain imports**: Blocks feature files from importing from non-domain directories (like `src/lib`, `src/utils`, etc.)
- **🔄 Detecting import cycles**: Identifies circular dependencies that can lead to runtime errors and poor maintainability
- **📊 Providing detailed reports**: Shows violations with file paths, cycle analysis, and domain-specific summaries
- **⚙️ Flexible configuration**: Supports custom rules, overrides, and TypeScript configuration integration

Perfect for React applications with feature folders, domain-driven architectures, or any codebase where you want to enforce import rules and prevent circular dependencies.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/domainlint.svg)](https://npmjs.org/package/domainlint)
[![Downloads/week](https://img.shields.io/npm/dw/domainlint.svg)](https://npmjs.org/package/domainlint)

<!-- toc -->
* [domainlint](#domainlint)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->
```sh-session
$ npm install -g domainlint
$ domainlint COMMAND
running command...
$ domainlint (--version)
domainlint/0.1.1 darwin-arm64 node-v22.21.0
$ domainlint --help [COMMAND]
USAGE
  $ domainlint COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`domainlint help [COMMAND]`](#domainlint-help-command)
* [`domainlint lint [PATH]`](#domainlint-lint-path)

## `domainlint help [COMMAND]`

Display help for domainlint.

```
USAGE
  $ domainlint help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for domainlint.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.36/src/commands/help.ts)_

## `domainlint lint [PATH]`

Lint feature boundaries and import cycles

```
USAGE
  $ domainlint lint [PATH] [-c <value>] [--src-dir <value>] [--features-dir <value>] [--tsconfig-path
    <value>] [--include-dynamic-imports] [--no-color] [-v] [--feature <value>] [--shortest-cycles] [--max-cycle-length
    <value>]

ARGUMENTS
  [PATH]  [default: .] Path to the project to lint

FLAGS
  -c, --config=<value>            Path to config file
  -v, --verbose                   Verbose output
      --feature=<value>           Filter violations by feature name
      --features-dir=<value>      Features directory (default: src/features)
      --include-dynamic-imports   Include dynamic imports in analysis
      --max-cycle-length=<value>  [default: 50] Hide cycles longer than this length
      --no-color                  Disable colored output
      --shortest-cycles           Show only the shortest cycles (easier to fix)
      --src-dir=<value>           Source directory (default: src)
      --tsconfig-path=<value>     Path to tsconfig.json (default: ./tsconfig.json)

DESCRIPTION
  Lint feature boundaries and import cycles

EXAMPLES
  $ domainlint lint

  $ domainlint lint ./my-project
```

_See code: [src/commands/lint.ts](https://github.com/gpichot/domainlint/blob/v0.1.1/src/commands/lint.ts)_
<!-- commandsstop -->

- [`domainlint help [COMMAND]`](#domainlint-help-command)
- [`domainlint lint [PATH]`](#domainlint-lint-path)

## `domainlint help [COMMAND]`

Display help for domainlint.

```
USAGE
  $ domainlint help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for domainlint.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.36/src/commands/help.ts)_

## `domainlint lint [PATH]`

Lint feature boundaries and import cycles

```
USAGE
  $ domainlint lint [PATH] [-c <value>] [--src-dir <value>] [--features-dir <value>] [--tsconfig-path
    <value>] [--include-dynamic-imports] [--no-color] [-v] [--feature <value>] [--shortest-cycles] [--max-cycle-length
    <value>]

ARGUMENTS
  [PATH]  [default: .] Path to the project to lint

FLAGS
  -c, --config=<value>            Path to config file
  -v, --verbose                   Verbose output
      --feature=<value>           Filter violations by feature name
      --features-dir=<value>      Features directory (default: src/features)
      --include-dynamic-imports   Include dynamic imports in analysis
      --max-cycle-length=<value>  [default: 50] Hide cycles longer than this length
      --no-color                  Disable colored output
      --shortest-cycles           Show only the shortest cycles (easier to fix)
      --src-dir=<value>           Source directory (default: src)
      --tsconfig-path=<value>     Path to tsconfig.json (default: ./tsconfig.json)

DESCRIPTION
  Lint feature boundaries and import cycles

EXAMPLES
  $ domainlint lint

  $ domainlint lint ./my-project
```

_See code: [src/commands/lint.ts](https://github.com/gpichot/domainlint/blob/v0.1.0/src/commands/lint.ts)_
