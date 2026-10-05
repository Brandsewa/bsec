# Design system implementation guide (single system: Super Admin, Store Admin, Customer account and auth)

Status: **approved direction, ready to build** (owner decisions 2026-10-05).
Builder: Google Antigravity. Verifier: Claude Code (verifies every part against its acceptance criteria and runs the gate before the next part starts; Antigravity never merges its own PR).
Visual reference: `DESIGN-mintlify.md` (owner's Downloads folder; the tokens you need are copied into section 3, so you do not need the file).
Read first, in this order: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md`, `docs/changes/` (newest), `progress.md`, ADR-010, ADR-011, ADR-018, and `node_modules/next/dist/docs/` (Next 16 is newer than your training data).

---

## 0. Decisions on record (do not re-open)

| # | Decision |
|---|---|
| D1 | Scope = **all non-storefront UI**: Super Admin (`apps/superadmin`), Store Admin (`apps/admin`), customer account and auth (`apps/web` `/account/*`, `/signup`, token pages) and platform/store admin auth screens. Merchant storefront pages and blocks stay per-store (ADR-010, ADR-018) and are **not touched**. |
| D2 | **One design system, one package: `@bs/ui`.** Same components and tokens in Vite (admin, superadmin) and Next (web). No per-app component forks. |
| D3 | Customer account pages use the **store's accent colour** for primary actions and focus; everything else uses platform tokens. |
| D4 | Default accent = **Mintlify mint `#00d4a4`** (derived scale in section 3.2). |
| D5 | **No pill buttons anywhere.** Rectangular buttons with a small radius (6px). Button sizes follow Mintlify's `button-md` (14px / 500, padding 10px 20px, about 40px tall); a compact `sm` (32px) exists for table toolbars and dense rows. |
| D6 | Font = **Geist** (UI) and **Geist Mono** (code, IDs, SKUs, money). Allow-list for the Super Admin picker: Geist, Inter, Manrope, DM Sans, IBM Plex Sans, system stack. |
| D7 | Image storage is **local filesystem today, Cloudflare R2 later**. The uploader talks to a storage-agnostic API so switching to R2 needs no UI change (section 8). Do not add R2 credentials (hard rule 14 / owner deferred). |
| D8 | Super Admin gets an **Appearance** screen that manages colours, fonts, density and radius for all dashboards (Part 5). |
| D9 | Build order: **Super Admin, then Store Admin, then Customer account and auth.** One document, one numbered sequence. |

---

## 1. Ground rules for the whole build

1. **Build in a separate git worktree, never in the owner's current checkout** (`C:\dev\bsec`, branch `design/marketing-landing`), so the current work stays untouched. Create it as a sibling folder from the latest `origin/main`:
   ```bash
   git fetch origin
   git worktree add ../bsec-design-system -b feat/design-system origin/main
   cd ../bsec-design-system && pnpm install
   ```
   Do all edits, installs, dev servers and commits there. Use one branch per part off that worktree (`feat/ds-01-foundation`, `feat/ds-02-kit`, ...), each merged only after Claude verifies it; rebase on the latest `origin/main` before each part. Do not edit another agent's worktree or the main checkout. Stage files by explicit path, never `git add -A`, never push to `main`. Remove the worktree (`git worktree remove`) only after everything is merged and the owner agrees.
2. Claim each part in `progress.md` "In flight" and leave one change record per part in `docs/changes/` (`YYYY-MM-DD-antigravity-<slug>.md`, definition-of-done checklist copied in).
3. Run the gate before saying a part is done: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm test:affected`. Paste the counts. Do not run test suites in parallel against one database.
4. **UI changes must be run and used**: `pnpm --filter @bs/superadmin dev` (5174), `pnpm --filter @bs/admin dev` (5173), `pnpm --filter @bs/web dev` (3000). Check light, dark, system, 375px and desktop. Say plainly what you could not run.
5. No `eslint-disable`, no secrets, no generated files in commits, no unrelated edits, no test against the live store.
6. If a rule blocks you, stop and record it under "Open questions" in the change record instead of working around it.
7. Match surrounding code style and comment density. Comments explain why.
8. Hard rules that this work touches: **#2** (only `packages/db` and `packages/domain` import `drizzle-orm`/`pg`), **#3** (logic in domain), **#6** (platform mutations write `platform_audit_logs`), **#8** (no merchant code: tokens are validated JSON, never raw CSS), **#9** (DB roles), **#10** (append-only migrations), **#11** (`pendingComponent` and `loading.tsx`).

---

## 2. Architecture: how one system serves Vite and Next

```
packages/ui/                       the only component + token package
  src/styles/
    tokens.css                     primitives + semantic tokens (light, dark)
    base.css                       element resets, focus ring, scrollbars, selection, font-face
    motion.css                     duration/easing tokens, keyframes, reduced-motion
    index.css                      @import of the three above (apps import @bs/ui/styles.css)
  src/components/ui/               shadcn components (Base UI flavour, "base-mira"), one file each
  src/components/                  composed shared components (data-table kit, date pickers, uploader...)
  src/layout/                      AppShell, PageHeader, PageContainer, AuthShell, SettingsFrame
  src/patterns/                    MetricCard, FilterBar, skeleton compositions
  src/theme/                       ThemeProvider, ThemeToggle, bootScript.ts, appearance injector
  src/server.ts                    server-safe entry (no hooks, no "use client"): types, tokens helpers, theme boot string
  src/index.ts                     client entry (everything)
```

Rules that make this work in both frameworks:

- **Tailwind 4 only, tokens via CSS variables**, no Tailwind config file, no per-app token copies. Each app's CSS is `@import "tailwindcss"; @import "@bs/ui/styles.css"; @source "../../../packages/ui/src";` so utilities used inside `@bs/ui` are generated in the app build.
- **Next consumes `@bs/ui` as source** (`transpilePackages: ["@bs/ui"]` in `apps/web/next.config.ts`). Every component file that uses state, effects, Base UI or Radix has `"use client"` at the top. Pure presentational pieces (Card, Badge, Skeleton, Separator, Alert, Label, layout wrappers) stay server components. Import from `@bs/ui` in server components only for those; interactive pieces are imported normally from client components.
- **Links:** the existing `UiLinkProvider` in `lib/link.tsx` stays the router seam (TanStack Router in Vite, `next/link` in Next). Never import a router inside `@bs/ui` components.
- **No app-local `components/ui/*`** after cutover. Enforce with an ESLint `no-restricted-paths` rule (section 12).
- **shadcn CLI:** keep one `components.json` at `packages/ui/components.json` (style `base-mira`, `rsc: true`, aliases pointing into `packages/ui/src`). Run `pnpm dlx shadcn@latest add <component>` from `packages/ui`. Delete the per-app `components.json` once Store Admin is migrated.
- **Dependency policy:** pin exact versions like the rest of the repo, prefer what the monorepo already has (Base UI `@base-ui/react` 1.8.0, `radix-ui` 1.6.7, `react-day-picker` 10.0.2, `sonner` 2.0.8, `lucide-react` 1.48.0, `tw-animate-css`, `class-variance-authority`, `tailwind-merge`). New ones needed: `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, `cmdk`, `vaul`, `recharts` (via shadcn Chart), `react-dropzone` or native drag-drop (prefer native, see section 8). State the reason for each in the change record.

---

## 3. Design tokens (the contract)

### 3.1 Typography and spacing

| Role | Dashboards (Super Admin, Store Admin) | Customer account, auth, marketing |
|---|---|---|
| Page title | 20px / 600 / 1.3 | 28px / 600 / 1.25 (marketing keeps its own display scale) |
| Section title | 14px / 600 | 18px / 600 |
| Body, forms | 13px / 400 / 1.5 | 15px / 400 / 1.5 |
| Dense table, meta | 12px / 400 / 1.4 | 13px |
| Micro label (uppercase, +0.5px) | 11px / 600 | 11px / 600 |
| Button label | 14px / 500 / 1.3 (`md`), 13px / 500 (`sm`) | 14px / 500 |
| Code, IDs | Geist Mono 12-13px | Geist Mono 13px |

Never below 11px. Money, quantities, dates and IDs use `font-variant-numeric: tabular-nums`. Spacing is a 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96). Card padding 16px dashboards, 24px customer pages. Page max width 80rem.

Control heights: dashboards `sm` 32px (toolbars, tables), `md` 40px (forms, primary actions, Mintlify size); under 768px every tap target is at least 40px (44px on auth and account). Table row 36px (32px in compact density).

### 3.2 Colour (semantic tokens, OKLCH, light and dark)

Brand accent `--brand`: `#00d4a4` (about `oklch(0.77 0.15 172)`). Because mint fails AA as text on white, the accent is used as **fill, focus ring, active indicator**; text-on-white accent uses the derived darker `--primary` ink. Derive the scale from the hue (`--accent-hue: 172`) the same way the current file derives from `--primary-hue`, so Super Admin can change one value.

Define these semantic tokens in `tokens.css` for light and dark (exact numbers are yours to tune, but **every pair below must pass WCAG AA, enforced by a test**, section 12):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#ffffff` | `#0a0a0a` | page and cards |
| `--canvas` | `#f7f7f7` | `#0a0a0a` with `--card` `#111111` | dashboard canvas behind cards |
| `--card`, `--popover` | `#ffffff` | `#111111` | surfaces |
| `--muted` | `#f7f7f7` | `#171717` | subtle fills, code-inline bg |
| `--border` | `#e5e5e5` | `#1f1f1f` | hairlines (Mintlify hairline / hairline-dark) |
| `--border-soft` | `#ededed` | `#171717` | table row dividers |
| `--input` | `#e5e5e5` | `#262626` | input border |
| `--foreground` | `#0a0a0a` | `#fafafa` | ink |
| `--foreground-2` (body) | `#1c1c1e` | `#e5e5e5` | body |
| `--muted-foreground` | `#5a5a5c` | `#a1a1a1` | steel, secondary text (AA on `--background`) |
| `--faint-foreground` | `#888888` | `#737373` | captions only (large text or decorative) |
| `--primary` (button fill) | `#0a0a0a` | `#fafafa` | primary button = black on light, white on dark (Mintlify `button-primary` / `button-on-dark`) |
| `--primary-foreground` | `#ffffff` | `#0a0a0a` | |
| `--brand` | `#00d4a4` | `#00d4a4` | accent fill |
| `--brand-deep` | `#00b48a` | `#2fe3bd` | pressed, accent text on dark |
| `--brand-ink` | `#047857`-ish AA-safe | `#5eead4`-ish | accent used as text/link on the surface |
| `--brand-soft` | `#e6faf5` | `#0c2b25` | success and selected backgrounds |
| `--ring` | `--brand` | `--brand` | focus ring, 2px, 2px offset |
| `--destructive` / `-soft` | `#d45656` / `#fdecec` | `#f07171` / `#2a1414` | errors |
| `--warning` / `-soft` | `#c37d0d` / `#fdf3e1` | `#e0a23c` / `#2a2110` | |
| `--success` / `-soft` | `#1ba673` / `#e6f6ee` | `#34d399` / `#0f2a20` | |
| `--info` / `-soft` | `#3772cf` / `#e8effb` | `#6b9bea` / `#101c33` | |
| `--sidebar-*` | follow `--card` / `--muted` / `--border` | | |
| `--chart-1..5` | brand, info, warning, destructive, neutral | | |

The primary button is **neutral ink** (black / white), with the mint reserved for focus ring, active nav indicator, success, selected states, links, charts and the single "accent" button variant (`variant="brand"`, mint fill with `#0a0a0a` text). This follows Mintlify's rule: mint appears sparingly. Keep the existing token names as **aliases for one release** (`--surface-100`..`--surface-400`, `--border-default`, `--primary-bright`, `--dash-canvas` and others) so nothing breaks while migrating; they are deleted in Part 8.

### 3.3 Shape, elevation, motion

- Radius: `--radius` = 8px base; controls and **buttons 6px (`--radius-button`)**, inputs 8px, cards 12px, large panels 16px, avatars and status dots only use full. No pill shapes on buttons, tabs, badges or toggles' track (switch track keeps its natural shape; badges use 6px).
- Elevation: flat by default (hairline border). `--shadow-1` hover tile, `--shadow-2` popovers and menus (`0 4px 12px rgb(0 0 0 / .08)`), `--shadow-3` dialogs. No glow except the focus ring and the optional brand-tinted shadow on a featured card.
- Motion tokens: `--dur-fast: 120ms`, `--dur-base: 180ms`, `--dur-slow: 240ms`, `--ease-out: cubic-bezier(.2,.8,.2,1)`. Animate only `opacity`, `transform` and, on small elements, `background-color`, `border-color`, `box-shadow`. Under `prefers-reduced-motion: reduce` all durations become 1ms and transforms are removed.

### 3.4 Fonts

- Vite apps: import `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` once from `@bs/ui/src/styles/base.css`. Self-hosted, no Google request. Preload the Geist `woff2` in both `index.html`. `font-display: swap` plus a size-adjusted local fallback (`Geist Fallback`: `Arial` with `size-adjust`, `ascent-override`, `descent-override`) to avoid layout shift.
- Next: `next/font/local` or `next/font/google` (build-time self-hosting) exposing the **same** CSS variables `--font-sans` and `--font-mono`. Generalise the existing `components/marketing/beam/fonts.ts` into `apps/web/src/lib/fonts.ts` and use it in the root layout.
- Tailwind `@theme inline { --font-sans: var(--font-sans); --font-mono: var(--font-mono); }`. Remove every other font stack (`apps/superadmin/index.html` inline stack, "Inter Variable", `ui-sans-serif` literals).

---

## 4. Theme: light, dark and system

Build once in `packages/ui/src/theme/` and use everywhere.

1. **`bootScript.ts`** exports a string (and a `<script>` constant) that runs before paint: reads `localStorage["bs-theme"]` (`light | dark | system`, default `system`), resolves `system` through `matchMedia("(prefers-color-scheme: dark)")`, sets `document.documentElement.dataset.theme`, `style.colorScheme` and `<meta name="theme-color">`. Wrapped in try/catch. Both Vite `index.html` files inline it (replace the existing ad-hoc scripts); Next puts it in the root layout `<head>` with `suppressHydrationWarning` on `<html>`.
2. **`ThemeProvider`** (client): holds the user preference, exposes `{ preference, resolved, setPreference }`, listens to the `matchMedia` change event (live follow when on `system`) and the `storage` event (sync across tabs). No `next-themes` dependency; `sonner` and charts receive the resolved theme from this context.
3. **`ThemeToggle`**: a 3-segment control (Sun, Moon, Monitor icons with accessible labels "Light", "Dark", "System"), keyboard operable (`role="radiogroup"`), plus a compact `variant="menu"` for the user dropdown. Shown in: Super Admin header/user menu, Store Admin header/user menu, customer account menu, auth pages (small, top right).
4. Dark selector stays `:root[data-theme="dark"]` and Tailwind `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`. Components never branch on theme in JS; they only use semantic tokens.
5. **Acceptance:** reload in each mode shows no flash (verify with CPU throttling 6x), OS theme change updates a page set to System without reload, preference survives reload and syncs across two tabs.

---

## 5. Cross-cutting component standards (apply to every component you add or touch)

**State matrix.** Each interactive component implements: default, hover, `focus-visible` (ring), active/pressed (buttons: `scale(.98)`), loading, success (where meaningful), error (`aria-invalid` + message), disabled. Document the matrix in the kit page (Part 2).

**Loading and mutation feedback**
- Buttons accept `loading`: spinner replaces the leading icon, label stays, width is locked (no jump), `aria-busy="true"`, click disabled.
- Mutations: disable the trigger, show the button spinner, then a `sonner` toast for success or failure; on success the button briefly shows a check (600ms). Row-level pending state in tables (dimmed row + inline spinner), optimistic update only where reversible.
- Forms: validate on blur and on submit (not on every keystroke), keep input on error, focus the first invalid field, show errors with `aria-describedby`. Unsaved-changes guard on settings (existing `useUnsavedGuard`, restyled).
- Data fetching: TanStack Query with `placeholderData: keepPreviousData` on lists so a sort or filter never flashes back to skeleton; a thin top progress bar (`RouteProgress`, CSS transform animation) indicates background refetch.

**Animation (subtle, cheap)**: popovers/menus fade+4px translate (`--dur-fast`), dialogs fade + scale .98 to 1 (`--dur-slow`), sheets slide, accordion height uses the `grid-template-rows` 0fr to 1fr trick, tabs underline slides via `transform`, switch thumb translates, toasts slide in. Rows animate in **only on first load**, never on refetch or sort, no stagger on tables. No animation library. No `filter: blur` on large areas, no animating `width/height/top/left`.

**Accessibility**: AA contrast, 2px focus ring on everything focusable, labelled icon buttons, `aria-live="polite"` for toasts and async results, dialogs trap and restore focus, full keyboard operation (date picker grid, uploader, command palette, tables with row actions), `prefers-reduced-motion` and `prefers-contrast: more` (thicker borders) honoured.

**UX rules**: one primary action per view; destructive actions go through `AlertDialog` that names the object ("Delete tenant Acme?"); empty states say what happened and the next step; error messages say what failed and how to fix it; never block already visible content with a full-screen spinner; long operations show progress; hints go behind an (i) `InfoTip` popup (owner preference), never inline paragraphs in panels.

**Skeletons.** One `Skeleton` primitive (opacity pulse, 1.4s, `--muted` fill; shimmer only on hero-size blocks; static under reduced motion). Composed skeletons mirror the real layout with the **same dimensions** as the final element (CLS 0): `PageHeaderSkeleton`, `MetricCardsSkeleton`, `DataTableSkeleton({columns, rows, columnWidths})`, `FormSectionSkeleton`, `DetailPageSkeleton`, `AuthCardSkeleton`, `AccountPageSkeleton`. Delay showing a skeleton by 150ms (existing `ROUTE_PENDING_MS` logic stays), keep it visible at least 300ms (`ROUTE_PENDING_MIN_MS`) to avoid flicker. Boot shells in `index.html` are generated from `packages/ui/src/skeleton-shell.html`, which uses token variables so first paint already matches theme and font.

---

## 6. Build sequence

Each part ends with: gate green, change record, screenshots (light, dark, 375px and desktop) attached to the change record, and Claude's verification. Do not start a part until the previous part is verified. Parts 1 to 3 are the foundation and a Super Admin migration; they are deliberately first.

### Part 1. Foundation in `@bs/ui` (no visual migration yet)

**Goal:** tokens, fonts, theme, motion and the shared infrastructure exist and are wired into all three apps' CSS, without changing screens yet except font and theme.

1. Create `styles/tokens.css`, `base.css`, `motion.css`, `index.css` per section 3. Keep old token names as aliases pointing to the new ones. Export `./styles.css` and `./server` from `packages/ui/package.json`.
2. Add Geist fonts (3.4). Replace font stacks in `apps/admin/src/index.css`, `apps/superadmin/index.html`, `apps/web/src/app/globals.css`. In `apps/web`, generalise `fonts.ts`, set variables on `<html>`.
3. Implement `theme/` (section 4) and wire: `index.html` boot script in both Vite apps, root layout in web. Add `ThemeToggle` to the Super Admin and Store Admin headers (user menu) for now.
4. Move `shadcn` config to `packages/ui/components.json`, point aliases, add `transpilePackages` and `@source` lines in the three apps.
5. Add the dev-only kit page: `/__kit` in Super Admin (mounted only when `import.meta.env.DEV`) rendering every component in every state, light and dark. Extend it as components arrive.
6. Contrast test `packages/ui/test/contrast.test.ts`: parse resolved token values for light and dark and assert AA (4.5:1 text, 3:1 UI/large) for every foreground/background pair in the table in 3.2.

**Acceptance:** three apps build and render Geist; toggle works in both Vite apps; no flash; contrast test green; `/__kit` shows the token swatches and type scale; existing screens still work (aliases).

### Part 2. Component kit (shared, latest shadcn)

**Goal:** the complete component set lives in `@bs/ui`, restyled to the tokens, in both frameworks.

1. **Move** `apps/admin/src/components/ui/*` into `packages/ui/src/components/ui/`, then run `pnpm dlx shadcn@latest diff` and re-sync each file to upstream (keep our token mapping, `base-mira` style). Mechanical commit first: codemod alias `@/components/ui/x` to `@bs/ui` with **no visual change**, then a second commit restyling. Keep the old `@bs/ui` components (`Button`, `Input`, `Select`, `Dialog`, `Sheet`, `Table`, `Form`, `Toast`) only until Part 3 finishes migrating Super Admin, then delete them (one component per concept, no duplicates).
2. Install/refresh from shadcn: `button, input, input-group, textarea, label, field, form, checkbox, radio-group, switch, slider, toggle, toggle-group, select, combobox, command, popover, dropdown-menu, context-menu, dialog, alert-dialog, sheet, drawer, tooltip, hover-card, tabs, accordion, collapsible, card, badge, alert, avatar, separator, scroll-area, skeleton, spinner, empty, progress, breadcrumb, pagination, sidebar, navigation-menu, table, calendar, chart, sonner, kbd, input-otp, resizable`.
3. **Button** (D5): variants `primary` (ink), `brand` (mint fill, ink text), `secondary` (outline, 1px `--border`), `ghost`, `link`, `destructive`. Sizes `sm` (32px, 13px), `md` (40px, 14px, padding 10px 20px, Mintlify), `icon` (32px square, 40px on touch). Radius `--radius-button` (6px). No `rounded-full` on any button. States per 5. `loading` prop.
4. **Inputs:** 40px `md`, 32px `sm`, 8px radius, 1px `--input` border, focus = `--brand` border plus 2px ring (Mintlify focus uses the mint). Error and success states with icon and message.
5. **Date and time:** `DatePicker`, `DateRangePicker` (replaces `components/date-range-picker.tsx`; presets: Today, Yesterday, Last 7, Last 30, This month, Last month, Custom), `DateTimePicker`, `TimePicker`. Built on `Calendar` + `Popover`, react-day-picker v10, keyboard entry in the input, `en-IN` locale, week starts Monday, **dates handled in the store timezone** (IST for default), min/max/disabled-day props, clear button, controlled and uncontrolled, form-integrated through `Field`.
6. **ImageUploader** (spec in section 8) and `FileDropzone`.
7. **Select family:** `Select` (simple lists, replaces `simple-select.tsx` with the same props where possible so call sites are mechanical), `Combobox` (search, async options, create-new), `MultiSelect` (chips, max count). No native `<select>` anywhere.
8. **Command palette** (`CommandMenu`, Ctrl/Cmd+K) with registered actions and route search, used by Super Admin and Store Admin shells.
9. **Table kit:** move `apps/admin/src/components/data-table/*` into `packages/ui/src/components/data-table/` (keep behaviour, hooks and tests: selection, sortable headers, sticky header, row click, row actions, mobile cards, URL state, bulk runner, pagination 25/50/100). The router-specific parts (`use-table-state` reads search params) take a small adapter prop/hook (`useSearchState`) so the Vite apps pass TanStack Router and Next passes `useSearchParams`. Replace the old `@bs/ui` `DataTable`.
10. **Feedback and overlays:** `AlertDialog`-based `ConfirmDialog` (replaces `components/confirm-dialog.tsx`; props: title, description, confirmLabel, destructive, onConfirm async with loading), `Sonner` toaster themed from context, `RouteProgress` bar, `InfoTip` (move from `packages/block-editor/src/LayoutField.tsx` into `@bs/ui`, and have block-editor import it).
11. **Layout:** `AppShell` (collapsible sidebar, Ctrl/Cmd+B, cookie-remembered, 12rem to icon rail, mobile sheet), `PageHeader` (title left, actions right, optional `InfoTip`), `PageContainer`, `SettingsFrame`/`SettingsSection`, `AuthShell` (section 10), `SectionCard`. Sidebar nav item: transparent, 13px, hover `--muted`; active = `--muted` fill + 2px `--brand` indicator on the left + `--foreground` text (Mintlify `sidebar-nav-item-active`); section headers 11px uppercase `--muted-foreground`.
12. **Status and money parts:** move `order-parts.tsx` generic pieces (`StatusBadge` with semantic tones, `Money` with tabular nums, `RelativeTime` with title tooltip) into `@bs/ui`; business-specific badges stay in the app.
13. **Charts:** shadcn `Chart` wrapper reading `--chart-*`, with `ChartCard` (title, InfoTip, skeleton, empty state).
14. Each component gets a unit test (render, state matrix via props, keyboard, ARIA) in `packages/ui/test`, using the existing Vitest setup, and an entry in `/__kit`.

**Acceptance:** `apps/admin` builds with **no** `components/ui` folder and no imports from the old `@bs/ui` controls; Next can import Button, Input, Field, Card, Alert, Skeleton, Dialog, Calendar in a client component and Card, Skeleton, Alert in a server component (prove with a throwaway page, then delete it); `/__kit` shows every state in light and dark; unit tests green; admin orders list still passes its existing tests.

### Part 3. Super Admin migration (first app)

**Goal:** every Super Admin screen on the kit and tokens. `apps/superadmin/src/pages/*` (21 files): Layout, Overview, TenantsList, TenantCreate, TenantDetail, Domains, Plans, Quotas, Features, Signups, Staff, AuditLog, EmailSettings, Templates, TemplateEditor, Support, System, Login, ForgotPassword, ResetPassword, AcceptInvitation.

1. **Shell:** `AppShell` with grouped nav (existing groups), header with command palette trigger, theme toggle (user menu) and user menu (change password dialog moved to `Dialog` + `Field`). Remove `index.html` inline CSS variables (`--s-*`); the boot shell now uses tokens.
2. **Lists** (Tenants, Domains, Plans, Quotas, Features, Signups, Staff, AuditLog, Templates, Support): rebuild each on the shared `DataTable` kit with server-side search/filter/sort/paging where the platform API supports it (otherwise client-side with a TODO recorded in the change record, not silently), `TableToolbar`, filter chips, bulk bar only where bulk actions exist. Status pills via `StatusBadge`. Row actions in a `DropdownMenu`. Mobile: cards.
3. **Detail and create pages** (TenantDetail, TenantCreate, TemplateEditor): full pages, `PageHeader` + `SectionCard`s, `Field` forms, `ConfirmDialog` for destructive actions, `Tabs` where the page has many sections (scroll tabs on mobile).
4. **Overview:** `MetricCard`s with skeletons, `ChartCard`s (signups, orders GMV, active stores) from existing data, quick-links. No new API unless a number is missing (then record it).
5. **Auth screens:** Login, Forgot, Reset, AcceptInvitation on `AuthShell` (section 10): Super Admin variant shows platform logo, no store branding.
6. **Skeletons:** every route has `pendingComponent` built from the composed skeletons; remove ad-hoc skeletons.
7. Delete the old `@bs/ui` controls once nothing imports them; delete `apps/superadmin` local one-offs.
8. Update tests: `apps/superadmin` unit tests; do not weaken assertions, adjust selectors only.

**Acceptance:** `rg "--s-" apps/superadmin` empty; no `style={{` colours, no hex literals, no native `select`/`window.confirm`; every page works in light, dark and system and at 375px; keyboard-only walkthrough of Tenants list, Tenant create, Plans edit, Staff invite; CLS 0 on lists and detail; platform audit-coverage test still green.

### Part 4. Appearance manager (Super Admin, manages all dashboards)

This part is **security sensitive and owned by Claude** unless the owner assigns it to you; if you build it, follow every sub-point and Claude will review line by line. Write **ADR-021 "Platform-managed dashboard appearance"** first (scope: dashboards and customer account/auth only, storefront excluded; token allow-list; why a platform-wide cache tag is an exception to rule 5 because it is not tenant data) and **ADR-022 "`@bs/ui` is the single component package"** (supersedes the admin-ui-standards line forbidding `@bs/ui` controls).

**What Super Admin can manage** (screen `Platform > Appearance`, with a live preview pane showing a sample dashboard: nav, table, form, dialog, toast, date picker, charts):
- **Scope selector:** All dashboards (default) or per-app override: Super Admin, Store Admin, Customer account and auth.
- **Colours:** brand accent (picker + hex + presets, default Mintlify mint), neutral tone (cool, warm, pure), status colours. Light and dark editable separately. Everything else is derived from the accent hue/chroma in OKLCH, so one pick yields a coherent set.
- **Fonts:** UI font and mono font from the allow-list only (D6); base size 12 / 13 / 14; density `compact | default | comfortable` (drives control height, row height, padding).
- **Shape:** radius preset `sharp 4 | default 6/8 | soft 10/12` (buttons stay rectangular; never pill).
- **Default theme mode** for new users (`light | dark | system`); a user's own toggle always wins.
- **Guardrails:** live AA contrast check on every pair; **Publish is blocked if body text, button label or focus ring fails AA**. Draft, Preview (opens the target app with `?appearance-preview=<draftId>`, honoured only for a signed-in platform user), Publish, Restore previous (version history, one click). "Reset to defaults".

**Implementation (in this order, per AGENTS.md contract-first rule):**
1. **Migration** (append-only, `app_owner`): table `platform_appearance` (platform-managed, **no RLS**, like `domains`): `id uuidv7`, `scope text` (`all|superadmin|admin|account`), `status text` (`draft|published`), `tokens jsonb`, `version int`, `created_by`, `created_at`, `published_at`. Seed a published `all` row equal to shipped defaults. Grants: read for `app_rw` (so web/admin APIs can serve it), write only `app_platform`. Do not widen other grants.
2. **Token schema** in `packages/contracts` (Zod): strict object, accent as `{hue, chroma}` or validated hex, enum for neutrals, enum font keys from the allow-list, enum density/radius/size. **No free-form strings except validated colours.** Reject unknown keys.
3. **Contracts:** `appearance.get(scope)`, `appearance.saveDraft`, `appearance.publish`, `appearance.restore`, `appearance.history` in `packages/contracts/src/platform.ts`; public read `GET /api/appearance/:app` in the storefront/store API contract (resolved tokens only, no ids).
4. **Domain service** `packages/domain/src/platform/appearance.ts`: `assertRoleAtLeast` on every mutation, AA contrast validation server-side (same function as the client uses, shared from `@bs/ui/server`), `resolveAppearance(app)` merges `all` with the app override, **CSS emitter** produces a `:root{...}` and `:root[data-theme="dark"]{...}` string from the allow-listed token keys only, escaping every value. Writes `platform_audit_logs` row on save, publish, restore (rule 6; extend `apps/platform/test/audit-coverage.int.test.ts`).
5. **Platform handler** in `apps/platform/src/app.ts` (thin), **no raw SQL outside domain** (rule 2).
6. **Delivery:** `GET /api/appearance/:app` returns `{version, css, fontKey, defaultTheme}` with `ETag` and `Cache-Control: public, max-age=60, stale-while-revalidate=600`. Admin and Super Admin fetch it during boot and inject `<style id="bs-appearance">` after the base stylesheet (and cache the last good copy in `localStorage` so the next paint is correct before the fetch returns); Next renders it server-side in the root layout (no flash), cached with a platform-wide tag `platform-appearance` invalidated on publish via `cache-invalidation.ts`. **Failure path:** any fetch or validation failure falls back to shipped defaults (ADR-011 style fail-safe).
7. **Font loading:** all allow-list fonts are self-hosted variable files bundled with `@bs/ui` (lazy `@font-face`, only the selected family is requested). No external font URLs, ever.
8. **UI:** Appearance screen built only from kit components, with `InfoTip` hints, unsaved guard, contrast badges next to each pair, preview iframe or in-page scoped preview using the same CSS emitter.
9. **Tests:** real-database integration test (`*.int.test.ts`, `startTestDb`) for save, publish, restore, role denial, audit rows; unit tests: emitter rejects unknown keys and unsafe values, AA guard blocks, empty table equals shipped look; Playwright smoke: publish changes accent in Super Admin and Store Admin within the cache TTL without a deploy.

**Acceptance:** publishing a new accent/font/density changes Super Admin, Store Admin and customer pages without a deploy; failing contrast cannot be published; every mutation has an audit row; ADRs merged; `ARCHITECTURE.md` updated (new table, endpoint, cache tag).

### Part 5. Store Admin migration (second app)

**Goal:** every Store Admin screen on the kit and tokens, deleting all duplicates.

1. **Cutover of imports:** all `@/components/ui/*`, `simple-select`, `confirm-dialog`, `date-range-picker`, `scroll-tabs` (move into `@bs/ui` as `ScrollTabs`), `section-card`, `field`, `data-table/*` imports now point to `@bs/ui`. Then **delete** `apps/admin/src/components/ui`, the duplicated components and `apps/admin/components.json`. Admin's `index.css` shrinks to the three imports.
2. **Shell:** `AppShell` with store switcher, command palette (orders, products, customers search and navigation), theme toggle in the user menu, notification area placeholder kept as-is.
3. **Screens, in this order** (reference first, each verified before moving on): Orders list (reference; keep behaviour/tests), Orders detail and create, Products and Inventory, Customers and Segments, Discounts, Categories and Collections, Reviews/Marketing, Settings workspace (all sections), Online Store (Themes, Pages, Navigation, page editor and theme editor chrome), Dashboard home, Support, Platform (the `routes/platform` section if still present).
4. **Replace controls:** every date range/date field uses `DateRangePicker`/`DatePicker`/`DateTimePicker` (orders filters, discounts start/end, segments, analytics); every image or file field uses `ImageUploader` (product media, category/collection images, store logo and favicon, theme assets, return photos, blog covers, page blocks that take images); every select uses `Select`/`Combobox`.
5. **Page editor and theme editor:** adopt the kit for chrome (panels, tabs, inputs, popovers). The block-editor canvas content is storefront output and is **not** restyled. Hints use `InfoTip`.
6. **Unify state feedback:** all mutations follow section 5 (loading button, toast, optimistic where safe); remove ad-hoc spinners and custom toasts.
7. **Skeletons and `pendingComponent`:** replace per-route skeleton code with composed skeletons; keep rule 11.
8. Rewrite `docs/admin-ui-standards.md` to the new kit (it currently says not to use `@bs/ui` controls; reverse and update the table, type scale 13/12, button sizes, no pills).
9. Update tests: render with in-memory router (`renderRouted`), query keys unchanged; do not weaken assertions.

**Acceptance:** `rg "components/ui" apps/admin/src` empty; no `<select`, `window.confirm`, `rounded-full` on buttons, raw hex or non-token colours (lint rule); every list uses the shared `DataTable`; every screen verified in light, dark, system, 375px and desktop; admin tests green; ARCHITECTURE and standards docs updated.

### Part 6. Customer account and auth (last)

See section 10 for the shared auth shell. Scope: `apps/web` `/account/*` (login, register, forgot/reset password, verify-email, profile, addresses, orders), `/signup`, `/unsubscribe/[token]`, `/address/[token]`, `/o/[token]`, `/orders/[token]`, `/cod/[token]`, plus Store Admin's own login, forgot, reset and accept-invite (moved onto `AuthShell` in Part 5 if not already).

1. **Store accent (D3):** the account layout reads the store's accent (existing `theme-tokens.ts` / `ThemeChrome`) and sets `--brand`, `--brand-deep`, `--brand-ink`, `--ring` for the account subtree only, **after validating contrast** (if the store accent fails AA for text or focus, derive the nearest accessible `--brand-ink` and keep the original as fill). Platform tokens stay for neutrals, surfaces, type, radius and states. Store branding (logo, name) in `AuthShell` header.
2. Rebuild forms (`LoginForm`, `ProfileForm`, `AddressBook`, `AddressCorrectionForm`, `CustomerChangePassword`, `LogoutButton`, `UnsubscribeButton`) on `Field`, `Input`, `Button`, `Alert`; server actions/route behaviour unchanged.
3. Replace `AccountSkeleton` and every account/auth `loading.tsx` with the composed skeletons (rule 11).
4. Orders list in the account: card list on mobile, simple table on desktop, `StatusBadge`, `Money`, `RelativeTime`; order detail keeps public token behaviour (do not change token or privacy logic).
5. Theme toggle on account pages (menu) and on auth pages (corner); respect the platform default theme from Appearance (Part 4) and the user's saved choice.
6. Keep `PreviewShell`/storefront routes untouched.

**Acceptance:** account and auth pages pass a keyboard-only run; Lighthouse accessibility 95+ and CLS 0 on login, register, account home, orders; 375px and desktop in light and dark; store accent applies and a low-contrast accent is corrected; existing web and e2e tests green; no storefront page visually changed (diff screenshots of home, product, cart, checkout before and after).

### Part 7. Hardening and clean-up

1. Remove the legacy token aliases and old `@bs/ui` components, the old `bs-skeleton` and `store-skeleton` classes, `skeleton-shell.html` fallbacks that duplicated styles, every `--s-*` variable.
2. Add the guards in section 12 (lint rules, docs check) and confirm they fail on a deliberate violation (then revert).
3. Performance pass: Chrome performance trace on Orders (25 and 100 rows), Tenants list, account orders; no long tasks over 50ms from animation; bundle size of admin and superadmin within +5% of before (fonts excluded); fonts preloaded once.
4. Accessibility pass (axe on each major screen) and a final screenshot matrix.
5. Docs: `docs/ARCHITECTURE.md` (packages, tokens, appearance table, endpoint, cache tag, theme flow; bump "Last verified" commit), `docs/admin-ui-standards.md`, `DEPLOYMENT.md` only if env/ports changed (they should not), `progress.md`, final change record. Add a short `docs/design-system.md` describing tokens, components and how to add one.

**Acceptance:** `pnpm typecheck && pnpm lint && pnpm build && pnpm docs:check` green, tests for touched packages green, no dead aliases (`rg` evidence in the change record).

---

## 7. Shared component specifications (reference for Part 2)

| Component | Behaviour spec |
|---|---|
| **Button** | See D5 and Part 2.3. Loading, icon-left/right, `asChild`/`render` for links via `UiLink`. |
| **Badge** | 6px radius, 12px/500, tones `neutral, brand, info, success, warning, danger`; optional dot. |
| **Tabs** | Underline style (Mintlify `segmented-tab`): 13px/500, `--muted-foreground` inactive, `--foreground` + 2px bottom border active, indicator moves via `transform`. Rectangular "segmented" variant (6px) for toggles like Monthly/Yearly and the theme toggle. |
| **Card** | `--card`, 1px `--border`, 12px radius, 16px padding, flat. `CardFeature` variant on `--muted`. |
| **Table** | Header 11px uppercase muted, sticky, 36px rows, hairline `--border-soft`, row hover `--muted`, selected `--brand-soft`. Numeric columns right-aligned tabular. |
| **Dialog / Sheet / Drawer** | Dialog desktop, `Drawer` (vaul) on mobile for the same content via a `ResponsiveDialog` wrapper; focus trap and restore; Esc closes unless dirty form. |
| **Toast** | `sonner`, bottom-right (top-center on mobile), 4s success, 6s error with action, deduped. |
| **Command** | Ctrl/Cmd+K, grouped results, recent items, keyboard hints with `Kbd`. |
| **Empty** | Icon, title, one sentence, primary action. Different copy for "no data yet" vs "no results for filters" (with Clear filters). |

---

## 8. ImageUploader specification (local now, R2 later)

**Principle:** the UI never knows where bytes go. It uses an `UploadAdapter` interface; the server decides local disk or R2.

```ts
interface UploadAdapter {
  upload(file: File, opts: { folder: string; signal: AbortSignal; onProgress(p: number): void }):
    Promise<{ id: string; url: string; width?: number; height?: number; mime: string; bytes: number }>;
  remove?(id: string): Promise<void>;
}
```

- **Today (decided, owner 2026-10-05): use the route the app already uses.** Uploads go through the existing flow: `POST /admin/media/request-upload` (contract in `packages/contracts/src/admin.ts`, handler in `apps/web/src/server/api.ts`) calls `requestMediaUpload` in `packages/domain/src/media-services.ts`, the client uploads to the returned `uploadUrl`, then the existing `createMediaRecord` / `attachProductMedia` calls register it. The adapter wraps exactly this sequence. **Do not add a new upload endpoint, a second storage path or a parallel media table.** Reuse the validators in `media/storage.ts` (`ALLOWED_IMAGE_MIMES`, `MAX_MEDIA_BYTES` 10 MB) by exposing the constants through `@bs/contracts`, not by copying them. Only if the local `uploadUrl` cannot report progress or accept a plain PUT, make the smallest server change inside the existing route and say so in the change record.
- **Later (R2):** the same adapter's implementation switches to a presigned PUT descriptor (`PresignedUploadDescriptor` already exists in `storage.ts`) with `XMLHttpRequest`/`fetch` upload progress. **No R2 credentials or provider keys are added in this work** (owner deferred); only the adapter seam and a documented env switch (`MEDIA_STORAGE=local|r2`, default `local`) are in scope, and only if the switch does not already exist.
- **Features:** drag and drop, click to browse, paste from clipboard, multiple files (gallery) with drag-to-reorder (keyboard reorder too), per-file progress, cancel, retry, remove with `ConfirmDialog`, client-side pre-checks (type, size, min dimensions, aspect ratio hint) with the same limits as the server, optional crop to aspect ratio (`aspect` prop; use canvas, no heavy dependency), alt-text field per image (required toggle), blur-up preview via `URL.createObjectURL` revoked on cleanup, `accept` and `maxFiles` props, error states per file (too large, unsupported, network), `aria-live` progress announcements, full keyboard operation, `capture` hint on mobile.
- **Security:** server revalidates MIME by magic bytes, strips EXIF location data, rejects SVG with scripts (or sanitises; keep current behaviour if already handled), randomises storage keys, scopes keys by tenant (`storageKey` per tenant; hard rule 1/5 spirit), never trusts client dimensions. Uploads write an audit row where the surrounding mutation already does (store settings, content).
- **Tests:** unit (validation, reorder, progress, cancel), real-database integration for the server path (tenant isolation of keys, size/type rejection), Playwright smoke upload on product media.

---

## 9. Date picker specification

Single implementation, many presentations: `DatePicker` (single), `DateRangePicker`, `DateTimePicker`, `MonthPicker`. Props: `value`, `onChange`, `min`, `max`, `disabledDays`, `presets`, `clearable`, `timeZone` (default store tz, Asia/Kolkata), `locale` (`en-IN`), `numberOfMonths` (2 on desktop for ranges, 1 on mobile), `placeholder`. Input accepts typed text (`DD MMM YYYY`, `DD/MM/YYYY`) and shows an inline error for invalid text; calendar opens in a `Popover` on desktop and a `Drawer` on mobile; arrow keys, PageUp/PageDown, Home/End, Enter and Esc per the ARIA grid pattern; today ring, selected = `--primary` fill, range middle = `--brand-soft`; never emit a Date without applying the timezone rule, and always send ISO strings to the API (consistent with existing contracts).

---

## 10. Auth screens (shared `AuthShell`)

One layout used by Super Admin, Store Admin and customer auth. Props: `brand` (logo + name), `title`, `description`, `footer`, `variant: "platform" | "store"`, optional `aside` (desktop split panel with a neutral gradient from `hero-sky`/`hero-dark` tokens for platform pages, store hero/logo for customers). Centered card (max 400px, 12px radius, hairline), 40px controls (44px on touch), rectangular buttons, theme toggle top right.
Forms: autocomplete attributes (`username`, `current-password`, `new-password`, `one-time-code`), show/hide password, inline validation on blur and submit, caps-lock hint, clear errors with no account enumeration (keep current server messages), rate-limit and lockout messages from the API shown verbatim, success states ("Check your email") with a resend control and cooldown, `InputOTP` for verify-email codes if the flow uses codes. Keyboard: Enter submits, focus first invalid field. Never autofocus on mobile.

---

## 11. Customer accent handling (D3 detail)

- Source: the store's configured accent (already exposed through `theme-tokens.ts`). Set on a wrapper `[data-store-accent]` in the account layout, mapping to `--brand`, `--brand-deep`, `--brand-ink`, `--brand-soft`, `--ring`.
- Derivation util in `@bs/ui/server` (`deriveAccent(hex) -> {fill, deep, ink, soft, ring, onFill}`) that picks `onFill` (black/white) by contrast, ensures `ink` is at least 4.5:1 on the surface by darkening in OKLCH lightness, and returns `null` (use platform mint) if the colour is invalid. Unit-test it with edge colours (very light yellow, pure black, saturated red).
- The same util powers the Appearance screen's contrast checks (one implementation).

---

## 12. Guards and tests to add

- **Lint:** `no-restricted-paths`/`no-restricted-imports`: no `components/ui` folder inside `apps/*`; no imports of `@radix-ui/*`, `@base-ui/react`, `sonner`, `react-day-picker`, `cmdk`, `vaul` from apps (only from `@bs/ui`); custom rule or regex check forbidding `rounded-full` on `Button`, `<select`, `window.confirm`, hex colour literals and `style={{...color...}}` in `apps/*/src` (allow-list the Appearance preview and the boot shell generator).
- **Docs check:** `scripts/check-docs.mjs` must pass with the new docs; add a check that every component exported from `@bs/ui` appears in `/__kit`.
- **Unit (Vitest, `packages/ui/test`):** contrast test (3.2), each component's state matrix, theme provider (system listener, storage sync), `deriveAccent`, CSS emitter.
- **Real DB:** appearance (Part 4), media upload tenant isolation (section 8).
- **E2E (Playwright, local only):** theme toggle persists and follows system with no flash in all three apps; Super Admin publish changes Store Admin look; image upload; date range filter on orders; customer login with store accent.
- **Manual walkthrough** recorded in the change record: each migrated screen at 375px and desktop, light and dark, keyboard-only for the main flows.

---

## 13. Definition of done (copy into every change record)

- [ ] Follows sections 1 to 5 and the part's spec; gate green (`typecheck`, `lint`, `build`, `docs:check`, tests for touched packages), counts pasted.
- [ ] Light, dark, system, 375px and desktop checked by actually running the app (what was not run is stated).
- [ ] No duplicate component, no app-local `components/ui`, no raw colours or fonts, no pill buttons.
- [ ] Skeletons match final layout (CLS 0), `pendingComponent`/`loading.tsx` present (rule 11).
- [ ] Real-DB tests for anything touching appearance, media, auth or permissions.
- [ ] `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md`, ADRs updated as listed; change record and `progress.md` updated; In-flight line removed on merge.
- [ ] No secrets, no generated files, no unrelated edits; staged by explicit path.
- [ ] Honest status: verified live vs only read vs not done.

## 14. Resolved open items (best-practice defaults; proceed, do not wait)

1. **Media route:** use the existing `/admin/media/request-upload` flow (section 8). No new endpoint. R2 later changes only what `requestMediaUpload` returns; the UI does not change.
2. **Super Admin lists:** use server-side search/sort/paging where the platform API already supports it. Where it does not, ship client-side filtering over the loaded rows now (acceptable at current tenant volumes), keep the same toolbar and URL-state API so it can switch to server-side without UI changes, and list each such screen in the change record. Do not add platform API endpoints just for list polish.
3. **`apps/admin/src/routes/platform`:** it is a placeholder stub (an empty "Tenants arrive in M1" overview). Migrate it to the kit like any other route; do not delete it, do not build features in it.
4. **Store accent source:** read the store's primary colour from the existing storefront theme tokens (`apps/web/src/components/storefront/theme-tokens.ts` / `ThemeChrome`, the `--store-primary` / `--bs-primary` values). If a store has none, fall back to platform mint. Run it through `deriveAccent` (section 11).

If you hit a genuinely new unknown, choose the safest option consistent with `AGENTS.md`, proceed, and record it under "Open questions" in the change record.
