# ADR-034: Custom fields on products and collections

- **Status:** Accepted
- **Date:** 2026-10-17
- **Plan reference:** `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` (F-03), ADR-009, ADR-010, ADR-033

## Context
Store owners want their own information on products (for example "Ingredients" or "Origin"), filled in per product and shown on product pages through the theme builder. ADR-010 forbids merchant-controlled code or raw HTML on our servers, so a field system must store typed, validated data, not templates or scripts.

## Decision
1. **Definitions and values are tenant data.** `custom_field_definitions` (resource type `product` or `collection`, a permanent `key`, name, type, help text, required, show-on-storefront, options for dropdown types, position, archived) and `custom_field_values` (one typed JSON value per definition and product or collection). Both are `tenantTable`s with forced RLS and composite tenant foreign keys; values reference products and collections with `ON DELETE CASCADE`, definitions cascade to their values (migration 0066).
2. **Types:** text, rich text, image, dropdown, multi-select, number, yes/no. The key and type never change after creation, so stored values stay valid. Archiving hides a field everywhere but keeps its values.
3. **Validation is in the domain, per type** (`packages/domain/src/catalog/custom-field-rules.ts`): text up to 500 characters; rich text goes through the same strict sanitiser as the blog (`sanitizeBlogHtml`, no embedded images) on save **and** again on read; image values are a media id that must belong to the same store (tracked in `media_usages` as `product` or `collection` field `custom.<key>`); dropdown and multi-select values must be defined options; required fields are enforced on save.
4. **Plan gate:** available from the Growth plan up (`plans.features.custom_fields`, set by migration 0066). No limit on the number of fields beyond 50 per resource type. Stores without the feature see an upgrade message and the storefront serves no values.
5. **Theme builder binding:** a new block `ProductCustomField` (version 1; props `fieldKey`, `showLabel`, `label`) for product pages only. The storefront draws it from the product's server-loaded values (`getStorefrontCustomFields`, cached under the product tags); it draws nothing when the product has no value. Editors and previews show a labelled sample.
6. **Audit and cache:** definition and value changes write `audit_logs`; saves invalidate the product (or collection) cache tags.

## Consequences
- Owners get Shopify-metafield style fields without any merchant code on the server.
- Collections have the schema, service and plan gate, but the collection edit page and a collection block are not built yet; storefront filtering by a custom field is also not built (both are listed in `progress.md`).
- Adding a field type means a CHECK-constraint migration, a rule in `custom-field-rules.ts`, an input in the admin card and a case in the storefront renderer.

## Alternatives considered
- **Free-form JSON or key/value pairs:** no validation, no types, no UI. Rejected.
- **Typed columns per field (EAV with one column per type):** more rigid for little gain at this scale. Rejected.
- **A theme "dynamic source" that accepts templates:** conflicts with ADR-010. Rejected; the block only names a field key.
