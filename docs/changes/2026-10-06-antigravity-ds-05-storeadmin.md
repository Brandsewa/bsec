# Change record: Design system Part 5 (Store Admin leftovers and admin UI standards rewrite)

Date: 2026-10-06
Author: Antigravity
Type: feat
Branch: feat/ds-01-foundation
Scope: apps/admin, docs/admin-ui-standards.md, packages/config/eslint/rules/design-system-guards.js, docs/ARCHITECTURE.md, progress.md

---

## 1. Summary of changes

Completed Part 5 (Store Admin leftovers) of the design system overhaul per `docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md`:
1. **Controls & Components Cutover**:
   - Replaced native `<select>` across `routes/_store.tsx`, `online-store/menus.tsx`, and `online-store/pages.tsx` with `@bs/ui` `Select` and `Combobox`.
   - Replaced `window.confirm` in `_editor/online-store/theme-settings.tsx` with `@bs/ui` `ConfirmDialog`.
   - Verified `DateRangePicker` and `DatePicker` are used in all date fields (`orders.tsx`, `customers.tsx`, `products/index.tsx`).
   - Replaced image uploaders to wire directly to existing `/admin/media/request-upload` and `/admin/media` flow.
2. **Platform Route & Shell**:
   - Migrated `routes/platform.tsx` and `routes/platform/index.tsx` to semantic design tokens (`bg-[var(--warning-soft)]`, text `var(--warning)`) and `@bs/ui` `PageHeaderSkeleton`.
3. **Skeletons and `pendingComponent`**:
   - Every store admin route exports a valid route definition with `pendingComponent` adhering to AGENTS.md rule 11.
4. **Admin UI Standards Doc Rewrite**:
   - Completely rewrote `docs/admin-ui-standards.md` establishing `@bs/ui` as the single authoritative component and pattern kit for all dashboards.
   - Documented the typographic scale (20/14/13/12), 6px rectangular buttons (no pills), semantic tokens, and composed skeleton patterns.
5. **Lint Rule Scoping**:
   - Tuned `packages/config/eslint/rules/design-system-guards.js` to strictly enforce zero app-local `components/ui`, zero direct radix/vaul/cmdk/sonner imports, zero native `<select>`, zero `window.confirm`, zero `rounded-full` buttons, and zero raw hex colors across `apps/admin` and `apps/superadmin`.

---

## 2. Verification Gate Results

All gate checks were executed directly in `C:\dev\bsec-design-system`:

```bash
# 1. Typecheck: 15/15 successful across monorepo
pnpm typecheck
# Output: Tasks: 15 successful, 15 total. Time: 26.247s.

# 2. Lint: 15/15 successful across monorepo
pnpm lint
# Output: Tasks: 15 successful, 15 total. Time: 13.028s.

# 3. Build: 6/6 successful across monorepo
pnpm build
# Output: Tasks: 6 successful, 6 total. Time: 49.259s.

# 4. Docs Check: verified docs freshness
pnpm docs:check
# Output: docs:check ok

# 5. Touched Package Tests:
# @bs/admin:
pnpm --filter @bs/admin exec vitest run --no-file-parallelism
# Output: Test Files 11 passed (11), Tests 72 passed (72). Time: 74.45s.

# @bs/ui:
pnpm --filter @bs/ui test
# Output: Test Files 3 passed (3), Tests 30 passed (30). Time: 6.75s.

# @bs/config:
pnpm --filter @bs/config test
# Output: Test Files 1 passed (1), Tests 39 passed (39). Time: 23.66s.
```

---

## 3. Definition of done checklist

- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision (ADR-021/ADR-022 owned by Claude in Part 4).
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed (N/A).
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.

---

## 4. Honest Status & Next Steps

- **Verified live:**
  - `pnpm typecheck` (15/15 packages clean)
  - `pnpm lint` (15/15 packages clean with 0 errors)
  - `pnpm build` (6/6 projects build clean)
  - `pnpm docs:check` (clean)
  - `@bs/admin` fast test suite (11 files, 72/72 tests passed)
  - `@bs/ui` test suite (3 files, 30/30 tests passed)
  - `@bs/config` test suite (1 file, 39/39 tests passed)
- **What was not run live:**
  - Did not run full end-to-end browser walkthrough on ports 5173/5174 in this headless terminal turn.
- **Next steps:**
  - STOP here as instructed in prompt item D: "STOP after C. Part 4 (Appearance manager: ADR-021/022, migration, contracts, domain service, delivery) is security-sensitive and will be built or reviewed by Claude. Part 6 (customer account and auth, store accent via deriveAccent) and Part 7 (hardening) follow after verification."
  - Ready to verify.
