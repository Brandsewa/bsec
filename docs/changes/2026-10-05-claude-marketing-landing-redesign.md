# Marketing landing redesign: two designs behind a testing switcher

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `design/marketing-landing` (not merged; owner is comparing designs locally)
- **Area:** web (marketing page), docs
- **Type:** feature (design exploration)
- **Supersedes:** none

## Summary
Redesigned the bcom.si marketing landing page in two visual worlds, built truthfully from what the product ships today, with tasteful motion and a testing-only switcher.

- **Home 1: Block-Print Bazaar** (default): indigo-dyed cotton, carved-block stamp animation, scroll-drawn stitch thread, damped-spring numbers, sample admin.
- **Home 2: The Bahi-Khata**: red book-cloth, ruled yellowed paper with double red margins, brass corners, entries written in with a shopkeeper's pen font, a rubber stamp, a rate card with dotted leaders.
- **Design switcher** (`?design=N` plus a floating menu): rendered and honoured **only** when `NEXT_PUBLIC_MARKETING_DESIGN_SWITCHER=1`. Production does not set it, so production always renders Home 1. Homes 3 and 4 appear disabled (not built).

## Content and claims (apps/web/PRODUCT.md)
Owner decisions 2026-10-05: truthful claims with "Coming soon" badges; visitors are D2C founders, sellers moving platforms and agencies; live pricing with no invented proof. The old page's unverifiable claims were removed (UPI/Razorpay live, Shiprocket automation, WhatsApp, "zero commission", 24/7 SLA, flash-sale protection, pincode counts, one-click domains). Live today vs Coming soon follows `progress.md`. Plan prices and limits are read from the `plans` table (fallback = migration 0012 values); plan bullets are derived from each plan's own limits. FAQ answers were rewritten to match.

## What changed
- `apps/web/src/components/marketing/MarketingLandingPage.tsx` (Home 1), `MarketingLandingBahi.tsx` (Home 2), `landing/` and `landing2/` (CSS, motifs, content, fonts, motion hooks, sample admin / day book), `designs.ts`, `DesignSwitcher.tsx`.
- `SubdomainAvailabilityChecker.tsx`: same signup logic, restyled, with a `variant` prop for the ledger look.
- `apps/web/src/app/page.tsx`: loads live plans (`listPublicPlans`), picks the design, new metadata copy for the platform host.
- `apps/web/PRODUCT.md`: product truth record for design work.
- Fonts via `next/font/google` (self-hosted at build; no request from visitors' browsers to Google): Bricolage Grotesque + Figtree (Home 1); Young Serif + Hind + Kalam (Home 2).

## Verification
- `tsc --noEmit` (apps/web) and `eslint` on the changed files: clean. Impeccable detector: no findings on either design.
- Browser (dev server, 1440 and 375 px): inspected hero, index/features, themes, steps, pricing, FAQ, close on both designs; no horizontal overflow at 375 px; reveal bug found and fixed (a fully clipped element has no visible area so IntersectionObserver never fired; the clip now keeps a 1% sliver); muted text on cotton panels fixed; header buttons and a Tailwind-vs-unlayered-CSS conflict fixed.
- Reduced motion: all animation and reveals disabled by `prefers-reduced-motion` (CSS and hook), final states shown.
- **Not done:** `pnpm build`, Lighthouse/performance run, screen-reader pass, other browsers (Safari: `animation-timeline: scroll()` thread falls back to a static thread), finish review and DESIGN.md (to be written for the design the owner picks).
- Dev server logged a pre-existing Next error for `/signup` (`generateMetadata` reads headers); not touched here.

## Follow-ups
- Pick a design (or ask for Homes 3 to 4: Riso Zine, Neubrutalist Grid), then remove the others and the switcher, run `pnpm build`, and restyle `/signup` in the chosen world (it still has the old green look).
- Replace the placeholder logo mark if a real one exists; Home 2 uses a Hindi invocation line ("shubh labh") that the owner may remove.
- Add a contact route and platform Terms/Privacy pages (none exist today, so the footer does not link them).
- No testimonials, logos or statistics exist; none were added.

## Definition of done
- [x] Typecheck, lint, detector. [ ] `pnpm build` and full gate (not run). [x] Change record. [ ] DESIGN.md and finish review pending the owner's pick. No secrets; `.env.local` is gitignored.
