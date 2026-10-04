# Task: bring the Super Admin dashboard onto the new admin design system

You are working in the `bsec` monorepo (pnpm + turbo, TypeScript, React 19, Tailwind 4, TanStack Router/Query, oRPC). The **store admin** (`apps/admin`) was just redesigned onto a new component system. Your job is to apply the **same design, components and UX patterns** to the **Super Admin** app (`apps/superadmin`, platform staff dashboard), working screen by screen, without breaking behaviour.

## Read first (in this order)
1. `docs/admin-ui-standards.md` — the rule, the shared kit, layout and type conventions, a checklist for list screens. **This is the contract.**
2. `progress.md`, section "Admin UI refresh (2026-10-01)".
3. Reference implementations in `apps/admin/src`:
   - Lists: `routes/_store/orders.tsx` (the reference), plus `customers.tsx`, `discounts.tsx`, `products/index.tsx`, `inventory/index.tsx`.
   - Detail / create pages: `routes/_store/orders_.$orderId.tsx`, `customers_.$customerId.tsx`, `discounts_.new.tsx`.
   - Settings workspace: `routes/_store/settings.tsx` and `components/settings/*`.
   - Shell: `components/app-shell.tsx`, `src/index.css` (token mapping and the grey-canvas / white-sidebar override).
   - Kit: `components/data-table/*`, `simple-select.tsx`, `date-range-picker.tsx`, `scroll-tabs.tsx`, `confirm-dialog.tsx`, `components/ui/*`.

## Standing rule (also in `docs/admin-ui-standards.md`)
Use the shared components and style for every table, dropdown, date picker, tab row, confirmation, form field and page header. Never hand-roll these, never use a native `<select>` or `window.confirm`, never use `@bs/ui` form controls in new or touched code. If a component you need is missing, add it to the kit and use it everywhere.

## Superadmin as it is today
Vite SPA, **code-based router** (`src/router.tsx`, pages in `src/pages/`, not file routes). Pages: `Login`, `AcceptInvitation`, `Layout` (shell), `Overview`, `TenantsList`, `TenantCreate`, `TenantDetail`, `Signups`, `Plans`, `Quotas`, `Features`, `Domains`, `Templates`, `TemplateEditor`, `Staff`, `Support`, `System`, `AuditLog`. It currently uses `@bs/ui` (Radix-based) components and `AppShell` from `@bs/ui`. Auth is platform-staff with mandatory MFA; support sessions and the roles `platform_owner` / `platform_admin` / `platform_support` gate actions (see `DEPLOYMENT.md`). **Do not change auth, MFA, role gating or support-session behaviour.**

## What to do

### 1. Foundation (do first, commit separately)
- Add shadcn to `apps/superadmin` exactly as `apps/admin` has it: `components.json` (style `base-mira`, Base UI, Lucide), `@/` alias in `tsconfig.json`, `vite.config.ts` **and** `vitest.config.ts`, `src/lib/utils.ts` (`cn` from `clsx` + `tailwind-merge`), `src/index.css` with the shadcn variable mapping onto the existing Supabase-style tokens (copy the pattern from `apps/admin/src/index.css`). Do **not** edit the shared `packages/ui/src/styles/tokens.css` — both apps import it; override in the app's own `index.css` (white sidebar, grey canvas `--dash-canvas`, white `--card`).
- Copy the shared kit from `apps/admin/src/components` into `apps/superadmin/src/components` (same file names and structure) so a future extraction into a package is trivial. Note in `docs/admin-ui-standards.md` that the kit is currently duplicated and should be extracted into a shared package later. Do not refactor `apps/admin` to do this extraction in this task.
- Install components with `pnpm dlx shadcn@latest add <names> --yes` from `apps/superadmin`.
  **CLI gotchas we already hit:** it writes `import { cn } from "cn"` and adds an unrelated npm package `cn` — rewrite those imports to `@/lib/utils` and remove the `cn` dependency; answer "no" to overwrite prompts (`yes n | pnpm dlx shadcn@latest add ...`); generated files may fail `exactOptionalPropertyTypes` (add `| undefined`) or lint rules.
