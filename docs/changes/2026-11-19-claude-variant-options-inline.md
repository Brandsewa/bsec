# Variant options on one row, two cards on desktop, smaller card image

- **Date:** 2026-11-19
- **Agent:** claude
- **Branch:** `fix/variant-options-inline`
- **Area:** web, blocks
- **Type:** feat
- **Supersedes:** none

## Summary
Owner follow-up on the variant picker (#288, #289). Every style (pills, buttons, dropdown, cards) now shows the option name and its choices on one row: "Type:" on the left, the choices to its right. The selected value is no longer repeated next to the name. Desktop shows two cards by default again (tablet keeps three, phones two), with the existing slider for more. The card picture is 28px (was 36px).

## What changed
- `VariantSelector.tsx` `VariantOptions`: a two-column grid (name column as wide as the longest name, so choices line up); the label no longer shows the chosen value.
- `VariantCards.tsx`: `sm:max-lg:` three per row (tablet only), 28px picture.
- `blocks.css` and `views-product-sample-client.tsx`: the editor sample follows (row layout, two on desktop, smaller picture, no value after the name).

## Decisions and trade-offs
- On a 375px phone the name column takes about 50px, so two cards are about 140px wide; names truncate rather than wrap.

## Verification
- Typecheck (blocks, web), lint (0 errors), `@bs/blocks` tests (286) and `@bs/web` tests (272) pass.
- In a browser on local demo data: desktop two cards (253px, 47px tall, 28px picture) with the slider arrow, tablet three, phone two with the name on the same row, no sideways scroll.
- NOT verified in a browser: the pills, buttons and dropdown styles (same grid, not opened).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`, ADR, `DEPLOYMENT.md`, `progress.md`: not needed (no structure, table, route or env change)

## Follow-ups and open questions
- None.

## Definition of done
Gate (`pnpm gate:quick`) before the push; no secrets or generated files.
