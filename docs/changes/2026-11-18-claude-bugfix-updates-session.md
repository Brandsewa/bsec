# Bug fix and updates session log (2026-11-18)

- **Date:** 2026-11-18
- **Agent:** claude
- **Branch:** `fix/pdp-variant-cards-login-panel` in worktree `C:\devsec-login-variants` (from `origin/main`; the old branch was 64 commits behind). Merged in PR 288 (c632dbd8), deployed to production, branch and worktree removed.
- **Area:** docs
- **Type:** fix
- **Supersedes:** none (continues `2026-11-14-claude-bugfix-updates-session.md`, whose open items are carried over below)

## Summary
Running log for a bug fix and updates session. Opened 2026-11-18 and waiting for the owner's "start". No work has been done yet. Issues and updates below are filled in as the owner reports them.

## What changed
Nothing yet.

### Issues
| # | Issue | Area | Status | Notes |
|---|---|---|---|---|
| C1 | (carried from 2026-11-14 #1) Stripe return redirected to `0.0.0.0:3000` | web | Fixed, not committed | See the 2026-11-14 log. `apps/web/src/lib/request-origin.ts` is still untracked. |
| C2 | (carried from 2026-11-14 #2) Product Carousel "New arrivals" / "Featured" tab does nothing | blocks / web | Noted, not started | |
| C3 | (carried from 2026-11-14 #3) "Choose your country" popup opens with a delay | web | Noted, not started | |
| 1 | Product page: a transparent image (PNG/WebP with alpha) shows a black background in the gallery instead of staying transparent | web / blocks | Fixed, checked locally | `ProductGallery.tsx`: the stored dominant colour (black for a transparent image) was the box background; it is now only a placeholder until the picture loads. |
| 2 | Product page: clicking a normal product image opens the zoom/lightbox offset under the header, with the product title, price and buttons showing through. It should open at the top, covering the page so product details are not visible | web / blocks | Fixed, checked locally | The viewer is now rendered on `document.body` (portal, z-1000, full viewport); inside the page a transformed or sticky ancestor made it the "fixed" box. |
| 3 | Admin login: Google sign-in button does not show on admin.bcom.si/login though the owner believes it was enabled | admin / platform | Cause found, config not changed | The button shows only when `/api/public/google-signin` reports enabled: Super Admin > Google client must be enabled with a client ID and secret. Not a code bug; check that setting on production. |

### Updates
| # | Update | Area | Status | Notes |
|---|---|---|---|---|
| C1 | (carried from 2026-11-14 #1) Footer widget: replace "Background" preset with custom background and text colour | blocks / block-editor | Noted, not started | Bump block version (ADR-009). |
| 1 | Product variant selector: add a **card** style beside the existing list and pill styles. Card shows the variant thumbnail/image if uploaded, name, price and compare price, and a small "Save N%" badge when discounted. Desktop: two cards visible; if more than two, a hover arrow turns it into a slider. Tablet: at least 2 (up to 3) per row. Mobile: product thumbnails/gallery on top, small cards below, 2 per row, sliding. Responsive, best-practice carousel (touch, keyboard, accessible) | blocks / block-editor / web | Built, checked locally | New `cards` value of `variantStyle` (no version bump: additive enum). Storefront `VariantCards` in `VariantSelector.tsx` (swipe row, hover arrows on desktop, 2/3/2 per row), editor sample + CSS. Reference image: headphone cards with "Save 20%" badge and struck-through compare price. Rough idea, improve on it. New option on the variant style setting, so bump block version (ADR-009) and keep old values rendering. Mind the product page 50 KB gz JS budget. |
| 2 | Admin login page (admin.bcom.si/login): redesign as a split screen. Content panel 40% (custom background, gradient or image, with text), form panel 60% (email, password, Sign in, Google sign-in if enabled). Bigger form fields. Responsive for mobile. Content (text, background colour or image) must be editable from the Super Admin or the website builder; later the same for the Super Admin and customer account pages | admin / superadmin / platform | Built, checked locally | Migration 0115 (`platform_settings.login_panel`), domain `login-panel.ts`, `settings.getLoginPanel/updateLoginPanel`, public `/api/public/login-panel`, Super Admin "Sign-in page" editor, admin `SplitAuthShell` (content panel on the right, 40/60). Reference: SaleSkip split layout. For now start with this one login page and a default gradient with text. Needs a place to store the content (platform setting vs website CMS) and a read path for the unauthenticated login page: decide when starting. |

## Decisions and trade-offs
None yet.

## Verification
Typecheck pass (db, domain, contracts, blocks, block-editor, admin, superadmin, web); platform has 1 error that also exists on plain main (marketing router, app.ts:508). Lint clean on touched packages. `@bs/blocks` tests 285 pass. NOT run: the new real-DB test `platform-login-panel.int.test.ts`, audit-coverage, isolation, because Docker would not start. Docker came up later: real-DB `platform-login-panel.int.test.ts` 4 pass, `audit-coverage` 82 pass. Checked in the browser (local, demo-store): cards at desktop (2 per row, "More options" arrow slides), tablet 768 (3), phone 375 (2, no arrows, no sideways scroll); transparent PNG shows the page background; the image viewer is on `<body>` at 0,0 full viewport z-1000; admin login split 60/40 on desktop and a 128px banner above 48px fields on a phone. NOT checked: Super Admin editor screen, Save from the editor, the saved panel showing on the login page (locally the admin calls bare localhost, which the web app answers with "Store Not Found", so the default panel shows), real touch swiping, full gate, `isolation` test.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`
- [ ] ADR / not needed because ...
- [ ] `DEPLOYMENT.md` / RUNBOOK / not needed
- [ ] `progress.md`

## Follow-ups and open questions
- Done: see docs/changes/2026-11-18-claude-variant-cards-login-panel.md (on main). The carried 2026-11-14 items were already merged in #257.
- Plan once started: build issues 1-2 and updates 1-2, then run a local site with seeded product data and test the variant cards and the login page locally before anything goes to `main`. Owner wants to review these locally first.

## Definition of done
Confirm each item in `AGENTS.md` section 7 before handoff.
