# Markets: silent country detection, one URL rule, footer country selector, real-host redirect

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `feat/market-detection-perf` (merged in #225, deployed)
- **Area:** web, blocks
- **Type:** feature
- **Supersedes:** none

## Summary
After markets went live the owner saw an ugly top currency bar, a selector that sent them to `https://0.0.0.0:3000/...`, and a currency that sometimes changed on reload. This change places first-time visitors by country automatically, makes the URL decide the market, and moves the selector to the footer.

## What changed
- **Redirect host** (`api/storefront/market/select/route.ts`): redirects use the forwarded host and protocol, not the address the server listens on.
- **One URL rule** (`middleware.ts`, `lib/market-detect.ts`, pure and tested): a market prefix (`/global`) always shows that market; an address without a prefix is the base market. A shopper whose saved market is not the base is sent (307) to that market's prefixed address, so a reload or a link without the prefix can no longer show another currency.
- **Silent detection:** a first-time visitor (no market cookie) is placed once by country (Cloudflare `CF-IPCountry`, trusted only with `cf-ray`; `?country=XX` in development only), the market is saved in the `bs_market` cookie and never re-detected. A country no market covers goes to the base market. Crawlers and non-page requests (API, prefetch, RSC) are never moved.
- **Footer selector** (`FooterMarketSelector.tsx`, `renderMarketSwitcher` slot in `RenderContext` and `SiteFooterView`): under the store description, a button "India · INR" opens a searchable list of every country the store sells to with its currency; picking one switches market and returns to the same page. The top `MarketBar` is removed (the "switch?" banner is no longer needed with silent detection).
- The evaluate route now returns every market with its countries (base included, prefix empty); the middleware treats "markets exist" as more than one.

## Decisions and trade-offs
- Owner decisions 2026-11-04: detect and switch silently; a country with no market goes to the base market.
- Geo-IP database fallback is not used for countries (it is an India-only extract); outside Cloudflare, detection falls back to the base market.

## Verification
- `apps/web/test/market-detect.test.ts` (new, 5 cases); web 237+ tests, blocks 270 pass; typecheck and lint pass for web and blocks.
- NOT verified: nothing driven in a browser (selector look, redirect, cookie) and Cloudflare country headers cannot be exercised locally.

## Docs updated
- [x] ARCHITECTURE section 19 ("Market URL rule and detection") updated
- [x] ADR: extends ADR-040, not needed
- [x] `progress.md`

## Follow-ups and open questions
- Slow page loads: measured, not reproduced in a production build (below). If it persists in the live store, send timings from the browser network tab.

## Performance check
Production build of this branch against the local dev database (store with 24 products), warm requests: about 90 to 115 ms per page with one market and with two active markets, first request after start 1.7 s. Markets add no measurable per-page cost here. The most likely causes of the slowness seen on `http://0.0.0.0:3000` are `next dev` compiling each route on first visit (the dev log shows 1.6 to 4.3 s per route) and database latency on a remote database. Not measured: the live store, a remote database, or a cold CDN.

## Also verified against a running storefront (production build, local database, two markets)
- US visitor (`cf-ray` + `cf-ipcountry: US`) on `/collections/all?x=1`: 307 to `/us/collections/all?x=1`, cookie set.
- Brazil visitor (no market): stays on `/`, cookie set to the base market.
- Googlebot from the US: not moved, no cookie.
- Saved US cookie on `/`: 307 to `/us`.
- `/api/storefront/market/select` redirects to `http://<the request host>/...`, not 0.0.0.0.

## Definition of done
- [x] After merge: PR recorded, in-flight line removed, branch and worktree deleted
