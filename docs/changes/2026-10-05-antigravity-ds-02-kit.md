# Part 2 Component Kit, Data-Table Kit & Design System Lint Guards

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/ds-01-foundation`
- **Area:** ui, admin, superadmin, config
- **Type:** feature
- **Supersedes:** none

## Summary
Completed Part 2 of the design-system overhaul per `docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md`:
1. Added missing shadcn/Base UI components and composed helpers in `@bs/ui`: `Combobox`, `MultiSelect`, `CommandPalette` (`cmdk`), `ResponsiveDialog` (`vaul` + `Dialog`), `DateTimePicker`, `Spinner`, `Empty`, `InputOTP`, `AuthShell`, `RouteProgress`, `StatusBadge`, `Money`, `RelativeTime`, and `Chart` (`recharts` reading `--chart-*` tokens).
2. Composed skeletons in `@bs/ui/src/patterns/skeletons.tsx`: `PageHeaderSkeleton`, `MetricCardsSkeleton`, `DataTableSkeleton`, `FormSectionSkeleton`, `DetailPageSkeleton`, `AuthCardSkeleton`, `AccountPageSkeleton`.
3. Moved data-table kit from `apps/admin/src/components/data-table/*` into `packages/ui/src/components/data-table/` with `SearchStateAdapter`.
4. Replaced and deleted duplicate local components in `apps/admin/src/components/` (`confirm-dialog`, `simple-select`, `date-range-picker`, `scroll-tabs`, `section-card`, `field`), migrating 40+ route and component references directly to `@bs/ui`.
5. Extended `/__kit` in `apps/superadmin/src/pages/Kit.tsx` to showcase all components across light and dark states.
6. Implemented Section 12 ESLint guards in `packages/config/eslint/rules/design-system-guards.js` preventing forbidden patterns, tested with 39 passing unit tests.

## What changed
- `packages/ui/src/components/`: Added `combobox.tsx`, `multi-select.tsx`, `command-palette.tsx`, `responsive-dialog.tsx`, `date-time-picker.tsx`, `spinner.tsx`, `route-progress.tsx`, `status-parts.tsx`.
- `packages/ui/src/components/ui/`: Added `chart.tsx`, `command.tsx`, `drawer.tsx`, `input-group.tsx`, `input-otp.tsx`.
- `packages/ui/src/components/data-table/`: Ported data-table kit from Store Admin.
- `packages/ui/src/patterns/skeletons.tsx`: Composed layout skeletons.
- `packages/ui/src/layout/auth-shell.tsx`: Unified AuthShell layout.
- `packages/config/eslint/rules/design-system-guards.js`: Guard against native select, window.confirm, rounded-full on Button, raw hex colors, and local UI folders.
- `packages/config/test/rules.test.ts`: Added tests verifying that every guard rule catches deliberate violations.
- `packages/ui/test/components.test.ts`: Added component unit tests.
- `apps/admin/src/components/`: Deleted duplicate local components.
- `apps/admin/src/routes/`: Converted imports from local components to `@bs/ui`.

## Decisions and trade-offs
- Backwards-compatible `Field` and `Select`: Maintained support for both children slots and label/hint/error/items props to ensure zero regression across Store Admin and Super Admin call sites.
- Base UI `Select` and `Dialog`: Base UI primitives use `render` rather than Radix's `asChild`; implemented dual support so both Vite and Next can consume them cleanly.

## Verification
- Gate passed across monorepo:
  - `pnpm typecheck`: 15/15 successful across monorepo (0 errors).
  - `pnpm build`: 6/6 successful across all packages and apps (`@bs/admin`, `@bs/superadmin`, `@bs/web`).
  - `pnpm docs:check`: ok.
  - `pnpm --filter @bs/ui lint`: 0 errors.
  - `pnpm --filter @bs/ui test`: 3/3 test files passed, 30/30 tests passed.
  - `pnpm --filter @bs/config test`: 1/1 test file passed, 39/39 tests passed.
  - `pnpm --filter @bs/admin lint`: 0 errors.
  - `pnpm --filter @bs/admin test:fast`: 6/6 test files passed, 53/53 tests passed.

## Docs updated
- [x] Change record `docs/changes/2026-10-05-antigravity-ds-02-kit.md` created.
- [ ] `docs/ARCHITECTURE.md`
- [ ] `progress.md`

## Follow-ups and open questions
- Proceed to Part 3 (Super Admin migration).

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (30 @bs/ui tests, 39 config tests).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure (updated in Part 5).
- [ ] ADR written or updated if you made or changed an architectural decision.
- [ ] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated (no port/env change).
- [x] A change record in `docs/changes/` and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what was verified live and tested.
