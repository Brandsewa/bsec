# Fixes: category prices in other markets, country switch landing page, market URLs on the live store

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `fix/market-prices-switch` (merged in #226)
- **Area:** web
- **Type:** fix
- **Supersedes:** none

## Summary
Owner report on the live store (theexoteas.bcom.si, International market): category pages showed rupee amounts with a dollar sign, a country switch from the footer landed on a 404, and market URLs such as `/global` were not recognised.

## What changed
- **Category prices** (`app/categories/[slug]/page.tsx`): the category loader was called without the market scope (the collection page passes it), so listings used base rupee prices while the currency symbol followed the market. It now passes the market. Checked on a production build with two markets: `/us/categories/apparel` shows converted dollar prices.
- **Country switch** (`MarketSelectorDialog.tsx`): choosing a country opens that market's home page instead of the same page, which may not exist in the other market.
- **Middleware market list** (`middleware.ts`): on the live store `/global` returned the store's own "Page not found" and `/` with an International cookie did not redirect, so the middleware never got the market list (the public evaluate endpoint returns it correctly). The middleware now retries the evaluation on the server's own loopback port when the first address fails, keeps the last good market list per host, and reports the reason in an `x-bs-eval` response header (`ok`, `http-<status>` or `error-<name>`, no secrets).

## Decisions and trade-offs
- The root cause of the missing market list on the live server is not proven (no server logs available). The retry and the header should fix it if it is a reachability problem, and show the reason if it is not. If `/global` still 404s after deploy, read `x-bs-eval` on the response.
- Coupon amounts are fixed in the store's base currency and are not converted per market (not changed here).

## Verification
- Typecheck, lint, web 237 tests pass; local production build: base and US category prices, redirect target `/us/`, `x-bs-eval: ok`.
- Live store (read-only, via the Cloud Browser): confirmed `$424 - $509` on `/categories/ayurvedic-tea` (rupee amounts), `/global` 404, evaluate endpoint returns both markets.
- NOT verified: the live fix (needs the deploy), and the reason for the missing list on the live server.

## Docs updated
- [x] ARCHITECTURE / ADR / DEPLOYMENT: not needed
- [x] `progress.md`

## Follow-ups and open questions
- Page loads on the live store take 0.8 to 1.7 s and the evaluate call alone about 0.5 s from a browser; the middleware runs it on every request.

## Definition of done
- [x] After merge: PR recorded, in-flight line removed, branch deleted
