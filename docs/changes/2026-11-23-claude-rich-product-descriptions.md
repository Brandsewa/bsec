# Rich product descriptions

- **Date:** 2026-11-23
- **Agent:** claude
- **Branch:** `feat/rich-product-descriptions` (stacked on `feat/storefront-seo-gaps`, PR 316; not merged yet)
- **Area:** contracts, domain, web, admin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
A product's long description can now be formatted: headings, paragraphs with bold, italic and links, lists and dividers, like category and collection descriptions. It was one plain textarea, shown clamped behind a "Read more" link. The product page now shows a formatted description in full under the product, where search engines and shoppers read it.

## What changed
- **Storage:** `products.description_json` holds either `{ type: "text", text }` (older and single-paragraph text) or `{ v: 1, blocks }` (validated, no HTML, ADR-010). No migration; both forms are read everywhere.
- **Domain:** `normalizeProductDescription` (`rich-description.ts`) runs on create and update: blocks are validated (an unsafe link is refused), empty content is stored as null, and plain text that uses structure (blank-line paragraphs, `#` headings, `-` or `1.` lists) is turned into blocks. `plainTextOfDescription` reads either form; the page description and Product JSON-LD use it.
- **`@bs/contracts/rich-text`:** `textToRichBlocks`, `textHasStructure`, `richBlocksToText`, `richBlocksToImportText` (pure, shared by the admin and domain).
- **Import and export:** a spreadsheet description with paragraphs, headings or lists becomes blocks on import; export writes blocks back as the same text (bold, italic and links are not carried in a spreadsheet cell).
- **Admin:** the product create and edit screens use the rich editor; an older plain-text description opens as paragraphs, so nothing is lost. The search preview reads the first 160 characters of it.
- **Storefront:** `ProductDetailSection` draws a formatted description under the product ("About this product"); the "Read more" popup still works from its plain text.
- No migration, env var or queue.

## Decisions and trade-offs
- Same block format as categories (no new editor, no HTML), so one renderer and one validator cover products, categories, collections and policies.
- Single-paragraph text stays as text, so a store that never uses the editor sees no change in what is stored.
- A FAQ is a heading and paragraphs; FAQPage markup, pictures in a description and a bulk edit of descriptions are not built.

## Verification
- See the PR description for commands and counts.
- NOT verified: the rich editor on the product screens and the product page in a browser.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (storefront paragraph)
- [x] ADR: not needed (same format as ADR-010 content)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- FAQPage markup, pictures inside a description, bulk edit of descriptions.

## Definition of done
Gate partly run (see PR); no secrets or generated files in the diff.
