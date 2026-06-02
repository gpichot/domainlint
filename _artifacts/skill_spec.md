# domainlint — Skill Spec

domainlint is a CLI architecture linter for TypeScript/JavaScript that enforces two core rules over a project's import graph: no cycles, and cross-feature imports must go through barrel files. It is tsconfig-paths aware (via `oxc-resolver`), supports per-feature rule overrides, and exposes a programmatic `Rule` / `WorkspaceRule` API for project-specific architectural constraints.

## Domains

| Domain | Description | Skills |
| --- | --- | --- |
| Adoption & lifecycle (`adoption-lifecycle`) | Getting domainlint running on a real codebase and triaging the initial wave of violations. | adopt-on-existing-codebase |
| Configuration surface (`configuration`) | Static configuration in `domainlint.json`: fields, severities, overrides. | configure |
| Programmatic rule authoring (`rule-authoring`) | Writing TypeScript rules against the dependency graph. | write-custom-rule |
| Monorepo / workspace (`workspace`) | Cross-package boundaries and workspace-level rules. | use-in-monorepo |
| Debugging & introspection (`debugging`) | Diagnosing why specific files or cycles are reported. | debug-a-violation |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| --- | --- | --- | --- | --- |
| adopt-on-existing-codebase | lifecycle | adoption-lifecycle | First-run, Day-1 triage, scoping by feature, per-feature overrides, install-before-lint | 4 |
| configure | core | configuration | `domainlint.json` schema, severity keys, override resolution, Zod validation | 4 |
| write-custom-rule | core | rule-authoring | `Rule` interface, full `GraphQuery` API, `emitViolation`, DDD modeling | 5 |
| use-in-monorepo | framework | workspace | Workspace detection, `packageRules`, `WorkspaceRule` interface, built-in workspace rules | 4 |
| debug-a-violation | core | debugging | `domainlint debug`, `--shortest-cycles`, `--max-cycle-length`, `--feature`, `--verbose` | 3 |

## Failure Mode Inventory

### adopt-on-existing-codebase (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Treats every Day-1 violation as urgent | CRITICAL | maintainer interview | — |
| 2 | Runs domainlint before installing dependencies | HIGH | docs/ci.mdx | — |
| 3 | Project layout does not match defaults → assumes "no violations" means clean | HIGH | docs/feature-structure.mdx | configure |
| 4 | Excludes a noisy file via `exclude` instead of an override | MEDIUM | docs/configuration.mdx | configure |

### configure (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Uses violation code (`noImportCycle`) as override key instead of `import-cycles` | CRITICAL | docs/configuration.mdx, docs/rules.mdx | — |
| 2 | Uses a path/glob as the feature override key instead of the feature name | HIGH | docs/configuration.mdx | — |
| 3 | Forgets the leading `.` on `extensions` (Zod rejects) | MEDIUM | docs/configuration.mdx | — |
| 4 | Assumes `no-external-feature-imports` is on by default (it is `off`) | HIGH | docs/configuration.mdx | — |

### write-custom-rule (5 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Hallucinates GraphQuery methods that do not exist | CRITICAL | maintainer interview, docs/graphquery-api.mdx | — |
| 2 | Writes a rule from a vague human spec without nailing scope | CRITICAL | maintainer interview | — |
| 3 | Confuses module-level `Rule` with workspace-level `WorkspaceRule` | HIGH | docs/custom-rules.mdx, docs/workspaces.mdx | use-in-monorepo |
| 4 | Forgets `emitViolation` — rule silently does nothing | HIGH | docs/custom-rules.mdx | — |
| 5 | Re-implements a built-in / override-able check as a custom rule | MEDIUM | docs/rules.mdx, docs/configuration.mdx | configure |

