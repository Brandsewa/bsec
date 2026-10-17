# Admin and Super Admin polish, phases 2 and 3

- **Date:** 2026-10-17
- **Agent:** claude
- **Branch:** `fix/admin-polish-phase-1` (one branch for the whole round; not merged yet; see also `2026-10-17-claude-admin-polish-phase-1.md`)
- **Area:** db, domain, contracts, blocks, block-editor, ui, admin, superadmin, web, platform
- **Type:** feature
- **Supersedes:** none

## Summary
Builds the rest of `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` after the owner's answers (section 3a): friendly IDs, product media lightbox, payments restructure, domains guide, policy rich text, feature flag retirement, audit log table, tenant purge, storefront categories, the variant builder, shipping zones and tiers, custom fields and promotions. Six migrations (0062 to 0067) and two ADRs (034, 035).

## What changed
- **Friendly IDs (0062):** `BCPID-<n>` per store and `BCSID-<nnnn>` platform-wide; backfilled; shown with a copy button on the product and tenant pages.
- **Media lightbox:** clicking a product image opens a viewer with previous/next and arrow keys.
- **Payments:** page now shows Manual payments and Online gateways; "Add gateway" opens a picker, the chosen gateway becomes a card, Configure opens the (wider) drawer; the webhook URL uses the store's real primary host and has a copy button. Razorpay stays test-mode only.
- **Domains:** setup guide before adding a domain, "Check status" button on pending domains, quiet list refresh every 30 s while waiting for DNS.
- **Policies:** one rich text editor per policy tab; it reads and writes the same validated block format (ADR-010), so versions, preview and publish are unchanged; links limited to https, mailto and tel.
- **Feature flags (0063):** "Make permanent" for release flags, kill switches protected, platform owner can restore, grouped list with a "Show permanent" filter.
- **Audit log (0064):** server pagination, filters (search, dates, archived), row selection, export of the selection, archive/restore (rows are never deleted), detail drawer with before/after and Copy as JSON (secret-looking keys redacted).
- **Tenant purge:** new deletions keep data at least 30 days; only the platform owner can approve the permanent purge (typed confirmation); the approval releases the existing background workflow; deleted stores are hidden from the list by default.
- **Storefront categories:** `/categories` index page; default navigation and starter home page point to it. Block and theme defaults that say `/collections/all` are unchanged (see follow-ups).
- **Blog breadcrumbs:** already present (breadcrumb and `BreadcrumbList` JSON-LD on every post); no change needed.
- **Variant builder:** options editor (3 options, 30 values, 250 variants), generated variant list, per-variant drawer (SKU, barcode, price, compare-at, cost, weight, size, image, stock rules, pre-order), bulk price edit, add and delete variant; new API `products.setOptions`, `variants.create|delete`.
- **Shipping (0065):** several zones with countries and Indian states, flat / free-above / price-tier / weight-tier rates, server-side pricing by cart weight and shipping state, checkout refreshes the options when the state changes, calculator updated. Store-level rates only.
- **Custom fields (0066, ADR-034):** definitions, per-product values, product page card, Settings page, `ProductCustomField` theme block, storefront rendering; Growth plan and above.
- **Promotions (0067, ADR-035):** promotions and grants, promo code at signup, Super Admin Promotions page and Billing tab, term quote preview, hourly end-of-period sweep that suspends unpaid stores after a free period.

## Decisions and trade-offs
- All decisions are in `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` section 3a.
- Product numbers use `max + 1` under an advisory lock, so deleting the newest product can reuse its number.
- The storefront image custom field is only shown when the store has a public media URL.
- Billing is still not live: promotions record the promise and end dates, and the quote is a preview.

## Verification
- Ran locally: `pnpm typecheck` (15/15), `pnpm lint` (15/15), `pnpm build` (6/6), `pnpm docs:check`; per-package tests for ui, admin, blocks, block-editor, contracts; real-database tests for the new work (variant builder, shipping zones, custom fields, promotions, menus, provisioning); see the verification block at the end of this file for the full domain and platform suite results.
- NOT verified: nothing was driven in a browser (no admin, Super Admin or storefront screen was opened), so layouts, drawers, dark-mode borders, the checkout shipping refresh, the lightbox and every new screen are checked by code, types and tests only. No e2e run. Razorpay, Cloudflare and real payments were not exercised.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migrations 0062 to 0067, block types, new section for this round)
- [x] ADR-034 (custom fields), ADR-035 (promotions)
- [x] `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` (decisions)
- [x] `progress.md`

## Follow-ups and open questions
- Custom fields: collection edit page and a collection block, storefront filtering by a field, CSV import/export.
- Promotions: reminder emails 30 and 7 days before a free period ends (email delivery is not live), real billing from the active grant and `quoteTerm`.
- Categories: product grid blocks and theme defaults still link to `/collections/all`; a "category" source for `CollectionGrid` and `ProductGrid` is not built.
- Shipping: PIN ranges are not supported; zones match by country and state only.
- Production data steps (not done): the menu repair happens when each menu is opened; the tenant purge has not been run on any real store.
- Product numbers can be reused after deleting the newest product.