- Replace the shell with the collapsible sidebar from `app-shell.tsx` (icon-collapse, Ctrl/Cmd+B, remembered in a cookie, **12rem** wide, white sidebar on grey canvas). Keep the existing nav entries, role-based visibility and the staff/user area.

### 2. Screens
Apply, in this order, committing after each group:
1. `Login`, `AcceptInvitation` — same treatment as `apps/admin/src/routes/login.tsx` / `accept-invite.tsx`.
2. `TenantsList` (stores), `Signups`, `Staff`, `Domains`, `Support`, `AuditLog`, `Templates`, `Plans`, `Quotas`, `Features`, `System`: list/table screens use the table kit — server-side search, filters, sort, paging (25/50/100), URL state, selection with bulk actions where the API has a real action (otherwise Export only), filter chips, Columns menu, sticky header, quick-actions menu, mobile cards, mobile toolbar (search row, then Filters and Sort sidebars), `ScrollTabs` for saved views (e.g. store status), `DateRangePicker` for date filters (Audit log and Signups especially), `SimpleSelect` for dropdowns. Config-style screens (Plans, Quotas, Features, System) can be simple sections/cards using the settings frame pattern instead of a table if a table does not fit.
3. `TenantDetail` and `TenantCreate`: full pages (no side panels or pop-ups), card sections, header with title/description left and actions right. Destructive and irreversible actions (suspend, archive, delete, plan change, support access) use `ConfirmDialog`.
4. `Overview`: compact metric cards (`grid-cols-2` on phones), server counts.
5. `TemplateEditor`: restyle the chrome only (header, buttons, dropdowns). Do **not** change editor behaviour.

### 3. Backend
List endpoints that lack server-side search/filter/sort/paging need them added in the platform API (`packages/contracts`, `packages/domain`, `apps/platform`). Only use existing columns, always add an `id` tie-break to sorts, keep the platform service's BYPASSRLS role rules in mind, and never loosen access checks. After changing contracts or domain, restart the dev server (new query params are silently dropped otherwise).

### 4. Conventions that must match admin
- Page header: `PageHeader` from `@bs/ui` with `aside` for buttons; no breadcrumb on list pages.
- Type scale: page title 20px, description 14px, tables/forms/body 12px, section titles 14px semibold.
- Popups use the frosted style already in `components/ui/{dropdown-menu,select,popover}.tsx`.
- Mobile: tables become cards; tab rows scroll horizontally.
- Pages that use the table kit or `useUnsavedGuard` must render inside a router in tests (see `renderRouted` in `apps/admin/test/catalog-pages.test.tsx`).

## Definition of done
- `pnpm --filter @bs/superadmin typecheck`, `lint`, `test`, and `build` pass; also typecheck/lint/test any package you touched (`@bs/contracts`, `@bs/domain`, `@bs/platform`).
- Each migrated screen was **opened in a real browser** (desktop and a 375px viewport) and exercised: filters, sort, paging, selection/bulk action or primary action, back/forward keeps URL state, empty and error states. Say honestly what you did not verify.
- Update `e2e/superadmin.spec.ts` for any changed labels/controls (dropdowns are no longer native selects). If you cannot run Playwright, say so.
- `docs/admin-ui-standards.md` and `progress.md` updated: what moved, what is still old, the duplication note.

## Local dev notes
Stack: Docker Postgres + the three services; `bsec/.env.dev` (gitignored) holds local credentials; see `progress.md` and `DEPLOYMENT.md`. Platform staff need MFA, so signing in locally means creating a staff user with `create-staff` and enrolling an authenticator (a small script with a TOTP library is fine for local testing). Avoid recursive greps over the repo root (node_modules makes them time out); use the search tools.

## Rules of engagement
- **First step: create a separate local branch** from the current `main` (`git switch main && git pull && git switch -c feat/superadmin-ui`) and do all the work there. If `git status` is not clean, stop and tell me instead of stashing or discarding anything.
- Keep everything **local**: commit on that branch, but **do not push** the branch and **do not push to or merge into `main`** unless I explicitly ask. A push to `main` that passes CI deploys straight to production.
- Do not modify `apps/admin` except to fix a bug in the shared kit you discover (tell me if you do).
- Keep files UTF-8 (when scripting edits on Windows always open files with `encoding="utf-8"`).
- Prefer small, reviewable commits (foundation, then one per screen group).
