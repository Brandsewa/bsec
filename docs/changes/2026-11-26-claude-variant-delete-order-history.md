# Variants with finished orders can be deleted; orders keep their details

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `fix/variant-delete-order-history` (merged in #338, aa340f80; deployed 2026-11-26)
- **Area:** db, domain, admin
- **Type:** fix
- **Supersedes:** none

## Summary
The owner could not delete a variant after a test order for it had been cancelled and archived. The error said the variant "is on past orders", and the suggested "turn off stock tracking" did not help. The rule refused any variant that appeared on any order, in any state, backed by `order_items.variant_id ... ON DELETE RESTRICT`. Order lines already keep their own copy of what was sold, so history never needed the live variant. A variant can now be deleted once no order still needs it.

## What changed
- **Rule** (`deleteVariant`, `packages/domain/src/catalog/variant-builder.ts`): refused while any order with the variant is in progress (`pending`, `confirmed`, `processing`, `partially_fulfilled`, `fulfilled`), and the message names up to five of those orders. Allowed once every order with it is `cancelled`, `returned` or `delivered` (`VARIANT_DELETE_CLOSED_ORDER_STATUSES`). Archiving an order does not matter; its status does. Never-ordered variants delete as before; quote requests still refuse; a product still keeps at least one variant.
- **Migration `0122_variant_delete_keeps_order_history`** (expand-only): `order_items.variant_id` becomes nullable and is cleared on delete with `ON DELETE SET NULL ("variant_id")`. The line keeps product title, variant title, SKU, HSN, prices, tax and cost, so order pages, invoices and finance read the same.
- **Latent bug fixed in the same migration:** `reviews_variant_fk` and `product_media_variant_fk` said `ON DELETE SET NULL`, but on a two-column key (`tenant_id`, `variant_id`) that clears `tenant_id` too, which is NOT NULL, so deleting any variant with a review failed with a database error. Both are rebuilt with the column list. `tenantForeignKey` now documents this (`packages/db/src/tenant-table.ts`).
- **Code that read the order line's variant** handles the null: a return on a delivered line whose variant is gone is still returnable (refund) but records "no restock" (`manual-lifecycle.ts`, returnable items now left-join variants); restoring a held order to a cart skips such lines; analytics item ids fall back to the SKU/title; invoice and customer-order types allow null. Reports, segments and review "verified purchase" joins simply skip deleted variants.
- **Admin wording:** both delete dialogs now say past orders keep their details and that a variant on an order still in progress cannot be deleted until it is delivered or cancelled.
- Also folds in the docs follow-up for #337 (change record marked merged, its in-flight line removed).

## Decisions and trade-offs
- Hard delete with history kept on the order line, rather than a soft-deleted variant: a `deleted_at` flag would have to be filtered in every catalog, cart, checkout, inventory, export, MCP and feed query, and one missed query would bring a deleted variant back on sale. With a nullable link, the compiler found every reader (9 places).
- `delivered` counts as finished, as on Shopify. A later return of that line refunds but cannot restock a variant that no longer exists. `fulfilled` (shipped, not delivered) does not, because a return-to-origin still needs to restock.
- Same reasoning not yet applied to quote requests (`quote_requests.variant_id` is NOT NULL and RESTRICT); a variant with quotes still refuses with a plain message.

## Verification
- Ran: `pnpm turbo run typecheck` (all 19 tasks) pass; `pnpm docs:check` pass (117 migrations recorded).
- Ran: `packages/domain/test/variant-delete-order-history.int.test.ts` (new) and `variant-builder.int.test.ts` on real Postgres as `app_rw`: 9 pass. Covers refusal naming the in-progress order, delete after a real `cancelAdminOrder`, line kept with `variant_id` null and its SKU, title and price intact, `tenant_id` intact, a review on the variant no longer blocking, and a delivered order: delete allowed and the line still returnable.
- Full domain integration suite (`pnpm test:heavy:local`): 174/174 files pass (two crashed the Windows test worker on the first run and passed on re-run). CI on #338: all checks green.
- NOT verified: the admin dialog in a browser for this change (wording only); production data (no order there is touched by the migration, it only changes constraints).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0122 row)
- [ ] ADR: not needed (no architectural change; a data rule recorded here)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight line)

## Follow-ups and open questions
- 30 other two-column `ON DELETE SET NULL` foreign keys have the same flaw as reviews and product media (for example `categories_image_media_fk`, `products_brand_fk`, `returns_customer_fk`): deleting the parent fails if a child still points at it, unless app code clears the reference first. Worth one migration that rebuilds them all with the column list.
- Quote requests could follow the same rule (allow once the quote is closed).

## Definition of done
- [x] Code follows section 2 and 3; typecheck and docs:check pass.
- [x] Real-DB tests added for the rule and the migration.
- [x] `docs/ARCHITECTURE.md` updated for the new migration.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] After merge: record updated, in-flight line removed, branch and worktree removed.
