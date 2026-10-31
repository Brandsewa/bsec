# Advanced product bulk export and import

- **Date:** 2026-10-31
- **Agent:** claude
- **Branch:** `feat/product-bulk-import-export` (not merged yet)
- **Area:** db, contracts, domain, web (API), admin, worker queue
- **Type:** feature
- **Supersedes:** none

## Summary
Products can now be exported and imported as a full CSV: one row per variant, with description, primary collection, prices, images, SEO, status and custom fields. Export lets the merchant choose the products (all, current filter, selection, categories) and the fields. Import maps columns, previews conflicts, lets the merchant skip, update or replace existing products, downloads image URLs in the background and shows live progress and a problem list. Plan: `docs/PRODUCT-BULK-IO-PLAN.md`.

## What changed
- Migration `0091_product_import_runs` (tenant table, FORCE RLS): progress and errors of each import run.
- `packages/contracts/src/product-bulk-io/` (browser-safe): column registry and aliases, row parser, description cleaner, rich-text helper.
- `packages/domain/src/catalog/bulk-io/`: `export.ts`, `import.ts` (preview, run, batch save), `image-fetch.ts` (SSRF-safe), `image-guard.ts`, `import-images.ts` (worker task).
- Queue `products.import_images` and its handler in `packages/domain/src/jobs.ts`.
- Six `admin.products.*` procedures: `exportRows`, `importPreview`, `importStart`, `importBatch`, `importRun`, `importRuns`.
- Admin: `components/product/bulk/product-export-dialog.tsx` and `product-import-dialog.tsx`, wired into the Products page (the old list-only export is gone).

## Decisions and trade-offs
- "Primary collection" is the product's primary category; unknown names reject the product (owner decision).
- Description and short description are plain text; formatting survives only in rich_text custom fields (owner decision).
- Export needs `exports.run` and the owner/admin role (same rule as finance export, ADR-022).
- Products are saved through the existing catalog services, one product at a time, so a product is not atomic across its steps; a late failure (for example a custom field) leaves the product saved and is listed as a problem.
- Images are matched by content hash, so re-importing never stores a file twice; re-import does download them again.
- A SKU that belongs to another product is always a conflict, whatever the policy.

## Verification
- `pnpm --filter @bs/domain test:fast` 579 pass; real-database: `product-export` 6, `product-import` 10, `product-import-images` 1, `isolation` (with the new procedures) pass; `@bs/db` 47 pass serially; `@bs/admin` 109 pass.
- Lint clean for admin, contracts, domain, db; typecheck clean for contracts, domain, web, admin.
- NOT verified: the dialogs were not driven in a browser; the real https download path (tests use a fake transport); the worker running the queue end to end; `pnpm build`, `pnpm docs:check` and e2e were not run.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (queues, bulk import/export note)
- [x] ADR: not needed (no architectural change; follows ADR-006 and ADR-010)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no env vars or services)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Sweep that marks an import stuck in Running for over 30 minutes as Failed (planned, not built).
- Import history screen beyond the dialog (the API `importRuns` exists).
- Rich formatting of product descriptions on the storefront (needs renderer, editor and JS budget work).
- The worker cannot clear storefront caches, so product pages may show old images until the cache expires.

## Definition of done
Gate partly run (see Verification). No secrets or generated files in the diff.
