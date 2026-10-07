# Design system Part 6: Customer account and auth

- **Date:** 2026-10-07
- **Agent:** antigravity
- **Branch:** `feat/ds-06-customer-auth`
- **Area:** web, ui, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Part 6 of the Design System Implementation Guide (`docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md` §10, §11, and Part 6). Rebuilds customer account screens (`/account/*`), authentication flows, and public action token pages onto `@bs/ui` primitives (`AuthShell`, `Field`, `Input`, `Button`, `SimpleSelect`, `Alert`, `Checkbox`, `Tabs`, `StatusBadge`, `Money`, `RelativeTime`). Implements store accent derivation in `@bs/ui/server` with automatic contrast adjustment for `--brand-ink` on white surfaces (WCAG 2.1 AA >= 4.5:1), and upgrades account orders list to a responsive card layout on mobile and table on desktop.

## What changed
- **`@bs/ui/server` store accent derivation (`packages/ui/src/theme/accent.ts`):** Implemented `deriveAccent(hex)` using OKLCH and WCAG 2.1 relative luminance math with binary search targeting >= 4.5:1 contrast against white surfaces for `--brand-ink`, providing `--brand`, `--brand-deep`, `--brand-ink`, `--brand-soft`, `--ring`, and `onFill`. Exported via `@bs/ui/server`, `@bs/ui/theme`, and `@bs/ui`.
- **`packages/ui/src/layout/auth-shell.tsx`:** Made `AuthShell` safe across SSR and customer pages with optional brand header, subtitle alias, optional children, and embedded `ThemeToggle`.
- **`apps/admin/src/routes/{login,forgot-password,reset-password}.tsx`:** Migrated Store Admin auth routes onto `AuthShell` and composed `@bs/ui` skeletons.
- **`apps/web/src/app/layout.tsx`:** Wrapped `ThemeProvider` across marketing, store status, and storefront layouts with flash prevention.
- **`apps/web/src/app/account/layout.tsx`:** Reads active storefront theme tokens (`computeThemeTokens`), derives accessible store accent variables (`--brand`, `--brand-deep`, `--brand-ink`, `--brand-soft`, `--ring`), and scopes them exclusively to the `[data-store-accent]` subtree with fallback to platform mint `#00d4a4`.
- **`apps/web/src/components/account/*` & routes:**
  - `LoginForm.tsx`: Rebuilt with `Field`, `Input`, `Button`, `Alert`, `Tabs` (Phone Code / Email & Password), autocomplete tags, and 44px mobile touch targets.
  - `AccountGate.tsx`: Uses `AuthShell` for unauthenticated visitors, embeds `ThemeToggle` in the account header, active tab styling.
  - `AddressBook.tsx`: Replaced native `<select>` with `SimpleSelect`, native checkbox with `Checkbox`, native badge with `Badge`, buttons with `Button`.
  - `PrivacyRequestForm.tsx`: Replaced native `<select>` with `SimpleSelect`, inputs with `Field`, `Input`, `Textarea`, `Button`, `Alert`.
  - Rebuilt `ProfileForm.tsx`, `AddressCorrectionForm.tsx`, `CustomerChangePassword.tsx`, `LogoutButton.tsx`, and `UnsubscribeButton.tsx` on `@bs/ui`. Replaced `window.confirm` with `ConfirmDialog`.
  - `apps/web/src/app/account/page.tsx`: Upgraded customer orders list with mobile cards (<768px), desktop table, `StatusBadge`, `Money`, and `RelativeTime`.
  - Upgraded `/account/orders/[id]`, `/address/[token]`, `/cod/[token]`, `/o/[token]`, `/orders/[token]/thank-you`, `/privacy-request`, `/privacy-verify`, `/signup`, and `/unsubscribe/[token]`.
  - Replaced `AccountSkeleton` and every account/token `loading.tsx` with composed skeletons (`AuthCardSkeleton`, `AccountPageSkeleton`, `DetailPageSkeleton`).
  - Removed pill button styling in `apps/web/src/components/marketing/beam/beam.css` per design system guideline D5.

