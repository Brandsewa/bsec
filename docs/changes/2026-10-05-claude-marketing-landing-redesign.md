# Marketing landing redesign: six designs behind a testing switcher

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `design/marketing-landing` (not merged; owner is comparing designs locally)
- **Area:** web (marketing page), docs
- **Type:** feature (design exploration)
- **Supersedes:** none

## Summary
Redesigned the bcom.si marketing landing page in six visual worlds, built truthfully from what the product ships today, with tasteful motion and a testing-only switcher.

- **Home 1: Block-Print Bazaar** (default): indigo-dyed cotton, carved-block stamp animation, scroll-drawn stitch thread, damped-spring numbers, sample admin.
- **Home 2: The Bahi-Khata**: red book-cloth, ruled yellowed paper with double red margins, brass corners, entries written in with a shopkeeper's pen font, a rubber stamp, a rate card with dotted leaders.
- **Home 3: Riso Zine**: risograph spot inks (pink, blue, sunflower) that overprint with multiply on toothy paper, headline ink layers that slide into register on load, halftone dots, a ticker band, cut-paper stickers, Unbounded + Schibsted Grotesk + a marker scrawl.
- **Home 4: Neubrutalist Grid**: off-white ground, 3px black outlines, one 6px hard shadow, flat marigold / hot pink / electric blue / lime fields on a rigid 12-column grid, marker-highlighted headline words, buttons that travel into their shadow on press, a ticking sample dashboard, stepped (snappy) motion only. Epilogue + Work Sans.
- **Home 5: Night Sky** (requested by the owner): a modern dark SaaS with a celestial layer. Midnight ground, deterministic starfield, an orbit diagram with the store as the sun and themes / COD / GST / orders / customers in slow orbit, constellation line art that draws itself, portholes for themes, moon-phase plan tiers, one gold action colour. Sora + Albert Sans.
- **Home 6: Beam** (requested by the owner, in the style of modern dark developer-tool heroes such as huly.io): a near-black hero lit by one vertical beam that falls onto the top edge of the product window and blooms there (flare, streak, halo), slow violet volumetric smoke (a small WebGL domain-warped noise shader, lit along the beam, with the CSS haze as fallback), a dot grid that exists only in the light, rising light motes (small canvas), left-aligned headline, a warm-glow pill, and our store admin's order board as the lit window with orders dropping in. Geist throughout. The flare at the window edge has a white-hot core, a wide wash and two lens streaks. **Original build**: the layout idea and mood were studied from the public page; no third-party code, copy, logo, screenshots or assets were copied.
- **Design switcher** (`?design=N` plus a floating menu): rendered and honoured **only** when `NEXT_PUBLIC_MARKETING_DESIGN_SWITCHER=1`. Production does not set it, so production always renders Home 1. All six designs are built.

## Content and claims (apps/web/PRODUCT.md)
Owner decisions 2026-10-05: truthful claims with "Coming soon" badges; visitors are D2C founders, sellers moving platforms and agencies; live pricing with no invented proof. The old page's unverifiable claims were removed (UPI/Razorpay live, Shiprocket automation, WhatsApp, "zero commission", 24/7 SLA, flash-sale protection, pincode counts, one-click domains). Live today vs Coming soon follows `progress.md`. Plan prices and limits are read from the `plans` table (fallback = migration 0012 values); plan bullets are derived from each plan's own limits. FAQ answers were rewritten to match.

