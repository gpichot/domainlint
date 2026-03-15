# Roadmap

Items ordered by priority. Each section is designed to be handled independently by a dedicated agent.

---

## 1. tsconfig `extends` chain

**Status:** partial, relies on `tsc --showConfig` with fallback
**Scope:** `src/tsconfig/tsconfig-loader.ts`

- Ensure `extends` resolution is reliable without requiring `tsc` installed
- Implement pure-TS `extends` resolution as fallback
- Add tests for 2-level inheritance and monorepo-style tsconfig

---

## 2. Custom rules support

**Status:** not implemented
**Scope:** new feature, non-trivial

Allow users to define additional import restriction rules in `domainlint.json`:

```json
{
  "rules": [
    {
      "from": "src/features/**",
      "deny": ["src/lib/**", "src/utils/**"],
      "message": "Features must not import from shared lib directly"
    }
  ]
}
```

Design notes:
- Rules are path-glob pairs (`from` + `deny`)
- Evaluated after resolution, same as R2
- New violation code: `ARCH_CUSTOM_RULE`
- Documented in `SPEC.md` as R4+

---

## Non-goals (for now)

- Intra-feature layering enforcement (e.g. `ui` cannot import `domain`)
- Auto-fix suggestions
- VSCode extension / LSP integration
- Watch mode
- Web visualization (removed from v0.x scope)
