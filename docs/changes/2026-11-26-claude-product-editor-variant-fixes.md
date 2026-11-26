# Product editor fixes: stale storefront price, split option pickers, variant delete, images before save, description card

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `fix/product-editor-variants` (not merged yet)
- **Area:** web, domain, contracts, admin
- **Type:** fix
- **Supersedes:** none

## Summary
Five owner-reported problems with editing products. A new price saved in the admin did not show on the storefront; a product with two options (Colour and Size) showed one combined choice on the storefront; some variants could not be deleted; images could only be added after a new product was saved; and the long description sat inside General Information instead of below Custom fields.

## What changed
- **Stale price (1).** `apps/web/src/server/runtime.ts` now invalidates with `revalidateTag(tag, { expire: 0 })` instead of `"max"`. With `"max"` Next serves the old cached page to the next visitor while it refreshes in the background (bundled Next docs, `revalidateTag.md`), so the merchant's next look at the product still showed the old price. ADR-004 already says merchant edits are read-your-writes; `updateTag()` is not allowed in Route Handlers, and `{ expire: 0 }` is the documented equivalent there. This applies to every storefront invalidation, not only prices.
- **Combined option list (2).** Root cause: adding a second option to a product that already had variants for the first one (Colour: Red, Blue, then Size: S, M) created four new `Colour / Size` variants and left the old `Red` and `Blue` behind with no Size. Those cannot be reached through a Colour picker plus a Size picker, so `apps/web/src/lib/buy-model.ts` correctly fell back to one combined "Variant" list. New pure planner `packages/contracts/src/variant-grid.ts` (`@bs/contracts/variant-grid`, `planVariantGrid`) extends such variants instead (`Red` becomes `Red / S`, keeping its SKU, price and stock) and only creates what is still missing. `setProductOptions` (`packages/domain/src/catalog/variant-builder.ts`) and the admin preview (`apps/admin/src/lib/variant-grid.ts`) both use it, so "N new will be added" matches what Apply does. A variant whose value is no longer offered is still never moved to another value or deleted.
- **Variant delete (3).** `cart_items.variant_id` is `ON DELETE RESTRICT`, so any variant sitting in a shopper's cart could not be deleted (the merchant got a raw foreign key error). `deleteVariant` now removes those cart lines in the same transaction, and refuses a variant with quote requests with a plain message (also RESTRICT). Sold variants are still refused. The variants table in the admin gains "Delete N" for selected rows and, when variants sit outside the option grid, a warning that names them, says the storefront will show a combined list while they exist, and offers to delete them (existing products broken by bug 2 are fixed this way).
- **Images on a new product (4).** `apps/admin/src/routes/_store/products/new.tsx` has a Media card (same `MediaGalleryField`, in local mode). Picked images show at once and are attached in order right after the product is created; a failed attach is reported and the product still opens.
- **Description position (5).** The long description is its own "Description" card (`DescriptionCard` in `apps/admin/src/components/product/product-cards.tsx`), below Custom fields on the edit page and below Variants on the add page (the add page has no Custom fields card because fields need a saved product).

## Decisions and trade-offs
- `{ expire: 0 }` makes the first storefront request after any edit a blocking render instead of an instant stale one. Merchant edits are rare compared with views, and showing the old price after a save is the worse failure. Worker-side invalidations are unchanged (they cannot revalidate from outside a request either way).
- Cart lines for a deleted variant are removed rather than blocking the delete: nothing was bought, and the alternative left merchants with variants they could never remove.
- The planner lives in `@bs/contracts` (pure, no DB) so the admin preview and the server cannot drift apart again.

## Verification
- Ran: `pnpm turbo run typecheck lint` for `@bs/contracts`, `@bs/domain`, `@bs/admin`, `@bs/web`: pass. `pnpm turbo run build` for `@bs/admin`, `@bs/domain`, `@bs/contracts`: pass. `pnpm docs:check`: pass.
- Ran: `packages/contracts/test/variant-grid.test.ts`: 4 pass. `packages/domain/test/variant-builder.int.test.ts` on real Postgres (`docker-compose.test-db.yml`): 7 pass, including the new "adding a second option extends the existing variants" test and a delete of a variant that is in a cart, run as `app_rw` (RLS on). Both new tests fail against the old code (checked by swapping the old `variant-builder.ts` back in).
- NOT verified: the admin screens and the storefront were not walked in a browser. The local admin was started, but the demo owner's two-step code was not available. To check by hand: edit a variant price and reload the product page once; add Colour then Size and look at the storefront pickers; delete a variant from the table; add images on Add Product before saving; see the Description card under Custom fields.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no routes, tables, jobs or env vars changed)
- [ ] ADR: not needed; the cache change brings the code back in line with ADR-004
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight line)

## Follow-ups and open questions
- Products already showing a combined list on the storefront need the stray variants deleted once (the admin warning offers it) or their options re-applied; nothing is migrated automatically.

## Definition of done
- [x] Code follows section 2 and 3; typecheck, lint, build and docs:check pass for the touched packages.
- [x] Tests added (real-DB test for the variant builder and delete).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [ ] Walked in the browser (not done, see above).
- [ ] After merge: record updated, in-flight line removed, branch and worktree removed.