## What changed
- `apps/web/src/components/marketing/MarketingLandingPage.tsx` (Home 1), `MarketingLandingBahi.tsx` (Home 2), `MarketingLandingRiso.tsx` (Home 3), `MarketingLandingNeo.tsx` (Home 4), `MarketingLandingSky.tsx` (Home 5), `MarketingLandingBeam.tsx` (Home 6), `landing/` to `landing6/` (CSS, motifs, content, fonts, motion hooks, sample admin / day book), `designs.ts`, `DesignSwitcher.tsx`.
- `SubdomainAvailabilityChecker.tsx`: same signup logic, restyled, with a `variant` prop for the ledger look.
- `apps/web/src/app/page.tsx`: loads live plans (`listPublicPlans`), picks the design, new metadata copy for the platform host.
- `apps/web/PRODUCT.md`: product truth record for design work.
- Fonts via `next/font/google` (self-hosted at build; no request from visitors' browsers to Google): Bricolage Grotesque + Figtree (Home 1); Young Serif + Hind + Kalam (Home 2); Unbounded + Schibsted Grotesk + Reenie Beanie (Home 3); Epilogue + Work Sans (Home 4); Sora + Albert Sans (Home 5); Geist (Home 6).

## Verification
- `tsc --noEmit` (apps/web) and `eslint` on the changed files: clean. Impeccable detector: no findings on either design.
- Browser (dev server, 1440 and 375 px): Homes 3 to 6 were inspected (Home 6: hero, flare and window at 1440 px, hero, window and pricing at 375 px with no overflow; the detector flagged gradient headline text, replaced by solid near-white) in separate background tabs (Home 5: hero with orbit and order log, what works today, themes, pricing at 1440 px; hero, orbit, log and pricing at 375 px, no overflow; background tabs throttle animations so a mid-animation frame was re-checked via computed styles) (Home 4: hero, what works today, themes, pricing at 1440 px; hero, dashboard, pricing at 375 px, no overflow; the detector flagged a decorative graph-paper background, which was removed) (hero, what works today, themes, steps, pricing at 1440 px; hero, order slip, ticker and pricing at 375 px, no overflow) while the owner used the main tab; Homes 1 and 2 inspected hero, index/features, themes, steps, pricing, FAQ, close on both designs; no horizontal overflow at 375 px; reveal bug found and fixed (a fully clipped element has no visible area so IntersectionObserver never fired; the clip now keeps a 1% sliver); muted text on cotton panels fixed; header buttons and a Tailwind-vs-unlayered-CSS conflict fixed.
- Reduced motion: all animation and reveals disabled by `prefers-reduced-motion` (CSS and hook), final states shown.
- **Not done:** `pnpm build`, Lighthouse/performance run, screen-reader pass, other browsers (Safari: `animation-timeline: scroll()` thread falls back to a static thread), finish review and DESIGN.md (to be written for the design the owner picks).
- Dev server logged a pre-existing Next error for `/signup` (`generateMetadata` reads headers); not touched here.

## Follow-ups
- Pick a design (, then remove the others and the switcher, run `pnpm build`, and restyle `/signup` in the chosen world (it still has the old green look).
- Replace the placeholder logo mark if a real one exists; Home 2 uses a Hindi invocation line ("shubh labh") that the owner may remove.
- Add a contact route and platform Terms/Privacy pages (none exist today, so the footer does not link them).
- No testimonials, logos or statistics exist; none were added.

## Definition of done
- [x] Typecheck, lint, detector. [ ] `pnpm build` and full gate (not run). [x] Change record. [ ] DESIGN.md and finish review pending the owner's pick. No secrets; `.env.local` is gitignored.

## Home 6 smoke and flare (follow-up, same day)
- Smoke is a WebGL fragment shader (`landing6/Smoke.tsx`): domain-warped fractal noise at about 28% resolution scaled up, 4 octaves, one warp pass, roughly 25 fps, paused when the tab is hidden or the hero is off screen. **Guards:** a software rasteriser (SwiftShader, llvmpipe) gets a single still frame, reduced motion gets a still, and 8 slow frames stop the loop. A first version was too heavy for software WebGL and starved the page of animation frames; React strict mode also exposed a bug where cleanup called `loseContext()` and the remount reused the dead context (grey wash). Both fixed.
- Flare: white-hot core, wide wash, glow and two streaks above the window edge, plus a brighter beam halo and bloom.
- Owner request: the hard white beam line and the triangular cone were removed from Home 6; the soft halo, smoke, grid, motes and flare are unchanged.
- Owner request: the soft white beam column and its drop-in animation, and the white-hot flare (glow, core, streaks) where it landed, were removed from Home 6; smoke, dot grid, motes, the violet wash and the lit window edge are unchanged.
