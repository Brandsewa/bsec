# Product import: the primary collection is optional

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `fix/import-optional-collection` (merged in #PR_NUMBER)
- **Area:** domain (catalog bulk-io), admin
- **Type:** fix
- **Supersedes:** the "unknown collection rejects the product" rule in `2026-10-31-claude-product-bulk-import-export.md` (owner decision, 2026-11-02); the rest of that record stands

## Summary
Importing about 100 products with 200+ images worked, except products whose primary collection was blank or did not match an existing category, which failed. People import from other systems, so collection names rarely match. The collection is now optional: the product is imported either way.

## What changed
- `packages/domain/src/catalog/bulk-io/import.ts`:
  - A blank or unmatched collection no longer fails the product. It is created without a collection and a notice ("Collection X was not found, so the product was imported without a collection") is added to the run's problem list. Notices do not count as failures, so a run with only notices ends as Completed.
  - A product meant to be live (active or unlisted) but without a collection is saved as a draft, with a notice, because the catalog needs a primary collection to publish. Adding a collection later and publishing it works as usual.
  - Updating an existing product that has no collection never tries to publish it; its status is left as it was, with a notice.
  - The preview counts such products as importable and lists the notice; it no longer reports them as skipped.
- `apps/admin/src/components/product/bulk/product-import-dialog.tsx`: wording on the upload and review steps; notes are shown whenever there are any.
- `docs/PRODUCT-BULK-IO-PLAN.md` (decisions 2 and 5) and `docs/ARCHITECTURE.md` updated.

## Decisions and trade-offs
- Draft instead of live is the safe default: publishing without a collection is blocked by an existing catalog rule, and a bulk import must not override it. The alternative (loosen that rule) was not taken; it would change storefront behaviour for all products.
- Matching is unchanged (name or slug, case-insensitive). Collections are never created automatically.

## Verification
- Ran: `product-import` real-database tests (12, including blank collection, unknown collection, live product without a collection saved as draft, update without a collection), domain typecheck, `pnpm gate:quick`.
- NOT verified: driven by hand in the admin after this change; production.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (bulk import section)
- [x] plan: `docs/PRODUCT-BULK-IO-PLAN.md`
- [ ] ADR / DEPLOYMENT: not needed
- [ ] `progress.md`: not needed (no in-flight claim; merged in the same PR)

## Follow-ups and open questions
- Optional later: an "assign this collection to products without one" choice in the import dialog.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
