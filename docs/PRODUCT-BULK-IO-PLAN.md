# Product bulk export and import (plan)

Status: plan, not built. Owner request 2026-10-31. Replaces today's list-only CSV export (`apps/admin/src/routes/_store/products/index.tsx`, `EXPORT_HEADER`) and the disabled "Import" button.

## 1. Where we are

- Export is client-side, one row per product (title, slug, status, price range, stock, tags). It cannot round-trip: no variants, images, SEO, description, categories or custom fields.
- Import does not exist. Customers have a working pattern to copy: `packages/domain/src/customers/import.ts` (preview, commit, inline up to 500 rows, pg-boss job above that) and `ImportDialog` in `apps/admin/src/routes/_store/customers.tsx`.

## 2. File format (Shopify-style: one row per variant, extra rows for images)

Header names are stable and also accepted on import in a case-insensitive form.

| Column | Maps to | Notes |
|---|---|---|
| `URL handle` | `products.slug` | Row key. Rows with the same handle form one product. Blank handle on a continuation row = same product as the row above |
| `Title` | `products.title` | Required on the first row of a product |
| `Short description` | `shortDescription` | Plain text |
| `Description` | `descriptionJson` (`{type:"text"}`) | Plain text only. HTML is stripped, never stored (ADR-010) |
| `Primary category` | `product_categories` (isPrimary) | Matched by name or slug. Unknown name = row error, or "create missing" switch |
| `Other categories`, `Collections` | cross tables | Pipe-separated names |
| `Status` | `status` | draft, active, unlisted, archived. Active needs a primary category (existing rule) |
| `Tags`, `Product type`, `Brand`, `HSN` | product fields | Tags comma-inside-quotes or pipe separated |
| `Option 1..3 name / value` | `product_options`, `variants.optionValues` | |
| `Variant SKU` | `variants.sku` | Unique per store. Secondary match key |
| `Variant title` | `variants.title` | Auto-built from option values if blank |
| `Variant price`, `Compare-at price`, `Cost per item` | `variants.*` | Major units in the store currency (499.00), converted with `toMinorUnits`. Never trusted for checkout (rule 12) |
| `Variant barcode`, `Variant weight (g)` | variants | |
| `Track inventory`, `Allow backorder` | variants | yes/no |
| `Featured image URL` | `product_media` position 0 | https URL |
| `Additional image URLs` | `product_media` | Pipe separated, in order |
| `Image alt text` | `product_media.alt` | |
| `Variant image URL` | `variants.imageMediaId` | |
| `SEO title`, `SEO description` | `products.seo` | |
| `Featured`, `Returnable`, `Requires shipping` | flags | |
| `cf:<key>` (one column per custom field) | `custom_field_values` | Only when the plan has custom fields (Growth+). Typed by the definition: text, number, boolean, dropdown value, multi-select pipe list, image URL |

Prices are written without currency symbols; formula-looking cells are neutralised on export (existing `lib/csv.ts`).

## 3. Export

- Dialog on Products > Export: **Scope** (all products / current filter / selected / by category, multi-select) and **Fields** (All fields / Choose fields with grouped checkboxes: Basics, Pricing and variants, Images, SEO, Categories, Custom fields). Remembers the last choice per browser.
- New read procedure `admin.products.exportRows({ filter, categoryIds, cursor, limit })` returns fully expanded products (variants, images, categories, collections, custom field values) one page at a time with a keyset cursor. The browser stitches pages into the CSV, so memory stays bounded and no file is stored on our side. Permission: `products.read`; the CSV-export owner/admin-only rule from ADR-022 applies.
- Above about 20,000 variants the job path writes to the existing `exports` table instead (follow-up, not v1).

## 4. Import

Flow (dialog, four steps): **Upload** (CSV, UTF-8, up to 10,000 rows, template download) > **Map columns** > **Preview** > **Result**.

1. **Map columns.** Auto-matches headers to the table above (our names, Shopify and WooCommerce names). Every unmatched column can be mapped to a built-in field, a custom field, or skipped. The mapping is remembered per store in localStorage. Unmapped custom-field columns offer "map to custom field X".
2. **Mode.** Create only, Update only, or Create and update (default). Match key: URL handle, falling back to SKU. Update touches only columns present in the file (blank cell = leave alone; the literal `[clear]` empties a field).
3. **Preview (dry run).** Server validates everything and returns counts (to create, to update, unchanged, invalid) plus row-numbered errors and warnings, and a downloadable error CSV. Nothing is written.
4. **Commit.** Products are grouped by handle in the browser and sent in batches of 50 to `admin.products.importCommit`. Each product is one transaction; one bad product never blocks the others. Audit row per product (`product.created` / `product.updated`, `diff.source = "import"`) plus one `product.import_committed` summary.
5. **Images.** Commit saves the product with `pending` images and enqueues one pg-boss job `products.import-images` per product after commit (ADR-006). The worker downloads each URL and attaches it. Failures are listed in the Result step and the audit log; the product stays live without that image.

