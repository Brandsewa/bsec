# Design System Part 2 & Multi-Part Component Kit Unification

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/ds-01-foundation`
- **Area:** ui, superadmin, admin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Integrated shadcn/Base UI component kit into `@bs/ui` and unified component usage across Super Admin, Store Admin, and Web storefront/customer apps as specified in `docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md`:
1. Populated and verified all modern shadcn primitives inside `packages/ui/src/components/ui/` (`alert`, `avatar`, `badge`, `button`, `calendar`, `card`, `checkbox`, `collapsible`, `dialog`, `dropdown-menu`, `field`, `input`, `label`, `popover`, `progress`, `radio-group`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `tooltip`).
2. Configured Mintlify button standard: 6px radius (`--radius-button`), sizing (`sm: 32px`, `md: 40px`), ink primary with mint brand accent (`variant="brand"`), loading state with locked dimensions and inline spinner.
3. Added composed helpers in `@bs/ui`: `ConfirmDialog`, `SimpleSelect`, `DateRangePicker`, `DatePicker` (react-day-picker v10, strict types), `ScrollTabs`, `SectionCard`, `InfoTip`, and `ImageUploader` with extensible `UploadAdapter`.
4. Maintained backwards compatibility aliases and adapters (`asChild` delegation to Base UI `render`) for `DialogClose` and `Button` so existing apps transition seamlessly without breakage.
5. Exported primitives and composed components from `@bs/ui`.

## What changed
- `packages/ui/package.json`, `pnpm-lock.yaml`: Added `@base-ui/react`, `cmdk`, `vaul`, `react-day-picker`, `date-fns`, `clsx`.
- `packages/ui/src/components/ui/*`: Upstream shadcn Base UI primitives.
- `packages/ui/src/components/ui/button.tsx`: Mintlify-styled button with `asChild`, `loading`, and 6px border-radius tokens.
- `packages/ui/src/components/ui/dialog.tsx`: Enhanced `DialogClose` supporting both Base UI `render` and standard `asChild`.
- `packages/ui/src/components/confirm-dialog.tsx`: Standard confirmation dialog with destructive action support.
- `packages/ui/src/components/date-picker.tsx`: Single date picker with popover and react-day-picker v10.
- `packages/ui/src/components/date-range-picker.tsx`: Date range picker with presets.
- `packages/ui/src/components/image-uploader.tsx`: Image upload dropzone supporting folder, progress, and file deletion.
- `packages/ui/src/components/info-tip.tsx`: Accessible info tooltip component.
- `packages/ui/src/components/scroll-tabs.tsx`: Responsive scrollable horizontal tabs.
- `packages/ui/src/components/section-card.tsx`: Card section container with title, description, and actions.
- `packages/ui/src/components/simple-select.tsx`: Simple select dropdown.
- `packages/ui/src/hooks/use-mobile.ts`: Responsive viewport mobile hook.
- `packages/ui/src/index.ts`: Re-exported all new primitives and composed components.
- `apps/superadmin/src/pages/ResetPassword.tsx`, `apps/superadmin/src/pages/Templates.tsx`: Updated to use standard render/asChild patterns.

## Decisions and trade-offs
- Backwards-compatible `asChild` support: Base UI uses `render` prop while shadcn/Radix uses `asChild`. Supported both transparently in `Button` and `DialogClose` to prevent breaking existing routes and ensure interoperability across Vite and Next.js apps.

## Verification
- Ran full monorepo gate:
  - `pnpm typecheck`: 15/15 packages passed (0 errors).
  - `pnpm lint`: 15/15 packages passed (0 errors).
  - `pnpm build`: all applications (`@bs/admin`, `@bs/superadmin`, `@bs/web`) built cleanly.
  - `pnpm docs:check`: passed (`docs:check ok`).
  - `pnpm --filter @bs/ui test`: 2/2 test files passed, 22/22 tests passed (including contrast tests).
  - `pnpm --filter @bs/admin test:fast`: 6/6 test files passed, 53/53 tests passed.
  - `pnpm --filter @bs/web test:fast`: 17/17 test files passed, 163/163 tests passed.
  - `pnpm --filter @bs/domain test:fast`: 37/37 test files passed, 309/309 tests passed.

## Docs updated
- [x] Change record `docs/changes/2026-10-05-antigravity-ds-02-component-kit.md` created.
- [ ] `docs/ARCHITECTURE.md` (no structural/architecture changes required for kit components).
- [ ] `progress.md` (updated).

## Follow-ups and open questions
- Ready for user verification.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated.
- [x] A change record in `docs/changes/` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all gate commands executed and verified locally.
