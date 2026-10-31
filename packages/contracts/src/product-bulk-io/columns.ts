/**
 * Column registry for product bulk export and import (docs/PRODUCT-BULK-IO-PLAN.md).
 * One registry drives the export header, the import auto-mapping and the mapping UI, so the two sides cannot drift.
 */

export type ColumnGroup = "basics" | "pricing" | "images" | "seo" | "organisation" | "flags";

export interface ColumnDef {
  key: string;
  header: string;
  group: ColumnGroup;
  /** Other header spellings accepted on import (Shopify, WooCommerce). Compared after `normaliseHeader`. */
  aliases: string[];
}

export const PRODUCT_COLUMNS: ColumnDef[] = [
  { key: "handle", header: "URL handle", group: "basics", aliases: ["handle", "slug", "url", "producturl", "permalink"] },
  { key: "title", header: "Title", group: "basics", aliases: ["name", "producttitle"] },
  { key: "shortDescription", header: "Short description", group: "basics", aliases: ["shortdesc", "excerpt", "summary"] },
  { key: "description", header: "Description", group: "basics", aliases: ["bodyhtml", "body", "longdescription"] },
  { key: "status", header: "Status", group: "basics", aliases: ["published", "productstatus"] },
  { key: "primaryCategory", header: "Primary collection", group: "organisation", aliases: ["primarycategory", "category", "categories", "productcategory", "collection"] },
  { key: "tags", header: "Tags", group: "organisation", aliases: ["producttags"] },
  { key: "productType", header: "Product type", group: "organisation", aliases: ["type"] },
  { key: "hsn", header: "HSN", group: "organisation", aliases: ["hsncode"] },
  { key: "option1Name", header: "Option 1 name", group: "pricing", aliases: ["option1"] },
  { key: "option1Value", header: "Option 1 value", group: "pricing", aliases: [] },
  { key: "option2Name", header: "Option 2 name", group: "pricing", aliases: ["option2"] },
  { key: "option2Value", header: "Option 2 value", group: "pricing", aliases: [] },
  { key: "option3Name", header: "Option 3 name", group: "pricing", aliases: ["option3"] },
  { key: "option3Value", header: "Option 3 value", group: "pricing", aliases: [] },
  { key: "sku", header: "Variant SKU", group: "pricing", aliases: ["sku"] },
  { key: "variantTitle", header: "Variant title", group: "pricing", aliases: [] },
  { key: "price", header: "Variant price", group: "pricing", aliases: ["price", "regularprice", "sellingprice"] },
  { key: "compareAtPrice", header: "Compare-at price", group: "pricing", aliases: ["variantcompareatprice", "compareatprice", "mrp", "saleprice"] },
  { key: "costPrice", header: "Cost per item", group: "pricing", aliases: ["cost", "costprice"] },
  { key: "barcode", header: "Variant barcode", group: "pricing", aliases: ["barcode", "gtin"] },
  { key: "weightGrams", header: "Variant weight (g)", group: "pricing", aliases: ["variantgrams", "grams", "weight"] },
  { key: "trackInventory", header: "Track inventory", group: "flags", aliases: ["varianttrackinventory"] },
  { key: "allowBackorder", header: "Allow backorder", group: "flags", aliases: ["backorders"] },
  { key: "imageUrl", header: "Featured image URL", group: "images", aliases: ["imagesrc", "image", "images", "imageurl", "featuredimage"] },
  { key: "additionalImages", header: "Additional image URLs", group: "images", aliases: ["additionalimages", "galleryimages"] },
  { key: "imageAlt", header: "Image alt text", group: "images", aliases: ["imagealttext"] },
  { key: "variantImageUrl", header: "Variant image URL", group: "images", aliases: ["variantimage"] },
  { key: "seoTitle", header: "SEO title", group: "seo", aliases: ["metatitle", "seometatitle"] },
  { key: "seoDescription", header: "SEO description", group: "seo", aliases: ["metadescription", "seometadescription"] },
  { key: "isFeatured", header: "Featured", group: "flags", aliases: ["featuredproduct"] },
  { key: "returnable", header: "Returnable", group: "flags", aliases: [] },
  { key: "requiresShipping", header: "Requires shipping", group: "flags", aliases: ["varianrequiresshipping", "variantrequiresshipping"] },
];

export const CUSTOM_FIELD_PREFIX = "cf:";

export const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Best-guess mapping of file headers to field keys: our own header, an alias, or `cf:<key>` for a custom field
 * (by key or by name). Each field is used at most once (the first column wins); unmatched columns map to null.
 */
export function autoMapHeaders(headers: string[], customFields: Array<{ key: string; name: string }> = []): Array<string | null> {
  const byHeader = new Map<string, string>();
  for (const c of PRODUCT_COLUMNS) {
    byHeader.set(normaliseHeader(c.header), c.key);
  }
  for (const c of PRODUCT_COLUMNS) {
    for (const a of c.aliases) if (!byHeader.has(a)) byHeader.set(a, c.key);
  }
  for (const f of customFields) {
    byHeader.set(normaliseHeader(`${CUSTOM_FIELD_PREFIX}${f.key}`), `${CUSTOM_FIELD_PREFIX}${f.key}`);
    const byName = normaliseHeader(f.name);
    if (!byHeader.has(byName)) byHeader.set(byName, `${CUSTOM_FIELD_PREFIX}${f.key}`);
  }
  const used = new Set<string>();
  return headers.map((h) => {
    const key = byHeader.get(normaliseHeader(h)) ?? null;
    if (!key || used.has(key)) return null;
    used.add(key);
    return key;
  });
}
