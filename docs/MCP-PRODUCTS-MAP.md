# Products over MCP: what the AI can read, add, change and delete

Status: built on `feat/ai-products-full` (2026-11-22). Request: map every option of a product so the AI can add, update or delete all of it. Source of truth for what exists: the product admin screens and `packages/domain` services; the AI tools are in `packages/agent-capabilities/src/capabilities/products.ts`, `product-variants.ts`, `product-media.ts`. Everything goes through the same domain services as the admin, so rules (quota, unique slug and SKU, "a published product needs a primary category", sold variants cannot be deleted) apply unchanged.

Permission cells (Settings > AI access > Permissions): **Read** = products.read, **Write** = create and edit, **Delete** = remove sub-details that cannot be undone and archive (see the last section). Publishing also needs the "Allow publishing" switch.

## 1. Product fields

| Field (admin name) | Read | Add | Update | Remove / clear | Tool | Notes |
|---|---|---|---|---|---|---|
| Title | yes | yes | yes | n/a | `get_product`, `create_product`, `update_product` | |
| URL handle (slug) | yes | yes | yes | n/a | same | lowercase letters, numbers, hyphens; duplicates answer "slug already used"; changing it changes the web address |
| Status (draft, active, unlisted, archived) | yes | draft only | publish, unpublish, archive | archive | `publish_product` (needs the publish switch), `unpublish_product`, `archive_product` | `unlisted` is not offered to the AI |
| Short description | yes | yes | yes | clear with empty text | `update_product` | plain text, at most 300 characters |
| Description | yes (plain text) | yes | yes | | `create_product`, `update_product` | plain text only (no HTML). A description formatted in the admin editor is read as text and is **not replaced** unless `confirmReplaceFormatting: true` |
| Tags | yes | yes | yes (replaces all) | pass `[]` | `update_product` | up to 30 |
| Product type | yes | yes | yes | null | same | |
| Brand | yes (id) | yes | yes | null | same; `list_brands` finds ids | |
| Tax class | yes (id) | yes | yes | null | same; `list_tax_classes` finds ids | needs the user to hold settings.read |
| HSN code | yes | yes | yes | null | same | |
| Requires shipping, Returnable, Featured, Price on request | yes | yes | yes | n/a | same | |
| SEO title and SEO description | yes | yes | yes | | same | 70 and 170 characters |
| Primary category | yes | yes | yes | null | same; `list_categories` finds ids | a product needs one before it can be published |
| Extra categories | yes | yes | yes (replaces) | pass `[]` | same | |
| Collections | yes | yes | add, remove, or replace | remove | `set_product_collections`; `list_collections` finds ids | only manual collections hold products by hand |
| Custom fields (Growth and above) | yes | yes | yes | null | `get_product_custom_fields`, `set_product_custom_fields` | values are checked by the store's own field types |
| Product number, created and updated times, ratings | yes | system | system | n/a | `get_product` | read only |

## 2. Options and variants

| Detail | Read | Add | Update | Delete | Tool |
|---|---|---|---|---|---|
| Options (up to 3, 30 values each, for example Size, Color) | yes | yes | yes | replace the list | `set_product_options` builds missing combinations and keeps existing variants untouched |
| Variants (up to 250 per product) | `get_product` (first 40), `list_variants` (all, paged) | `add_variant` or `create_product` with `variants` | `update_variant` | `delete_variant` | |
| SKU | yes | yes (unique per store) | yes | | duplicates answer "SKU already used" |
| Variant title and option values | yes | yes | yes | | |
| Price, compare-at price | yes | yes | yes | compare-at: null | minor units (paise) |
| Cost price | read only when Finance read is on | yes | yes | null | |
| Barcode, weight, package size (cm) | yes | yes | yes | null | |
| Track inventory, allow backorder | yes | yes | yes | | |
| Pre-order (on, ships on, message) | yes | | yes | null | |
| Variant image | yes (id) | yes | yes | null | media id from `list_media` |
| Stock per location | `list_inventory` | | `set_inventory` (add or remove a number) | | |

## 3. Images

| Detail | Tool |
|---|---|
| See a product's images, with `productMediaId` | `get_product` |
| Find images already in the media library | `list_media` |
| Attach a library image (with alt text) | `add_product_image` or `create_product` with `imageMediaIds` |
| Change alt text | `update_product_image` |
| Reorder (first is the main image) | `reorder_product_images` |
| Remove from the product (file stays in the library) | `remove_product_image` |

Uploading a new image file is not possible over MCP (no file upload); images must already be in the library. Image by URL is a later feature (needs the safe download pipeline).

## 4. What "delete" means

- **Product:** archive only (`archive_product`), reversible. Permanent deletion of a product is **not** offered to the AI, by the owner's earlier decision (nothing is permanently deleted by an AI app); it stays a human action in the admin.
- **Variant:** `delete_variant` deletes it for good, but the store's own rules refuse it when the variant is on any order and when it is the product's last variant.
- **Image:** `remove_product_image` only detaches it; the file stays in the library.
- Collections, categories, brands, tax classes, pricing by state or market, discounts and bulk edit are separate areas (collections already have tools; the others are not covered yet).

## 5. Not covered yet (candidates for a next round)

State pricing and market pricing per variant; product reviews; bulk edit of many products in one call (the AI repeats single edits; write limits apply); creating categories, brands and collections beyond the existing collection tools; image by URL; permanent product delete (owner decision needed).

## 6. Safeguards that apply to every tool above

Every change is recorded in the audit log as made by the AI app with the values before and after; writes count against the daily write limit; text fields refuse HTML; new products are always drafts; a duplicate slug or SKU, a missing id and a store rule that blocks the change each come back as a plain sentence the AI can relay.