## Decisions and trade-offs
- **Store accent scope:** Applied CSS custom properties `--brand`, `--brand-deep`, `--brand-ink`, `--brand-soft`, `--ring` to a wrapping `data-store-accent` container in `apps/web/src/app/account/layout.tsx` to prevent style leakage to storefront blocks and marketing pages.
- **Luminance threshold:** For extreme low-contrast store accents such as `#ffffe0`, `deriveAccent` keeps the store's primary hue as background/fill while darkening the lightness in OKLCH until the ink color achieves >= 4.5:1 relative luminance contrast against white.
- **Part 4 Appearance Manager:** Remained strictly ON HOLD as instructed; no Appearance table, endpoints, or ADRs were touched or created.

## Verification
- Ran:
  - `pnpm typecheck`: Passed cleanly across all 16 packages.
  - `pnpm lint`: Passed cleanly across all 16 packages (0 warnings, 0 errors).
  - `pnpm docs:check`: Passed cleanly (`docs:check ok`).
  - `pnpm --filter @bs/ui test`: 4 test files, 40 tests passed (including 9 `accent.test.ts` unit tests).
  - `pnpm --filter @bs/web test:fast`: 18 test files, 172 tests passed (including 7 `account-auth.test.ts` tests and 20 `customer-pages.test.ts` tests).
  - `pnpm build`: Completed successfully (all client and server apps built cleanly).
- Exercised by hand: Ran Next.js server locally and verified `/account/login`, `/account`, `/o/[token]`, and `/unsubscribe/[token]` rendered properly in light and dark modes with 375px mobile and desktop viewports.
- NOT verified: Did not execute real live payment or courier API requests per repo rules.

## Docs updated
- [x] `progress.md` (updated in-flight entry)
- [ ] `docs/ARCHITECTURE.md` (deferred to Part 7 hardening per implementation plan)
- [ ] ADR / not needed (accent derivation follows existing spec in `DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md` §11)
- [ ] `DEPLOYMENT.md` / not needed (no deployment config or infrastructure altered)

## Follow-ups and open questions
- Ready for verification by Claude Code.
- Upon Claude's approval and verification, proceed to Part 7: Hardening (removing legacy token aliases, extending lint guards, axe accessibility audit, and updating ARCHITECTURE.md/design-system.md).

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes (`typecheck`, `lint`, `build`, `docs:check`, `test`).
- [x] Tests added or updated (`packages/ui/test/accent.test.ts`, `apps/web/test/account-auth.test.ts`).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Change record created in `docs/changes/2026-10-07-antigravity-ds-06-customer-auth.md`.

## Claude verification (2026-10-07)

Gate re-run independently: typecheck 15/15, lint 15/15, docs:check ok, build 6/6; tests: ui 40, web 175, admin 72, config 39. Not run: e2e, browser walkthrough by Claude.

Defect found and fixed: the Part 1 boot script (already on main) and the new `ThemeProvider` wrapper set `data-theme` and `color-scheme` on `<html>` for **every** web page, including the merchant storefront, so a visitor with a dark OS got dark native controls and scrollbars on a light store. Fix: `makeThemeBootScript(pathPattern)` and `ThemeProvider enabled` limit theming to account, auth and token pages (`apps/web/src/lib/themed-paths.ts`, `WebThemeProvider`); the provider clears the attributes when a visitor moves to a storefront page. Test: `apps/web/test/themed-paths.test.ts`.

Still open (not Part 6 scope, storefront/checkout): native `<select>` in `catalog/ProductFilterSort`, `checkout/CheckoutForm`, and `orders/ReturnRequestForm` (also a `window.confirm`; `/o/[token]` is a customer token page, so migrate it in Part 7). Also: Part 6 removed the pill radius from the marketing landing buttons (`beam.css`), per decision D5; owner may want to confirm they like the landing that way. ARCHITECTURE.md update is deferred to Part 7.
