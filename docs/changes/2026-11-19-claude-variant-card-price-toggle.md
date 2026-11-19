# Variant cards: 3px gap and a show-prices setting

- **Date:** 2026-11-19
- **Agent:** claude
- **Branch:** `fix/variant-card-price-toggle` (pushed straight to `main` at the owner's request)
- **Area:** blocks, block-editor, web
- **Type:** feat
- **Supersedes:** none

## Summary
Follow-up to the Cards variant style (#288). The variant name and its prices on a card now have 3px between them. New product page setting "Cards: show prices (off shows the name only)" (`showVariantPrice`, default on). With it off the card shows the picture and the name; the Save % badge stays under its own toggle.

## What changed
- `VariantCards.tsx`: `gap-[3px]` between name and prices; prices hidden when `showPrice === false`.
- `showVariantPrice` in the ProductDetail schema (optional with a default, so no block version bump), types, defaults, editor field, `ProductDetailSection`, and the editor sample (`views-product-sample-client.tsx`, CSS gap).
- Test: `product-page-settings.test.tsx` covers the default and the off value.

## Decisions and trade-offs
- The badge is independent of the price toggle: a store can show the name and badge only.

## Verification
- Typecheck (blocks, block-editor, web, domain), lint (0 errors) and `@bs/blocks` tests pass; `perf-budget-bundle` passes after a production build (3 tests).
- NOT verified in a browser.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure, table, route or env change)
- [ ] ADR / `DEPLOYMENT.md` / `progress.md`: not needed

## Follow-ups and open questions
- None.

## Definition of done
Gate in `AGENTS.md` section 4 run before the push; no secrets or generated files.
