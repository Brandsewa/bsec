# Marketing landing redesign: "Beam"

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `design/marketing-landing` (not merged yet)
- **Area:** web (marketing page), docs
- **Type:** feature (design)
- **Supersedes:** none

## Summary
Redesigned the bcom.si marketing landing page as **"Beam"**: a near-black hero where volumetric violet smoke drifts around the page and a lit product window (our store admin's order board) rises from the bottom edge, with a warm-glow pill CTA and a store-name field. The owner explored six designs locally (Block-Print Bazaar, Bahi-Khata, Riso Zine, Neubrutalist Grid, Night Sky, Beam), chose Beam, and asked for the other five and the testing switcher to be removed; they stay recoverable from this branch's history (commits `2c1f4f6` to `94feeb9`) and will be improved on later.

Beam is an original build in the style of modern dark developer-tool heroes (studied from public pages): no third-party code, copy, logo, screenshots or assets.

## What the page is
- **Hero:** left-aligned headline, one sentence, store-name field with a "See it in action" warm-glow pill (the existing `/signup` flow), the lit order-board window with sample orders dropping in (labelled "Sample data"). Violet smoke is a small WebGL domain-warped noise shader lit along the beam axis (CSS haze underneath as fallback), plus a dot grid that only exists in the light, grain, rising light motes (small canvas), and a violet bloom and wash at the window edge. The earlier hard white beam line, cone, soft beam column and white-hot flare were removed at the owner's request.
- **Below the hero (dark, minimal):** strip of what bcom.si does; "what works today" panels (COD, GST invoices, no-code theme builder, orders/returns/quotes/pre-orders, customers and segments, shipping rates) with example UI; a Coming-soon row; theme previews; steps; pricing from the live `plans` table (fallback = migration 0012 values; bullets derived from each plan's limits); every-plan-includes; FAQ; closing field; footer.
- **Fonts:** Geist via `next/font/google` (self-hosted at build time; no request from visitors' browsers to Google).
- **Motion:** headline and copy rise out of blur once; window cards stagger in; new orders drop in every few seconds; smoke, bloom and button glow breathe slowly; light falls away on scroll (scroll-driven where supported); section reveals. Everything stops under `prefers-reduced-motion`.

## Content and claims (apps/web/PRODUCT.md)
Truthful claims with "Coming soon" badges (owner decision): Razorpay/UPI, Shiprocket, WhatsApp and SMS, custom domains and invoice PDFs are marked Coming soon. The old page's unverifiable claims were removed ("zero commission", 24/7 SLA, flash-sale protection, pincode counts, one-click domains, etc.). No testimonials, logos or statistics were added (none exist).

## Files
`apps/web/src/components/marketing/`: `MarketingLandingPage.tsx`, `SubdomainAvailabilityChecker.tsx` (same signup logic, one look), `beam/` (`beam.css`, `AppWindow.tsx`, `Smoke.tsx`, `Dust.tsx`, `fonts.ts`), `landing/` (`content.ts`, `motion.ts`); `apps/web/src/app/page.tsx` (loads live plans, new metadata copy for the platform host); `apps/web/PRODUCT.md`.

## Smoke implementation notes
`Smoke.tsx` renders at about 28% resolution, 4 octaves, one warp pass, about 25 fps, paused when the tab is hidden or the hero is off screen. Guards: software rasterisers (SwiftShader, llvmpipe) get a single still; reduced motion gets a still; 8 slow frames stop the loop. Two bugs found and fixed while building it: a first, heavier shader starved the page of animation frames under software WebGL; and React strict mode exposed a cleanup that called `loseContext()` so the remount reused a dead context (grey wash).

## Verification
- `tsc --noEmit` (apps/web), `eslint` on the marketing code, Impeccable design detector, `pnpm docs:check`: clean.
- Browser (dev server; 1440 and 375 px, in background tabs so the owner's pane was not disturbed): hero, flare/window edge, sections, pricing; no horizontal overflow at 375 px; no console errors. Background tabs throttle animations, so mid-animation frames were re-checked with computed styles.
- `pnpm --filter @bs/web build` (Next production build with the self-hosted Geist font): passes.
- **Not done:** Lighthouse/performance run, screen-reader pass, other browsers (Safari: the scroll-driven light fade falls back to a static light), mobile re-check after the final smoke change, finish review and DESIGN.md. Dev server logs a pre-existing Next error for `/signup` (`generateMetadata` reads headers); not touched here.

## Follow-ups
- Restyle `/signup` in the Beam world (it still has the old green look).
- Improve Beam later (owner): smoke richness, mobile hero composition, the sections below the hero.
- Add a contact route and platform Terms/Privacy pages (none exist, so the footer does not link them).
- Write DESIGN.md for Beam once it settles.

## Definition of done
- [x] Typecheck, lint, detector, docs check. [ ] Full gate and Lighthouse (not run). [x] Change record. No secrets; `.env.local` is gitignored; `.claude/launch.json` local edit and `apps/web/.impeccable/` are not committed.
