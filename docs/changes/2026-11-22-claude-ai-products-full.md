# AI access: the whole product can be read, added, changed and (reversibly) removed

- **Date:** 2026-11-22
- **Agent:** claude
- **Branch:** `feat/ai-products-full` (not merged yet)
- **Area:** agent-capabilities, domain (usage meter list)
- **Type:** feature
- **Supersedes:** none

## Summary
The first real Claude chat connection worked, but the product tools covered only a few fields. Every product field and sub-detail the admin product page has is now mapped (`docs/MCP-PRODUCTS-MAP.md`) and available to the AI: slug, descriptions, tags, product type, brand, tax class, HSN, shipping and returns flags, featured, price on request, SEO, primary and extra categories, collections, custom fields, options, variants (all fields), images (add, alt text, reorder, remove) and stock.

## What changed
- New and expanded tools (`packages/agent-capabilities/src/capabilities/`): `get_product` returns the full product; `create_product` takes options with variants, slug, brand, tax class, categories, collections and library images; `update_product` edits every product-level field; new `list_variants`, `add_variant`, `update_variant` (all variant fields), `delete_variant`, `set_product_options`, `set_product_collections` (add, remove or replace), `get_product_custom_fields`, `set_product_custom_fields`, `add_product_image`, `update_product_image`, `reorder_product_images`, `remove_product_image`, plus read tools `list_brands` and `list_tax_classes`; `list_products` filters by category.
- The "delete" cell now also governs `delete_variant` and `remove_product_image` (both destructive). `archive_product` stays the only way to remove a whole product; permanent product delete is still not offered (earlier owner decision).
- Database errors (duplicate slug or SKU, missing referenced id) now come back as plain sentences; the usage meter counts the new writes.
- A description formatted in the admin editor is read as text and is not overwritten by plain text unless `confirmReplaceFormatting` is passed.
- Tests: `packages/agent-capabilities/test/products-full.int.test.ts` (real database: create with options and variants, edit every field, variants add, edit and delete, options, collections, publish, archive, error messages, delete cell, formatted description guard).

## Decisions and trade-offs
- Sub-details can be deleted (variant, image link) under the delete cell because they are part of editing a product, and the store's own rules protect history (sold variants and the last variant cannot be deleted; image files stay in the library).
- Collections membership uses add and remove so the AI never has to resend the whole list (the underlying service replaces it).
- Cost price is read only with Finance read on, but may be written with product write.

## Verification
- Ran: `tsc` and eslint on agent-capabilities and domain (clean); `registry.test.ts` 15 and `mcp.test.ts` 7 pass; real database (local Postgres, `TEST_DATABASE_URL_SUPERUSER`): `agent-capabilities` suites 26 pass (including 5 new whole-product tests), `pnpm gate:quick` runs at push.
- Found while testing: a fast sequence of writes hits the Growth limit of 20 writes per minute per store ("Too many AI changes in a short time"). The product tests lift that limit with a test-only helper (`@bs/domain/test-support`, `setQuotaOverrideForTest`); the real limit is unchanged. A chat session pauses between calls, so normal use stays under it, but a long edit session can brush it; raise `ai_writes_min_store` in Super Admin quotas if merchants hit it.
- NOT verified: against the real Claude chat or the production store; the heavy domain suite was not re-run for this change (it only adds capability code and one test-only export).

## Docs updated
- [x] `docs/MCP-PRODUCTS-MAP.md` (new), `docs/ARCHITECTURE.md` section 24
- [x] ADR not needed (extends ADR-050)
- [x] `progress.md`

## Follow-ups and open questions
- Not covered: state and market pricing, bulk edit in one call, creating categories and brands, image by URL, permanent product delete (owner decision).

## Definition of done
Gate steps run before the PR is opened.
