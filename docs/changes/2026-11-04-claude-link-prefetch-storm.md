# Storefront links prefetch only on intent

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `perf/link-prefetch` (merged in #228, deployed)
- **Area:** web
- **Type:** fix
- **Supersedes:** none

## Summary
Cloudflare request logs (owner, 2026-11-04) showed one visitor's page views producing 30 to 40 uncached requests to the origin within 20 seconds (`/categories/*`, `/cart`, `/account`, `/search`, `/pages/*`, `/blog`, `/policies/*`). They are link prefetches: in this Next version every `<Link>` prefetches its page as soon as it scrolls into view, and storefront pages are dynamic, so each one is a real request through the whole request pipeline (middleware evaluation, access checks, rate-limit write, render). About 23,000 of the day's requests were served by the origin.

## What changed
- `components/storefront/IntentLink.tsx` (client): a `next/link` that prefetches only after the pointer enters it, a touch starts or it gets keyboard focus, then behaves as normal (so clicks stay instant). An explicit `prefetch` prop still wins.
- Used by the header, footer and block links (`ThemeChrome`), product cards, pagination, collection listing, mobile bottom nav, account and cart links, header and footer of the built-in layouts, blog listing, product detail and cart view.

## Verification
- Real browser, same kind of page: the live store's home page made 25 background page requests (13 unique routes) after scrolling it; the fixed build made 0, and 1 more only for the one link hovered.
- `pnpm typecheck`, lint, web 237 tests; `perf-budget-bundle.int.test.ts` (product page JS 50 KB budget) passes with the change.
- NOT measured: the effect on live timings.

## Trade-offs
- A link's page is no longer fetched in the background before the first hover or touch. The first click on a link nobody hovered (for example a keyboard-free tap on a phone) waits for the page like a normal navigation, with the loading skeleton shown meanwhile.

## Docs updated
- [x] ARCHITECTURE / ADR / DEPLOYMENT: not needed
- [x] `progress.md`

## Definition of done
- [x] After merge: PR recorded, in-flight line removed, branch deleted