Image download safety (this is the risky part, hard rules 7, 8, 9):
- https only; resolve DNS ourselves and refuse private, loopback, link-local and metadata ranges (also after every redirect, max 3); pin the resolved IP for the request (no DNS rebinding).
- Timeout 15 s, max 10 MB, no cookies or auth headers, fixed user agent.
- Content is sniffed, not trusted from the header: only JPEG, PNG, WebP, GIF, AVIF. SVG refused (same as `uploadMediaDirect`).
- Goes through `uploadMediaDirect`-equivalent so quota (`assertMediaUploadQuota`), hashing and derivatives apply. Dedupe by source URL (stored on the media row `metadata`) and by content hash, so re-running an import never duplicates images.
- Per-store concurrency 3, per-host 2.

Other practices included: dry-run preview, idempotent re-imports, row-level error report, stable round-trip (an exported file re-imports as "no changes"), UTF-8 BOM and Excel-safe export, blank-vs-clear semantics, row cap, quota check up front (`assertProductQuota` for the creates in the file), no price/stock changes unless the columns are mapped, inventory never imported in v1.

## 5. Work breakdown

1. `packages/contracts`: `exportRows`, `importPreview`, `importCommit` schemas.
2. `packages/domain/src/catalog/bulk-io/`: `columns.ts` (column registry shared by export and import), `export.ts`, `import.ts` (normalise, validate, upsert), `image-fetch.ts` (SSRF-safe fetcher), job `products.import-images` (+ `packages/db/src/queues.ts`).
3. `apps/web/src/server/api.ts` handlers; `isolation.int.test.ts` mapping for every new `admin.*` procedure.
4. Admin UI: `ExportDialog`, `ImportDialog` with mapping table (kit components only, `admin-ui-standards.md`).
5. Tests: unit (CSV parsing, column matching, price conversion, SSRF guard with a table of hostile URLs), real-DB (upsert by handle and SKU, tenant isolation, quota, round trip), UI route test.
6. Docs: `ARCHITECTURE.md` (job, procedures, folder), change record, `progress.md`.

One new tenant table, `product_import_runs` (migration 0091, expand-only, FORCE RLS), holds progress and errors for each import (section 7). Estimated 5 slices; items 1 to 3 first, UI last.

## 7. Progress, errors and conflicts (owner request 2026-10-31)

Image downloads make an import slow, so the dialog never blocks on them.

**Progress screen.** Commit creates a `product_import_runs` row and the dialog switches to a progress view that polls it every 2 s (and can be reopened later from Products > Import history, so closing the tab loses nothing). It shows two bars: *Products* (`productsDone / productsTotal`) and *Images* (`imagesDone / imagesTotal`, with failed count), live counters (created, updated, skipped, failed) and a status line (Running, Completed, Completed with errors, Failed). Products are live as soon as their row is saved; images appear as each download finishes.

**Errors.** The run keeps the first 1,000 problems as `{ row, handle, kind: row | conflict | image, message }` (`errors_truncated` counts the rest). The Result view lists them in a table with filter by kind, and **Download error CSV** returns the failing rows with an added `Error` column so the file can be fixed and re-imported as is.

**Conflicts.** The preview detects, per product, (a) the URL handle already exists, (b) a SKU already belongs to a different product. The merchant picks one policy for the run, with the counts shown next to each option:
- **Skip existing** (safest): conflicting products are left untouched and listed as skipped.
- **Update existing** (default): only the columns present in the file are changed; blank cells keep current values. Variants are matched by SKU; new SKUs are added; variants missing from the file are kept.
- **Replace existing**: the product is rewritten from the file, including clearing fields the file leaves blank; variants and images not in the file are removed. Needs a confirm dialog that states the count, because it deletes data. Variants that have orders are never deleted (they are archived by the existing rules) and are reported as a warning.
A SKU that belongs to a *different* product is always a conflict error for that product (never silently moved), whatever the policy.

Progress rows are written after commit by the request and by the `products.import-images` worker (ADR-006). Retries are idempotent (image dedupe by source URL), and a run stuck in Running for over 30 minutes is marked Failed by the sweep so the screen never spins forever.

## 6. Decisions for the owner

1. **"Primary Collection".** The product model has a *primary category* (required to publish) and separate *collections*. The plan exports and imports both (`Primary category`, `Collections`). Say if you meant collections only.
2. **Unknown category or collection names in a file:** reject the row (default) or create them automatically.
3. **Image-fetch scope:** any public https host (default, needed for Shopify/Woo exports), or an allow-list.
4. **Description (decided 2026-10-31):** Description and Short description are plain text (HTML from Shopify is converted to text; paragraph breaks and `- ` lists kept). Formatting (headings, lists, bold, italic) is kept only for `rich_text` custom fields, via `toRichTextHtml` and the existing field sanitiser.
5. **Primary collection (decided):** one column, mapped to the primary category. Unknown names reject the product.
