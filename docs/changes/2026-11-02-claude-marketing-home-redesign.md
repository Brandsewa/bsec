# Marketing home page redesign: minimal light and dark theme

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `feat/marketing-home-redesign` (not merged yet)
- **Area:** web (marketing)
- **Type:** feature
- **Supersedes:** none

## Summary
The whole platform marketing site and the signup wizard move from the dark aurora and gradient look to a minimal, flat SaaS design with light and dark themes, using the owner's reference template (`starterkit-demo.getdesign.md`) as the guide for type, cards and layout. Home went first; the owner then asked for About, Contact, policies and signup to follow.

## What changed
- `apps/web/src/components/marketing/home/`: `HomeRoot`, `HomeNav` (theme toggle, mobile menu), `HomeFooter`, `sections.tsx`, `mocks.tsx` (product illustrations in markup), `AiTabs`, `HomePricing`, `icons.tsx` (line icons), `motion.ts`, `home.css` (scoped under `.mk`).
- About, Contact, Pricing, Terms, Privacy, Refund and Delivery use the new frame through `landing/PageFrame.tsx` (new `DocBody`). Legal and policy wording is unchanged. About gained line-icon lists and a call to action; Contact gained icons; Pricing uses the shared plan cards.
- `app/signup/page.tsx` is restyled. The step indicator now shows the 4 real steps (it showed 5).
- Theme: the marketing host follows light, dark or system on every path through the existing `@bs/ui` theme (`app/layout.tsx`, `WebThemeProvider always`). Store hosts are unchanged: only `/signup` is themed there.
- Removed: `landing.css`, `LandingShell`, `PhoneDemo`, `BrandIcons`, `demo-data`, `landing/sections/*`, the Instrument Serif font.

## Decisions and trade-offs
- The shared `@bs/ui` theme replaced a page-level script: `<html data-theme>` survives client navigation, and portalled select menus pick up the theme with it.
- No invented proof. The template's customer logos, usage counts and testimonials have no true equivalent yet, so they became the included strip and the four steps. Mock data is labelled as sample data.
- Existing copy was kept, including the Coming soon labels on AI features.
- No new dependency: icons are inline SVG (`apps/web` has no icon package).

## Verification
- Ran: `pnpm gate:quick` pass (includes affected tests and docs check), `pnpm --filter @bs/web build` pass, `pnpm --filter @bs/web test` 235 pass (32 files; demo-data tests removed with the code, a no-gradients guard added). The heavy suite was not run: no database, domain or permission code changed.
- Exercised in headless Chromium against the local dev server with `.env.dev`, marketing host `bcom.localhost:3000`: all 9 pages at 1440 and 375 px, light and dark, status 200, no horizontal overflow, no gradients. Theme toggle, persistence across client navigation and reload. AI tabs, monthly and yearly pricing, name check to `/signup`, mobile menu. Signup wizard steps 1 to 4 including the select menus, stopping before the launch button.
- Store host `demo-store.localhost` on a dark device: home has no `data-theme` and no `.mk`.
- NOT verified: the final launch step (no store was created), the success screen, the Google button and Turnstile (not configured locally), real devices, Safari and Firefox. The walkthrough left a test lead and subdomain reservation in the local dev database only.

## Docs updated
- [x] `docs/ARCHITECTURE.md`: not needed, no route, table or env change.
- [x] ADR: not needed.
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed.
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Owner: existing copy to review. "Payments and invoices" says all online payments are accepted, while `AGENTS.md` lists online payment as not live. The FAQ and Pricing page say custom domains are coming soon, while plans list them.
- `GET /api/saas/trial` returned 500 locally on the dev database (signup falls back to 14 days). Not caused by this change and not diagnosed; check it is not happening in production.
- The admin Activate screen is in `apps/admin` and was not changed.

## Definition of done
Not done until merged: gate passes, no secrets or generated files in the diff, change record and in-flight line updated after merge.
