# Bulk fixes: storefront polish, custom carousel, all countries and currencies, country-first checkout

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `feat/bulk-fixes-markets-checkout` (not merged yet)
- **Area:** web, blocks, block-editor, admin, domain, contracts
- **Type:** feature
- **Supersedes:** none

## Summary
The owner's 16-item batch. Storefront: quick-view popup no longer sits under page sections, nested menus open as columns, the product gallery stays in view, the mobile menu loses its auto "All ..." links, and a collection's long description is centred (collapsed behind a button on phones). Builder: the product carousel can show hand-picked products. Markets: any country and any currency, no presets, Razorpay (and every activated gateway) offered on every market, full-width Markets settings with paginated variant pricing. Checkout: country chosen first, and the shipping and payment wording, plus payment card logos, are editable.

## What changed
1. **Quick-view popup** (`apps/web/.../CardCartButton.tsx`): the dialog is portalled to `<body>` at z-index 1000, so no ancestor stacking context traps it.
2. **Mega menu** (`packages/blocks/src/views.tsx`, `blocks.css`): a header item whose children have children gets `bsb-has-mega`; the panel spans the header row and each child is a column (up to 6, fewer on narrow screens, via `auto-fill`).
3. **Sticky gallery** (`ProductDetailSection.tsx`): the gallery column is `lg:sticky lg:top-24` inside the existing `items-start` grid.
4. **Mobile nav** (`views.tsx`): the "All {label}" links are gone.
5. **Collection long description** (`CollectionListingSection.tsx`, new `CollapsibleLongDescription.tsx`): `mx-auto` at the existing `max-w-3xl`; on phones a "Learn more about {title}" button toggles it (content stays in the DOM for SEO).
6. **Shipping text**: new "Checkout wording" card in Settings > Checkout (shipping heading, free-shipping label, payment heading). A shipping option's own name and description were already editable per rate under Settings > Shipping; that is unchanged.
7. **Payment text and logos**: new "Checkout appearance" form in the gateway sheet (`apps/admin/src/components/payments/payment-display-form.tsx`): title, subtext, up to six logos picked from the media library, shown on the right of the option. Stored in `store_settings.checkout.display` (no migration).
8. **Carousel** (`registry.ts`, `block-data.ts`, new `ProductsField.tsx`): a tab's source can be "Custom (pick products)"; `productSlugs` (max 24, ordered). The existing `manual` loader already existed server-side. The editor host gained `listProducts`.
9. **No presets** (`add-market-dialog.tsx`): name, countries, currency (suggested from the countries), units follow imperial-using countries.
10. **All countries** (`packages/contracts/src/countries.ts`, subpath `@bs/contracts/countries`): ISO 3166 list with default currency per country. `markets/service.ts` validates against it instead of `platform_countries`.
11. **Razorpay on every market** (`markets/service.ts` `readMarketDetail`): activated gateways with no row for the market now appear (switched off) so they can be enabled. Razorpay in a foreign currency shows a warning (International Payments must be on in the Razorpay dashboard), not a block.
12. **Full-width Markets** (`settings-layout.tsx`): `/settings/markets*` drops the `max-w-3xl` cap.
13. **Pagination** (`market-pricing-tab.tsx`): page size 25/50/100/200, Previous/Next, "x-y of total" (the API already took `offset` and returned `total`).
14. **Country first** (`CheckoutForm.tsx`, `checkout/page.tsx`): with more than one active market a Country card sits above the address. A country in the current market sets the address country; a country in another market goes through `/api/storefront/market/select` and back to `/checkout?country=XX`.
15. **Market-dependent checkout**: because switching reloads the page, shipping rates, payment methods, currency and totals all come from the new market on the server (unchanged rule 12 path). The address-block country dropdown is hidden when the picker is shown.
16. **All currencies** (`money.ts`): `COUNTRY_CURRENCIES` (every currency a country uses), `currencyLabel`, and `minorUnitExponent` falling back to the runtime's ISO data (JPY 0, KWD 3).

## Decisions and trade-offs
- `platform_countries` is left alone: it still gates where a *store* can be based. Enabling every country there would have opened self-service signup everywhere, which is a billing and tax decision for the owner.
- Country names and currency names come from `Intl.DisplayNames`, not a copied table. Only codes and the country-to-currency map are static.
- Checkout wording lives in `store_settings.checkout.display` rather than `payment_methods.public_config` so it needs no connected gateway row and uses the existing audited checkout-settings path (`checkout.manage`).
- Logo URLs are limited to https, same-site paths and localhost (`isSafeLogoUrl`), never `data:` or `javascript:` (rule 8 spirit).

## Verification
- `pnpm typecheck` pass (17/17), `pnpm lint` pass (0 errors; the new warnings match existing patterns).
- `@bs/contracts` 37, `@bs/blocks` 270, `@bs/block-editor` 28, `@bs/domain` `test:fast` 597 pass.
- Real Postgres: `node scripts/test-heavy-local.mjs` ran the whole domain heavy suite: 2863 passed; the one failure was my own test (fixed); `rate-limiting.int.test.ts` crashed its worker once on Windows (exit 3221226505) and passes alone. Re-ran `markets.int.test.ts`, `markets-checkout.int.test.ts`, `rate-limiting.int.test.ts`: 35 pass.
- New tests: `packages/contracts/test/countries.test.ts`, checkout display parsing in `checkout-config.test.ts`, Razorpay-on-an-international-market case in `markets.int.test.ts`.
- `pnpm build`: see the final state in the session report.

NOT verified:
- **No screen was driven in a browser.** Quick-view layering, mega menu columns, sticky gallery, mobile nav, collapse button, country picker, payment logos, full-width markets and pagination are type-checked and unit-tested only.
- `e2e/markets.spec.ts` was edited for the preset-free dialog but not run (e2e runs in CI on `main`); the country multi-select selectors are a best guess.
- A real Razorpay charge in a foreign currency was not attempted (rule 14: sandbox only, no live keys). Razorpay's list of supported currencies was not encoded; the warning is generic.
- Currencies with three decimals (KWD, BHD...) format correctly, but whether each gateway accepts them in that exponent was not checked.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 19, "Last verified")
- [x] ADR: not needed (extends ADR-040 without changing it)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no env, service or pipeline change)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Owner: should self-service signup also open to every country? (`platform_countries` is unchanged.)
- Sanctioned or restricted countries are in the list; the merchant decides whom they ship to via zones.
- Markets whose country has no state list use a free-text region at checkout; no per-country postal rules beyond IN, US, CA.

## Definition of done
- [x] Code follows sections 2 and 3; typecheck, lint and tests above pass; build pending
- [x] Tests added (real-DB for the market gateway change)
- [x] Docs updated
- [x] No secrets, no generated files in the diff
- [ ] After merge: record the PR and commit, remove the in-flight line, delete the branch and worktree
