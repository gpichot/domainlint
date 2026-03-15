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

## 2. Duplicate .ts/.tsx file handling

**Status:** done
**Scope:** `packages/domainlint/src/graph/dependency-graph.ts`

- When both `a.ts` and `a.tsx` exist, they are no longer collapsed into a single graph node
- Path normalization now detects collisions and preserves full paths for ambiguous files
- Prevents false positive cycle detection when both extensions coexist
- Tests cover: separate nodes, correct edge resolution, non-colliding files unaffected

---

## 3. Custom rules support

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
