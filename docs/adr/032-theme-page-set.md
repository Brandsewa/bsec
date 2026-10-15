# ADR-032: Theme page set, template pages and default pages

- **Status:** Accepted
- **Date:** 2026-10-15
- **Plan reference:** docs/THEME-TEMPLATES-PLAN.md

## Context
A theme defined home, collection, product, cart, header and footer. There was no list-of-collections page, and checkout, order result, failure and 404 pages carried no theme styling. Merchants must be able to restyle the catalog pages, but the pages that take money must not be editable into a broken state.

## Decision
- Two kinds of theme page. **Template pages** are block documents stored as `pages` rows (types in `THEME_SYSTEM_PAGES`): home, collections archive (`collections_archive_template`), collection, product, cart, header, footer. **Default pages** (checkout, order success, order status, payment failed, search, 404) are fixed storefront code styled only through the theme's `--bs-*` tokens via the `.bs-skin` wrapper; they are not block-editable and have no `pages` row.
- The archive reuses the `CollectionGrid` block with an additive `showAll` prop (default false, so the block version is unchanged) that lists every published collection with a product count for manual collections. With no archive template the storefront renders the same block as a built-in default.
- Cart, checkout and every result page are `noindex`. The failure page shows only fixed copy chosen by a reason code and never echoes the query string.
- Alternate templates per product or collection are **not** part of this decision; the owner deferred them (2026-10-15).

## Consequences
Old stores keep working: a store with no archive page row falls back to the default. Activating a theme that lacks an archive unpublishes a previous theme's archive (existing loop over `THEME_SYSTEM_PAGE_KEYS`). Adding another template page means one entry in `THEME_SYSTEM_PAGES`, a label, an editor kind and a cache-invalidation case.

## Alternatives considered
- Make checkout block-editable: rejected, it widens the security and conversion risk of the one page that takes payment (Shopify locks it for the same reason).
- A dedicated `CollectionsArchive` block: rejected, `CollectionGrid` already renders the cards.
