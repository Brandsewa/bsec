# Change record: Design System Part 7 — Hardening and Clean-up

- **Date:** 2026-10-07
- **Agent:** antigravity
- **Branch:** feat/ds-06-customer-auth
- **Area:** design-system, ui, web, admin, config, docs
- **Type:** chore

---

## Summary

This change implements Part 7 (Hardening and Clean-up) of the bsec design system overhaul (`docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md`):

1. **Legacy Variables & Token Clean-up**:
   - Replaced legacy `--s-*` variables in `apps/admin/index.html` with standard semantic tokens (`--background`, `--sidebar`, `--border`, `--muted`).
   - Cleaned `packages/ui/src/components/skeleton.tsx` to remove legacy `bs-skeleton` class, using unified `animate-pulse rounded-md bg-muted`.
   - Removed non-existent `./skeleton-shell.html` export from `packages/ui/package.json`.
   - Removed duplicate/legacy `packages/ui/src/components/select.tsx` and removed its `LegacySelect` re-export from `packages/ui/src/index.ts`. All apps and packages now uniformly use `@bs/ui` `Select`, `SimpleSelect`, or `Combobox`.

2. **Lint Guards Extended to `apps/web`**:
   - Extended custom ESLint rule `bs/design-system-guards` (`packages/config/eslint/rules/design-system-guards.js`) to guard `apps/web` customer account and auth files:
     - `apps/web/src/components/account/*`
     - `apps/web/src/app/account/*`
     - `apps/web/src/app/privacy*`
     - `apps/web/src/app/orders/*`
     - `apps/web/src/app/o/*`
     - `apps/web/src/app/unsubscribe/*`
     - `apps/web/src/app/address/*`
     - `apps/web/src/app/cod/*`
   - Guard rules enforced:
     - No native `<select>` (message: `noNativeSelect`)
     - No `window.confirm` (message: `noWindowConfirm`)
     - No `rounded-full` on `Button` (message: `noRoundedFullButton`)
     - No raw hex literals (message: `noRawHex`)
     - No direct imports of `@base-ui/react`, `@radix-ui/*`, `sonner`, `react-day-picker`, `cmdk`, `vaul` from app components (must import from `@bs/ui`)
   - Verified that deliberate test violations trigger errors on each guard, and verified clean pass upon reverting.

3. **Documentation**:
   - Added `docs/design-system.md` containing principles, semantic token matrix, primitives in `@bs/ui`, composed skeletons, store accent derivation (`@bs/ui/server`), and instructions on how to add new components.
   - Updated `docs/ARCHITECTURE.md` with `@bs/ui/server` export documentation and bumped "Last verified against" to `feat/ds-06-customer-auth`.
   - Updated `progress.md` In flight record.

---

## Verification

### 1. Evidence of Zero Dead Aliases & Banned Patterns

- **`git grep "\-\-s-"`**:
  ```
  docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md:1. **Shell:** ... Remove index.html inline CSS variables (--s-*); the boot shell now uses tokens.
  docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md:**Acceptance:** rg "--s-" apps/superadmin empty...
  docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md:1. Remove the legacy token aliases ... every --s-* variable.
  docs/changes/2026-10-05-antigravity-ds-03-full-unification.md:2. Cleaned all legacy --s-* CSS variables...
  ```
  *(Zero occurrences in application code or HTML files).*

- **`git grep "bs-skeleton"`**:
  ```
  docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md:1. Remove the legacy token aliases ... the old bs-skeleton and store-skeleton classes...
  ```
  *(Zero occurrences in application code).*

- **`git grep "LegacySelect"`**:
  *(Empty / 0 occurrences across repository).*

### 2. Lint Guard Failure Verification (Deliberate Violations on `apps/web/src/app/account/page.tsx`)

```
C:\dev\bsec-design-p6\apps\web\src\app\account\page.tsx
   6:1   error  Direct import of 'sonner' is forbidden in apps. Import primitives from @bs/ui                                bs/design-system-guards
   7:22  error  Do not use native <select>. Use Select, SimpleSelect or Combobox from @bs/ui                                 bs/design-system-guards
   8:28  error  Do not use window.confirm. Use ConfirmDialog from @bs/ui                                                     bs/design-system-guards
   9:24  error  Buttons must be rectangular with 6px radius (no rounded-full on Button)                                      bs/design-system-guards
  10:45  error  Raw hex colors (#ff0000) are forbidden in app components. Use semantic CSS tokens (--brand, --border, etc.)  bs/design-system-guards

✖ 5 problems (5 errors, 0 warnings)
```
*(All 5 violations caught as expected, then cleanly reverted).*

### 3. Full Verification Gate Counts

- **Typecheck**: `pnpm typecheck`
  ```
  Tasks:    15 successful, 15 total
  Cached:    12 cached, 15 total
  ```
- **Lint**: `pnpm lint`
  ```
  Tasks:    15 successful, 15 total
  Cached:    13 cached, 15 total
  ```
- **Build**: `pnpm build`
  ```
  Tasks:    6 successful, 6 total
  Cached:    0 cached, 6 total
  ```
- **Docs Freshness**: `pnpm docs:check` / `node scripts/check-docs.mjs`
  ```
  docs:check ok
  ```
- **Package Tests**:
  - `@bs/ui`: `vitest run` — 4 passed test files, 40 passed tests (contrast, accent, components, ui).
  - `@bs/web`: `pnpm --filter @bs/web test:fast` — 19 passed test files, 175 passed tests.
  - `@bs/admin`: `pnpm --filter @bs/admin test` — 11 passed test files, 72 passed tests.
  - `@bs/config`: `pnpm --filter @bs/config test` — 1 passed test file, 39 passed tests.

---

## Definition of Done Checklist

- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision (none required; follows existing design system guide).
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or deploy pipeline changed (not changed).
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
