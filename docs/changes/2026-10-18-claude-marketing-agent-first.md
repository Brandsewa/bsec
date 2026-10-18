# Agent-first marketing page redesign

- **Date:** 2026-10-18
- **Agent:** claude
- **Branch:** `feat/marketing-agent-first`  (not merged yet; do not merge until the AI-commerce features it describes are built, owner decision 2026-10-18)
- **Area:** web
- **Type:** feature
- **Supersedes:** none

## Summary
The marketing page on the marketing host is rebuilt around the platform's agent-first positioning: be found where people now shop, inside AI chats (ChatGPT, Gemini, Claude), with in-chat checkout supported as each assistant launches it, Indian stores first in line. The design was approved by the owner as a standalone HTML prototype and is now implemented in the app. Plan: `docs/MARKETING-AGENT-FIRST-PLAN.md`.

## What changed
- `components/marketing/MarketingLandingPage.tsx` is now a server component composing sections from `components/marketing/landing/sections/`; styling is scoped under `.lp` in `landing/landing.css`.
- New client components: `PhoneDemo` (scripted search, three brands, pick, pay, order placed, notification; runs only while on screen and the tab is visible; reduced motion shows the finished state), `NegotiationDemo`, `Journey` (ARIA tabs), `Nav` (mobile menu), `Pricing` (monthly/yearly toggle over the live `plans` data), `LandingShell`.
- `SubdomainAvailabilityChecker` gained a `variant="lp"` look; the real store-name check and `/signup` hand-off are unchanged.
- `lib/fonts.ts` adds Instrument Serif (`--font-serif-display`) via `next/font`.
- Removed the Beam hero components (`beam/Orbit`, `Smoke`, `Dust`, `AppWindow`). `beam/beam.css` and `beam/fonts.ts` stay: `/signup` uses them.
- Copy in `landing/content.ts` updated (FAQ, launch steps, included features); `apps/web/PRODUCT.md` principle 1 now records the owner exception for this page.
- Test: `apps/web/test/marketing-landing.test.ts` (demo data shape, negotiation rules, content).

## Decisions and trade-offs
- Chats, brands, ratings, prices, the dashboard and the order number on the page are illustrations and say so on the page.
- Product thumbnails are gradient placeholders until real photos are supplied.
- The ChatGPT, Gemini and Claude marks are trademarks (Simple Icons paths); the owner reviews brand guidelines before launch.
- The full-page grain overlay uses no blend mode and is hidden on phones; glows are cheaper on phones.
- Tailwind's `.ring` utility collided with the countdown class, so it is named `.cdr`.

## Verification
- Ran (worktree `bsec-marketing`): `pnpm typecheck` pass; `pnpm lint` 0 errors (4 existing warnings in other files); `pnpm docs:check` ok; `pnpm --filter @bs/web build` compiled and listed routes; `pnpm --filter @bs/web test:fast` 26 files, 221 tests pass (includes the new `marketing-landing.test.ts`, 8 tests). Not run: the other packages' tests (only `apps/web` is touched) and the heavy real-database suite.
- Exercised by hand in the browser on the Next dev server (marketing host = localhost): desktop and 375 px views of hero, journey, feature grid, sales-rep demo, India, pricing, final call to action; mobile menu; store-name check returned "available" from the real API.
- NOT verified: Safari and Firefox; tablet widths; a keyboard-only pass and Lighthouse; the page served from the production build.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (not needed: no mention of the Beam components)
- [x] `apps/web/PRODUCT.md` (principle 1 exception)
- [x] `progress.md` (in flight)
- [x] `docs/MARKETING-AGENT-FIRST-PLAN.md`

## Follow-ups and open questions
- Owner: brand guideline review for the three AI logos; real product photos for the demo cards; keep or drop the monthly/yearly toggle (kept).
- Merge only when the AI-commerce features are built; then run a preview review and the full gate.

## Definition of done
Web gate run (see Verification). No secrets or generated files staged; `.env.dev` in the worktree is gitignored.
