# Marketing site: honest agent-first home page, company pages, legal pages

- **Date:** 2026-10-19
- **Agent:** claude
- **Branch:** `feat/marketing-agent-first`  (not merged yet; owner reviews first)
- **Area:** web
- **Type:** feature
- **Supersedes:** none (changes the release rule of `2026-10-18-claude-marketing-agent-first.md`; that record is not edited)

## Summary
The owner is applying for Razorpay, which verifies the live website. The marketing host now has the pages a gateway reviewer expects (about, contact, pricing, terms, privacy, refund and cancellation, delivery) with Brand Sewa Digital Private Limited's details, and the agent-first home page is shortened and made honest: a complete store is "Ready today", AI-agent features are "Coming soon". Plan: `docs/MARKETING-SITE-PLAN.md`.

## What changed
- Home page (`MarketingLandingPage.tsx` and `landing/sections/`): new hero copy ("agent-first e-commerce platform for Indian brands"), Ready today section, AI shopping era section (every card marked Coming soon or Built for the future), themes, pricing, shorter FAQ, footer. Removed the shift, journey, sales-rep demo, visibility dashboard and launch-steps sections (in git history).
- Hero phone (`PhoneDemo.tsx`): three tabs. Google Search and Instagram (ready today: find the product, open the store, place a cash-on-delivery order) and AI agents (coming soon: the assistant chat with three brands, pay and notification). Each tab shows a Ready today or Coming soon tag and an "Illustration" note.
- New routes on the marketing host only: `/about`, `/contact`, `/pricing`, `/terms`, `/privacy`, `/refund-policy`, `/shipping-policy`, each with a `loading.tsx`. `PageFrame` 404s on every other host; `middleware.ts` allows the paths on the marketing host.
- `site-info.ts` holds the company details (legal name, address, CIN, GSTIN, emails, grievance officer, jurisdiction) for the footer, contact, About, legal pages and Organization JSON-LD (`seo.ts`).
- `robots.txt` on the marketing host used to return `Disallow: /`; it now allows crawling (not `/api/` or `/preview/`) and links the sitemap; `sitemap.xml` lists the marketing pages.
- `loadLandingPlans` moved to `server/landing-plans.ts` (shared by the home page and `/pricing`).
- `apps/web/PRODUCT.md` principle 1 updated; `docs/ARCHITECTURE.md` routes line updated.
- Tests: `apps/web/test/marketing-landing.test.ts` (8 tests: demo data, content, required pages exist with a loading file, company details complete).

## Revision 1 (owner review, 2026-10-19)
- Removed the Themes section from the home page (and its unused code and data).
- Ready today grid is now: 01 complete catalogue management (SEO built in, built for GEO), 02 customers and segments, 03 visual theme builder, 04 shipping, orders, returns and exchanges, 05 cash on delivery and GST invoices (owner left 05 open; this is Claude's pick), 06 finance (sales, income, expenses, GST-ready reports).
- Checked against the code before wording: SEO is real (sitemaps, robots, product, category, collection, FAQ and organisation JSON-LD); there is no GEO-specific feature (no llms.txt), so the card says "built for GEO", not "ready"; Finance is merged (ledger, expenses, reports, ADR-022) with known pending checks listed in `progress.md`.

## Revision 2 (owner review, 2026-10-19)
- Ready today cards rewritten: no icons or glyphs, gradient headings, order: catalogue management, customers and segments, payments and invoices (online payments: UPI, cards, net banking, plus COD; GST invoices), shipping/orders/returns/exchanges, intelligent analytics, themes and visual theme builder.
- **Launch gate (owner decision):** online payments and intelligent analytics are not built yet. The owner has confirmed both will be built before launch, so this copy describes them as available. **Do not merge or deploy this branch until both exist.** The pricing page no longer lists online payments as coming soon; terms section 9 and the About page now mention online payments.
- Product name on every marketing page, metadata, footer, nav, phone demo and the signup page changed from "Bs Commerce" to "BCom" (`site-info.ts` `product`, plus hard-coded strings). The domain stays bcom.si.

## Decisions and trade-offs
- Billing is described as Razorpay subscriptions (owner), with the owner able to set up a plan from the back end for some stores. Refunds: within 7 days of a payment, none after. Courts: West Bengal. No phone number published yet. These are the owner's inputs, not invented.
- Legal text is drafted from common best practice and the product's real behaviour; it is not legal advice and should be read by the owner or counsel before the Razorpay submission.
- Custom domains are described as Coming soon (provisioning is not live). The FAQ and pricing page say online payments and AI features are not part of any plan until released.
- Company details (address, CIN, GSTIN, grievance officer name and email) are committed to a public repo; the owner will make the repo private and the details are on the website anyway.

## Verification
- Ran (worktree `bsec-marketing`): `pnpm typecheck` pass; `pnpm lint` 0 errors (4 existing warnings elsewhere); `pnpm docs:check` ok; `vitest run test/marketing-landing.test.ts` 8 pass. `pnpm --filter @bs/web build` compiled and listed the new routes; `pnpm --filter @bs/web test:fast` passed.
- Exercised by hand on the Next dev server (marketing host = localhost): all eight pages return 200; the same paths return 404 for another host; `robots.txt` and `sitemap.xml` correct; home page, terms and contact in the browser at desktop and 375 px; hero phone tabs (Google typing, Instagram post, AI agents Coming soon badge); no horizontal scroll.
- NOT verified: Safari and Firefox; tablet widths; keyboard-only pass and Lighthouse; the production build served on the real domain; every legal page read by counsel.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (routes line)
- [x] ADR not needed (no architectural decision)
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed (no env vars or services)
- [x] `progress.md` (in flight)
- [x] `apps/web/PRODUCT.md`, `docs/MARKETING-SITE-PLAN.md`

## Follow-ups and open questions
- Owner: read the legal pages; confirm refund wording and that subscriptions are live before launch; add a phone number if wanted; real product photos for the demo cards; brand-guideline check for the Google, Instagram, ChatGPT, Gemini and Claude marks.
- Contact form once email sending is confirmed (details only for now).
- Merge only after owner review; `main` is production, so merge one PR at a time and watch the deploy.

## Definition of done
Web gate partly run (see Verification); no secrets or generated files staged; `.env.dev` in the worktree is gitignored.
