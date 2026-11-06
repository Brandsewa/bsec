# Platform Branding plan

Status: phases 1 and 2 merged (#235, 2026-11-05); phase 3 built on `feat/platform-branding-phase3` (2026-11-06, Claude). Not built: invoices/PDFs (no platform-brand PDF exists to wire), Super Admin sign-in pages.

A new **Branding** item in the Super Admin sidebar. It is the single source of truth for the BCom platform's own identity (logos, favicon, colours, buttons). Every platform touch point reads from it, so changing it once updates the marketing website, both dashboards, auth pages and platform emails.

This is the platform's brand, not a store's. Store branding (storefront theme, `store_email_branding`, `/settings/branding` in the store admin) is unchanged.

## 1. What the owner asked for

| Group | Fields |
|---|---|
| Logo | Dark variant: Logo, Icon. Light variant: Logo, Icon. Favicon |
| Colour | Primary, Secondary |
| Button | Dark: background + text colour. Light: background + text colour |

"Dark" and "Light" mean the **surface the asset sits on**: the *dark* logo is the one used on dark backgrounds (usually light-coloured artwork) or the dark-coloured one for light backgrounds. **Decision needed, see section 9.**

## 2. What already exists (reuse, do not duplicate)

- `platform_settings` (single row `id = 'default'`, migration 0073): operational toggles, `app_platform` writes, `app_rw` reads. Wrong place for brand data (security toggle table), so branding gets its own table.
- `platform_email_branding` (`tokens` jsonb) + `packages/domain/src/system/email-branding.ts`: validated email tokens with WCAG contrast guards and `readableOn()`. Reuse the validators (`normaliseHex`, `contrastRatio`) by moving them to a shared pure module.
- `MediaPickerDialog` from `@bs/content-admin` already used in the Super Admin page editor: reuse for uploading logos.
- Super Admin `Layout.tsx` hard-codes `Database` icon + "Super Admin" as the brand; `Login.tsx` etc. use `AuthShell`; `apps/*/index.html` titles are static, no favicon.

## 3. Principles (best practice)

1. **Tokens, not pixels.** Store a small, closed set of design tokens; derive everything else (hover, focus ring, tints, dark-mode pairs) in code. Matches ADR-010: validated data with enumerated fields, never custom CSS/HTML/SVG.
2. **One source, many consumers.** One `getPlatformBrand()` read model, cached with a tenant-independent tag, consumed by web, dashboards and the email renderer. No consumer keeps its own copy.
3. **Safe by construction.** Colours are hex only. Every foreground/background pair is checked for WCAG AA (4.5:1 text, 3:1 UI) at save time; a failing pair is rejected with a clear message in the editor, and `readableOn()` is the render-time fallback so a bad row can never produce unreadable UI.
4. **Safe assets.** Logos: PNG, SVG (sanitised, no scripts, rendered via `<img>` only, never inlined), WebP; size caps; max dimensions; stored in the platform public-media connection. Favicon: PNG/ICO/SVG, with generated sizes (16/32/180/192/512) so the browser tab, iOS and PWA all work.
5. **Always renderable.** Missing asset falls back to a built-in default (text wordmark + current icon). The platform never renders a broken image.
6. **Light and dark are explicit.** Each theme gets its own logo and icon and its own button colours; the UI picks by the active theme (`prefers-color-scheme` and the app's theme toggle). If only one variant is set, it is used for both.
7. **Auditable and reversible.** Every change writes `platform_audit_logs` (rule 6) and keeps the last N versions so an owner can restore.
8. **Fast.** Public brand read is a tiny JSON (no auth, long cache, tag-invalidated) so it does not touch the product page JS budget; the website receives it server-side and renders CSS variables inline in the first response (no flash of default colours).

## 4. Data model

New table `platform_branding` (single row `id = 'default'`; platform-level, no tenant column, no RLS, like `platform_settings`):

```
id text pk default 'default'
tokens jsonb not null default '{}'   -- validated PlatformBrandTokens (below)
version int not null default 1       -- bumps on every save; used in asset URLs for cache busting
updated_by uuid -> users, updated_at timestamptz
```

and `platform_branding_versions` (append-only history: `version`, `tokens`, `updated_by`, `created_at`, keep last 20).

Grants: `app_platform` all; `app_rw` select only (web and worker read it). Migration is expand-only, created empty (absence = built-in defaults), with a statement-breakpoint grant block copied from 0073. Not tenant-scoped, so no `tenantTable()` and no `forceRlsSql` (same exemption as `platform_settings`; state this in the migration comment).

`PlatformBrandTokens` (Zod, in `packages/contracts`, pure validators in `packages/domain`):

```
logo:    { dark: { full: Asset|null, icon: Asset|null }, light: { full: Asset|null, icon: Asset|null } }
favicon: Asset|null
color:   { primary: Hex, secondary: Hex }
button:  { dark: { background: Hex, text: Hex }, light: { background: Hex, text: Hex } }
Asset = { url: https URL, width: int, height: int, alt?: string }
```

Optional later (not in phase 1): `name`, `tagline`, `font`, `radius`, `socials`, `supportEmail`.

## 5. Derived outputs (computed, never stored)

From the tokens, one pure function `buildBrandCss(tokens)` produces CSS variables for `:root` and `.dark`:

`--brand-primary`, `--brand-primary-foreground` (via `readableOn`), `--brand-secondary`, `--brand-secondary-foreground`, `--brand-button-bg`, `--brand-button-fg`, hover/active/ring/tint variants, per theme. `@bs/ui` maps `--primary`/`--ring` and the default `Button` onto these variables, so every Super Admin and admin screen picks the brand up with no per-screen edits.

Also derived: `<link rel="icon">` set, `apple-touch-icon`, web manifest `theme_color`, email tokens defaults (see 6).

## 6. Touch points and how each consumes the brand

| Touch point | Reads | Change |
|---|---|---|
| Marketing website (`apps/web` marketing routes, header/footer) | public brand JSON server-side | header/footer logo by theme, favicon + `theme-color` in metadata, CSS vars inline in `<head>` |
| Super Admin | `GET /platform/branding` | sidebar `brand` slot (logo or icon when collapsed), favicon, vars, login/forgot/reset/accept pages |
| Store admin (`apps/admin`) | public brand JSON | sidebar brand, favicon, vars, auth pages (sign in, sign up, reset, invite). Store's own logo stays where the store identity is shown |
| Platform emails | `loadPlatformBranding` | email tokens **default from** brand (logo, primary → accent, button colours). `platform_email_branding` stays as an override so Notification Manager keeps working; a "Reset to brand" button clears overrides. Customer emails of a store are unaffected |
| Auth pages (`AuthShell`) | brand | logo above the card, primary button |
| System pages (404, maintenance, store-status screens) | brand | logo + colours |
| Invoices/PDFs, OG/share images, PWA manifest | brand | phase 3 |

A new public, unauthenticated, cacheable endpoint `GET /api/brand` (apps/web) returns only the safe subset (urls, colours, version). It never returns audit or staff data.

## 7. Super Admin UI

Sidebar: new **Branding** item under *Administration* (above Audit Log), icon `Palette`, route `/branding`, `platform_admin` and above can edit, support staff read only. Command palette entry added.

Page layout (shared kit only: `PageContainer`, `PageHeader`, `Card`, `Tabs` or sections, `ColorField`, `MediaPickerDialog`, `ConfirmDialog`; no native select/confirm, borders via tokens):

1. **Logo**: a 2 x 2 grid (Dark / Light x Logo / Icon) of upload tiles, each shown on a swatch of the surface it is meant for; Favicon tile below with a live tab preview and the generated sizes list. Drag and drop, replace, remove, alt text.
2. **Colour**: Primary and Secondary with hex input + picker; live contrast badge (AA pass or fail) against white and black; auto-generated shade ramp preview.
3. **Button**: Dark and Light cards, each with background and text colour; live preview of default, hover, disabled and focus states; contrast badge.
4. **Live preview** (sticky right column on desktop, below on 375 px): mini website header, a dashboard sidebar + button, a login card, an email header. Toggle light/dark preview.
5. **Footer bar**: Save (disabled until valid and changed), Discard, Reset to defaults, Version history (restore).

Editor hints use the (i) hover pop-up, not inline text (owner preference on record).

## 8. API and domain

- Contract (`packages/contracts`): `platform.branding.get`, `platform.branding.update`, `platform.branding.history`, `platform.branding.restore`; public `brand.get` for the web app.
- Domain (`packages/domain/src/platform/branding.ts`): `getPlatformBrand`, `updatePlatformBrand`, `restorePlatformBrand`. `assertPlatformStaff` for read, `assertRoleAtLeast(..., "platform_admin")` for write (decide in section 9), `writePlatformAudit` with a from/to diff, validators pure and unit tested.
- Cache: tag `platform-brand` (not tenant-prefixed because it is not tenant data; add the exemption to `cache-invalidation.ts` and document it next to the `bs/tenant-cache-tag` rule).
- Platform handler in `apps/platform/src/app.ts`; add to `apps/platform/test/audit-coverage.int.test.ts` and `rbac.int.test.ts`.

## 9. Decisions needed from the owner

1. **Dark/Light meaning:** is "Dark" the asset for dark surfaces (recommended, matches common usage), or a dark-coloured logo?
2. **Who can edit:** `platform_owner` only (like MFA) or `platform_admin` too? Recommend `platform_admin`.
3. **Email override:** should existing `platform_email_branding` values win over the brand until reset (recommended, no surprise change), or should the brand overwrite them?
4. **Store admin look:** should store admins (apps/admin) also pick up the platform primary colour, or only Super Admin and the website? Recommend all platform surfaces, since the admin is the platform's product.
5. **Fonts/name/tagline:** include now or later? Recommend later (phase 3).

## 10. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 Core | migration, tokens + validators, contract, domain, platform API, Branding page (logo/colour/button, no history), Super Admin consumes it (sidebar, login, favicon, vars) | gate green; real-DB test for RBAC + audit; page works at 375 px and desktop |
| 2 Everywhere | public `/api/brand`, website header/footer/favicon/CSS vars, store admin shell + auth pages, email defaults from brand, "Reset to brand" | each touch point verified in the browser; email render test |
| 3 Polish | version history + restore, shade ramp, OG image/PWA manifest/invoice, name/tagline/font, live multi-surface preview | |

## 11. Tests

- Unit: token parser (bad hex, short hex, non-https URL, oversize, SVG sanitiser), `buildBrandCss`, contrast fallback.
- Real database (`*.int.test.ts`, `startTestDb`): get/update round trip, audit row written, `platform_support` refused, `app_rw` cannot write, version bump and history cap.
- Component: Branding page validation, contrast badge, disabled save.
- Contract/e2e: `admin.*` isolation map unaffected (platform-only); add selectors for the new sidebar item to `e2e/` if a spec walks the Super Admin nav.

## 12. Risks

- **Brand colours break the UI's contrast** → mitigated by save-time AA validation plus render-time fallback.
- **Flash of default colours** → CSS variables are inlined server-side in `apps/web`; the SPAs read a cached copy from `localStorage` for first paint and refresh in the background.
- **SVG as an attack vector** → `<img>` only, sanitised on upload, size-capped; no inline SVG.
- **Product page 50 KB JS budget** (memory: no headroom) → brand data arrives as server-rendered CSS and `<img>` markup; no new client JS on the product page.
- **Parallel agents** → touches `Layout.tsx`, `@bs/ui` tokens and `email-branding.ts`; claim in `progress.md` "In flight" before starting and use a dedicated worktree.
