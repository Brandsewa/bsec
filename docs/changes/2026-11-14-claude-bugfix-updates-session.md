# Storefront bug fixes and footer colour update (session 2026-11-14)

- **Date:** 2026-11-14
- **Agent:** claude
- **Branch:** `fix/storefront-fixes-2026-11-14` (not merged yet)
- **Area:** web, blocks, block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
Three owner-reported issues and one update. After paying on Stripe the shopper was sent to `https://0.0.0.0:3000/...` instead of the order page; the country pop-up opened late; the Product showcase tabs did nothing in the editor preview; and the footer's background presets are replaced by custom colours.

## What changed
### Issues
1. **Stripe return went to `https://0.0.0.0:3000`.** `checkout/return`, `checkout/abandon` (Stripe and PayPal Cancel) and `market/select` built redirects from `req.url`, which behind the proxy is the server's bind address. New `apps/web/src/lib/request-origin.ts` (`publicOrigin`, `publicUrl`) builds the origin from the forwarded host and protocol; the three routes use it. The provider success and cancel URLs were already built from the forwarded host.
2. **Product showcase tabs did nothing in the editor preview.** With no storefront host mounted the tab buttons were plain markup. `packages/blocks/src/views-showcase-tabs-client.tsx` (`ShowcaseTabsPreview`) now switches tabs there (event delegation, no state). The storefront's own `ProductShowcaseClient` was checked with a throwaway DOM test and switches tabs correctly. Note: a "Featured" tab falls back to the newest products when no product is marked featured, so both tabs can look identical on a store with no featured products (existing behaviour in `themes/block-data.ts`, left as is).
3. **Country pop-up opened late.** The pop-up is a separate chunk that was fetched on the click. `FooterMarketSelector.tsx` now prefetches it when the browser is idle and on hover, focus or touch; rows use `content-visibility: auto` so the long list paints fast.

### Update
4. **Footer background presets replaced by custom colours.** The footer panel (`HeaderFooterPanels.tsx`) and the footer block's settings (`config.tsx`) lose the Plain / Soft / Brand / Dark selector and gain a background colour and a text colour (the schema already had `bgColor` and `textColor`). Only a background set: the text turns black or white for contrast. The newsletter field and Subscribe button are drawn from the same two colours (`footerColors` in `views.tsx`, `.bsb-site-footer-news` rules in `blocks.css`) so they stay visible on any background. No schema change, so no block version bump: old footers keep their saved `tone` and look the same until a colour is chosen. The header's background selector is untouched.

## Decisions and trade-offs
- Kept `tone` in the footer schema so saved footers render unchanged (expand/migrate/contract); it is simply no longer editable.
- Tab preview is a tiny client wrapper instead of making the preview mount the storefront host.

## Verification
- Ran: `pnpm typecheck` pass; `pnpm lint` pass (warnings only); `pnpm build` pass; `pnpm docs:check` ok; `pnpm gate:quick` pass (pre-push hook); `@bs/blocks` 283 pass; `@bs/block-editor` 28 pass; `@bs/web` checkout, request-origin and production-bundle budget tests pass (budget test run after the build).
- New tests: `apps/web/test/request-origin.test.ts`, `packages/blocks/test/footer-colours-and-showcase-preview.test.tsx`.
- Exercised by hand: nothing. Docker was not running, so there was no live storefront, editor or Stripe return to drive.
- NOT verified: the redirect behind the live proxy and a real Stripe payment; the footer panel and colour picker in the browser; the country pop-up speed; the carousel tabs in the editor.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure, route, table or env change)
- [x] ADR: not needed (no architectural decision)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md`: not needed

## Follow-ups and open questions
- Owner to confirm the carousel issue was the editor preview. If the storefront tabs also fail on the live store, send the store and page and it will be traced against real data.
- Merged at the owner's request when CI is green; watch the `main` deploy and retest a Stripe payment.

## Definition of done
Gate (typecheck, lint, build, docs:check, affected tests) passes locally; tests added; no secrets or generated files in the diff.
