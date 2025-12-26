domainlint
=================

Linter for domain-based repository


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/domainlint.svg)](https://npmjs.org/package/domainlint)
[![Downloads/week](https://img.shields.io/npm/dw/domainlint.svg)](https://npmjs.org/package/domainlint)


<!-- toc -->
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
domainlint/0.0.0 darwin-arm64 node-v22.21.0
$ domainlint --help [COMMAND]
USAGE
  $ domainlint COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`domainlint hello PERSON`](#domainlint-hello-person)
* [`domainlint hello world`](#domainlint-hello-world)
* [`domainlint help [COMMAND]`](#domainlint-help-command)
* [`domainlint plugins`](#domainlint-plugins)
* [`domainlint plugins add PLUGIN`](#domainlint-plugins-add-plugin)
* [`domainlint plugins:inspect PLUGIN...`](#domainlint-pluginsinspect-plugin)
* [`domainlint plugins install PLUGIN`](#domainlint-plugins-install-plugin)
* [`domainlint plugins link PATH`](#domainlint-plugins-link-path)
* [`domainlint plugins remove [PLUGIN]`](#domainlint-plugins-remove-plugin)
* [`domainlint plugins reset`](#domainlint-plugins-reset)
* [`domainlint plugins uninstall [PLUGIN]`](#domainlint-plugins-uninstall-plugin)
* [`domainlint plugins unlink [PLUGIN]`](#domainlint-plugins-unlink-plugin)
* [`domainlint plugins update`](#domainlint-plugins-update)

## `domainlint hello PERSON`

Say hello

```
USAGE
  $ domainlint hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ domainlint hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/gpichot/domainlint/blob/v0.0.0/src/commands/hello/index.ts)_

## `domainlint hello world`

Say hello world

```
USAGE
  $ domainlint hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ domainlint hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/gpichot/domainlint/blob/v0.0.0/src/commands/hello/world.ts)_

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

## `domainlint plugins`

List installed plugins.

```
USAGE
  $ domainlint plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ domainlint plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/index.ts)_

## `domainlint plugins add PLUGIN`

Installs a plugin into domainlint.

```
USAGE
  $ domainlint plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into domainlint.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the DOMAINLINT_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the DOMAINLINT_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ domainlint plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ domainlint plugins add myplugin

  Install a plugin from a github url.

    $ domainlint plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ domainlint plugins add someuser/someplugin
```

## `domainlint plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ domainlint plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ domainlint plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/inspect.ts)_

## `domainlint plugins install PLUGIN`

Installs a plugin into domainlint.

```
USAGE
  $ domainlint plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into domainlint.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the DOMAINLINT_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the DOMAINLINT_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ domainlint plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ domainlint plugins install myplugin

  Install a plugin from a github url.

    $ domainlint plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ domainlint plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/install.ts)_

## `domainlint plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ domainlint plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ domainlint plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/link.ts)_

## `domainlint plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ domainlint plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ domainlint plugins unlink
  $ domainlint plugins remove

EXAMPLES
  $ domainlint plugins remove myplugin
```

## `domainlint plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ domainlint plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/reset.ts)_

## `domainlint plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ domainlint plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ domainlint plugins unlink
  $ domainlint plugins remove

EXAMPLES
  $ domainlint plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/uninstall.ts)_

## `domainlint plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ domainlint plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ domainlint plugins unlink
  $ domainlint plugins remove

EXAMPLES
  $ domainlint plugins unlink myplugin
```

## `domainlint plugins update`

Update installed plugins.

```
USAGE
  $ domainlint plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.54/src/commands/plugins/update.ts)_
<!-- commandsstop -->
