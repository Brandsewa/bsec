# Theme page set: collections archive, themed default pages, demo catalog

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `feat/theme-templates` (not merged yet)
- **Area:** blocks, domain, web, admin, platform
- **Type:** feature
- **Supersedes:** none

## Summary
Implements the first slice of `docs/THEME-TEMPLATES-PLAN.md`: a Collection Archive page (`/collections`), a payment-failed page, a themed 404, theme skin and `noindex` on checkout and order pages, a `?variant=` deep link on the product page, and a local catalog fixture for testing the page set through to a placed order.

## What changed
- New theme page `collections` (`collections_archive_template`); `CollectionGrid` gains `showAll` and shows product counts (`packages/blocks`, `packages/domain/src/themes/block-data.ts`). Editor kind `collections`; cache invalidation and media-usage labels know the new type. Modern Commerce theme defines an archive page.
- `apps/web`: `/collections` (+ `loading.tsx`), `/checkout/failed`, `not-found.tsx`; `.bs-skin` on checkout, thank-you and order status; `noindex` on cart, checkout, result and COD pages. `VariantSelector` reads and writes `?variant=` (via `useSyncExternalStore`, no setState in an effect).
- `seedThemeDemoCatalog` + `demo.js seed-catalog`: 6 collections, 14 products (1-3 options, sale prices, sold-out and low-stock variants, long title, draft and archived). No migration, no new env var.

## Decisions and trade-offs
ADR-032. Owner answers (2026-10-15): failure page built now and tested by direct visit; alternates per product/collection deferred (only the option to create one is wanted, not built yet); checkout stays token-only; one theme for now; demo store local only; extras kept.

## Verification
- `test/theme-demo-catalog.int.test.ts` 4/4 on real Postgres: seed, storefront visibility of draft/archived, archive counts, unpublished hidden, other-store isolation, idempotence. `themes.int`, `cache-invalidation`, `storefront-isolation.int` 53/53. `@bs/blocks` 137/137, `@bs/web` 184/184.
- Typecheck: blocks, block-editor, domain, admin clean; web clean except stale generated `.next/dev/types`. ESLint on the changed web files clean.
- By hand on a local database (`bsec_themedemo`, demo store, Next dev server): `/collections` lists 7 collections with counts; variant click updates price (Sand +Rs 200) and URL, deep link restores it; cart, COD checkout with the form filled, thank-you page; order `ORD-00020` grand total 274900 paise (2699 + 50 COD fee); `/checkout/failed?reason=<script>` shows fixed copy and noindex; an unknown product shows the themed 404 with search.
- NOT verified: mobile 375 px, Lighthouse/axe, keyboard-only purchase, checkout validation errors and double-submit (existing suites cover price recompute; not re-run), activating Modern Commerce with the archive page in the UI, `pnpm build`, full `pnpm lint`, `pnpm test:heavy:local`, Docker runtime. The failure page is not linked from checkout yet (online payment is deferred).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 10, last verified)
- [x] ADR-032
- [x] `DEPLOYMENT.md` not needed
- [x] `progress.md`

## Follow-ups and open questions
- Create-an-alternate-template option: needs a page-type convention for alternates and a picker; not built.
- Default-page settings forms in Super Admin (copy and toggles), mini cart drawer, announcement bar, predictive search, free-shipping bar: not built.
- Demo products have no images; add local fixture images.
- A cart-count hydration mismatch exists in `CartBadge` (server 0 vs client count); not touched.

## Definition of done
Partially met: see NOT verified above. Do not merge until the gate in `AGENTS.md` section 4 has run.