### use-in-monorepo (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Defines `packageRules` / `workspaceRules` inside a package, not the workspace root | CRITICAL | docs/workspaces.mdx | — |
| 2 | Uses npm package name (`@org/core`) for `from`/`deny` instead of a path glob | HIGH | docs/workspaces.mdx | — |
| 3 | Adds a package without `src/` and expects it to be linted (silently skipped) | MEDIUM | docs/workspaces.mdx | — |
| 4 | Assumes Bun workspaces or Nx project graphs are auto-detected | MEDIUM | docs/workspaces.mdx | — |

### debug-a-violation (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Stares at a 50-deep cycle output without `--shortest-cycles` | HIGH | docs/cli.mdx, README.md | — |
| 2 | Reasons about a file in isolation instead of `domainlint debug` | MEDIUM | docs/cli.mdx | — |
| 3 | Forgets `--feature=<name>` during incremental cleanup | MEDIUM | docs/cli.mdx | adopt-on-existing-codebase |

## Tensions

| Tension | Skills | Agent implication |
| --- | --- | --- |
| Adoption ease vs architectural strictness | adopt-on-existing-codebase ↔ configure | Globally downgrades severities to make CI pass, defeating the rules. Right move is per-feature scoping. |
| Custom rule expressiveness vs config-first simplicity | write-custom-rule ↔ configure | Over-authors custom rules when an `overrides` entry would suffice. |
| Module-level `Rule` vs workspace-level `WorkspaceRule` | write-custom-rule ↔ use-in-monorepo | Exports the wrong interface or destructures non-existent context fields; rule never fires. |

## Cross-References

| From | To | Reason |
| --- | --- | --- |
| adopt-on-existing-codebase | configure | Day-1 triage is mostly writing the right `overrides`. |
| adopt-on-existing-codebase | debug-a-violation | `domainlint debug` and `--shortest-cycles` make individual violations tractable during cleanup. |
| configure | write-custom-rule | When overrides cannot express a constraint, the escalation path is a custom rule. |
| write-custom-rule | use-in-monorepo | Cross-package constraints use a different interface — module-level rule authors need to know it exists. |
| use-in-monorepo | configure | Workspace-only fields live in the same `domainlint.json`. |

## Subsystems & Reference Candidates

| Skill | Subsystems | Reference candidates |
| --- | --- | --- |
| adopt-on-existing-codebase | — | — |
| configure | — | Full `domainlint.json` schema and override resolution (8+ top-level fields + nested overrides). |
| write-custom-rule | — | (1) Full `GraphQuery` API method list with signatures (11 methods — #1 hallucination surface); (2) DDD architecture rule cookbook. |
| use-in-monorepo | — | — |
| debug-a-violation | — | — |

## Remaining Gaps

| Skill | Question | Status |
| --- | --- | --- |
| all | What does a 6-month-veteran user know that the docs do not? (Performance gotchas, large-scale anti-patterns, aging override patterns.) | open |

The library is at v0.7.0 with no long-tail production user base yet — implicit knowledge is genuinely thin and will accrete with adoption. Not a blocker.

## Recommended Skill File Structure

- **Core skills:** `configure`, `write-custom-rule`, `debug-a-violation`
- **Framework skills:** `use-in-monorepo` (covers pnpm/npm/yarn workspaces)
- **Lifecycle skills:** `adopt-on-existing-codebase`
- **Composition skills:** none — domainlint has no peer dependencies and no required co-usage with another library
- **Reference files:** under `write-custom-rule/` — (a) full `GraphQuery` API reference, (b) DDD rule cookbook. Under `configure/` — full `domainlint.json` schema reference.

## Composition Opportunities

| Library | Integration points | Composition skill needed? |
| --- | --- | --- |
| TypeScript / `tsconfig.json` | Path alias resolution via `compilerOptions.paths`; `extends` chain support | No — folded into `configure` and `adopt-on-existing-codebase` |
| pnpm / npm / yarn workspaces | Workspace detection sources | No — covered by `use-in-monorepo` |
| Biome / ESLint | Adjacent linters that solve overlapping problems (import restrictions) | No — maintainer dropped the positioning skill |
