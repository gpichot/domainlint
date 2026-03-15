# Roadmap

Items ordered by priority. Each section is designed to be handled independently by a dedicated agent.

---

## 1. tsconfig `extends` chain

**Status:** done
**Scope:** `src/tsconfig/tsconfig-loader.ts`

- Pure-TS `extends` resolution is now the primary path (no `tsc` dependency)
- Supports 2-level inheritance, monorepo-style parent-directory extends, array extends (TypeScript 5.0+), and node_modules package extends
- Tests cover: single-level, 2-level chain, monorepo (parent dir), array extends, node_modules extends

---

## 2. Custom rules support

**Status:** done
**Scope:** `src/rules/custom-rule-validator.ts`, `src/config/types.ts`, `src/linter/feature-boundaries-linter.ts`

Users can define additional import restriction rules in `domainlint.json` via the `customRules` array:

```json
{
  "customRules": [
    {
      "from": "src/features/**",
      "deny": ["src/lib/**", "src/utils/**"],
      "message": "Features must not import from shared lib directly"
    }
  ]
}
```

Implemented features:
- Config-based rules with `from`/`deny`/`allow` glob patterns
- Custom `message` and `level` (`warn` | `error`) per rule
- New violation code: `ARCH_CUSTOM_RULE`
- Programmatic API: `linter.addRule((graph) => violations)` for full graph access
- Exported types: `CustomRuleConfig`, `CustomRuleFunction`, `DependencyGraph`
- Documented in `SPEC.md` as R4
- Tests cover deny, allow, multiple rules, level, messages, normalized paths

---

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
