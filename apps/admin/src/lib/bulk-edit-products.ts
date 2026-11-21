import type { ProductDetail } from "@bs/contracts";
import type { client } from "./orpc.ts";
import { editKey, parseDecimal, parseMoney, parseTags, parseWhole, slugify, type Edits } from "./bulk-edit.ts";

export type BulkProductPayload = Parameters<typeof client.admin.products.bulkUpdate>[0]["items"][number];
type Item = BulkProductPayload;

/**
 * Turns the grid's raw edits into the `products.bulkUpdate` payload. Errors are keyed like the edits
 * (`${targetId}|${field}`) so each cell can show its own message and the save is blocked while any remain.
 */
export function buildProductItems(products: ProductDetail[], edits: Edits, currency: string, cfTypes: Record<string, string> = {}): { items: Item[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const items: Item[] = [];
  const ev = (target: string, field: string) => edits[editKey(target, field)];
  const str = (target: string, field: string) => {
    const v = ev(target, field);
    return typeof v === "string" ? v : undefined;
  };

  for (const p of products) {
    const product: NonNullable<Item["product"]> = {};
    const fail = (target: string, field: string, msg: string) => {
      errors[editKey(target, field)] = msg;
    };

    const title = str(p.id, "title");
    if (title !== undefined) {
      if (!title.trim()) fail(p.id, "title", "A title is required");
      else product.title = title.trim();
    }
    const slug = str(p.id, "slug");
    if (slug !== undefined) {
      const s = slugify(slug);
      if (!s) fail(p.id, "slug", "A URL handle is required");
      else product.slug = s;
    }
    const status = str(p.id, "status");
    if (status) product.status = status as NonNullable<Item["product"]>["status"];
    const short = str(p.id, "shortDescription");
    if (short !== undefined) product.shortDescription = short;
    const desc = str(p.id, "description");
    if (desc !== undefined) product.descriptionJson = { type: "text", text: desc.trim() };
    const tags = str(p.id, "tags");
    if (tags !== undefined) product.tags = parseTags(tags);
    const type = str(p.id, "productType");
    if (type !== undefined) product.productType = type.trim();
    const brand = str(p.id, "brandId");
    if (brand !== undefined) product.brandId = brand || null;
    const hsn = str(p.id, "hsn");
    if (hsn !== undefined) product.hsn = hsn.trim() || null;
    const tax = str(p.id, "taxClassId");
    if (tax !== undefined) product.taxClassId = tax || null;
    for (const f of ["isFeatured", "returnable", "requiresShipping", "priceOnRequest"] as const) {
      const v = ev(p.id, f);
      if (typeof v === "boolean") product[f] = v;
    }

    const seoT = str(p.id, "seoTitle");
    const seoD = str(p.id, "seoDescription");
    if (seoT !== undefined || seoD !== undefined) {
      const cur = (p.seo ?? {}) as { title?: string | null; description?: string | null };
      product.seo = { title: (seoT ?? cur.title ?? "").trim() || null, description: (seoD ?? cur.description ?? "").trim() || null };
    }

    // The API rebuilds all category links when either field is sent, so send both from current state.
    const primary = str(p.id, "primaryCategoryId");
    const extra = ev(p.id, "extraCategoryIds");
    if (primary !== undefined || Array.isArray(extra)) {
      const nextPrimary = primary !== undefined ? primary || null : (p.primaryCategoryId ?? null);
      product.primaryCategoryId = nextPrimary;
      product.extraCategoryIds = (Array.isArray(extra) ? extra : p.extraCategoryIds).filter((id) => id !== nextPrimary);
    }
    const cols = ev(p.id, "collectionIds");
    if (Array.isArray(cols)) product.collectionIds = cols;

    const variants: NonNullable<Item["variants"]> = [];
    for (const v of p.variants) {
      const patch: NonNullable<Item["variants"]>[number] = { id: v.id };
      const sku = str(v.id, "sku");
      if (sku !== undefined) {
        if (!sku.trim()) fail(v.id, "sku", "A SKU is required");
        else patch.sku = sku.trim();
      }
      const barcode = str(v.id, "barcode");
      if (barcode !== undefined) patch.barcode = barcode.trim() || null;

      const price = str(v.id, "price");
      if (price !== undefined) {
        const r = parseMoney(price, currency);
        if (!r.ok) fail(v.id, "price", r.error);
        else if (r.value === null) fail(v.id, "price", "A price is required");
        else patch.price = r.value;
      }
      for (const [field, key] of [["compareAtPrice", "compareAtPrice"], ["costPrice", "costPrice"]] as const) {
        const t = str(v.id, field);
        if (t === undefined) continue;
        const r = parseMoney(t, currency);
        if (!r.ok) fail(v.id, field, r.error);
        else patch[key] = r.value;
      }
      const stock = str(v.id, "stock");
      if (stock !== undefined) {
        const r = parseWhole(stock, 10_000_000);
        if (!r.ok || r.value === null) fail(v.id, "stock", r.ok ? "Enter a quantity" : r.error);
        else patch.stockOnHand = r.value;
      }
      for (const f of ["trackInventory", "allowBackorder"] as const) {
        const b = ev(v.id, f);
        if (typeof b === "boolean") patch[f] = b;
      }
      const weight = str(v.id, "weightGrams");
      if (weight !== undefined) {
        const r = parseWhole(weight, 1_000_000);
        if (!r.ok) fail(v.id, "weightGrams", r.error);
        else patch.weightGrams = r.value;
      }
      const dimEdited = (["lengthCm", "widthCm", "heightCm"] as const).some((f) => str(v.id, f) !== undefined);
      if (dimEdited) {
        const cur = (v.dimensions ?? {}) as Record<string, number | undefined>;
        const dims: Record<string, number> = {};
        for (const f of ["lengthCm", "widthCm", "heightCm"] as const) {
          const t = str(v.id, f);
          const r = t !== undefined ? parseDecimal(t, 1000) : ({ ok: true, value: cur[f] ?? null } as const);
          if (!r.ok) fail(v.id, f, r.error);
          else if (r.value !== null && r.value > 0) dims[f] = r.value;
        }
        patch.dimensions = Object.keys(dims).length ? dims : null;
      }
      if (Object.keys(patch).length > 1) variants.push(patch);
    }

    const customFields: Record<string, unknown> = {};
    for (const key of Object.keys(edits)) {
      const [target, field] = key.split("|");
      if (target !== p.id || !field?.startsWith("cf:")) continue;
      const raw = edits[key];
      const defId = field.slice(3);
      if (typeof raw === "string" && raw.trim() === "") customFields[defId] = null;
      else if (cfTypes[defId] === "number" && typeof raw === "string") {
        const r = parseDecimal(raw, 1_000_000_000);
        if (!r.ok) errors[key] = r.error;
        else customFields[defId] = r.value;
      } else customFields[defId] = raw;
    }

    if (Object.keys(product).length === 0 && variants.length === 0 && Object.keys(customFields).length === 0) continue;
    items.push({
      id: p.id,
      ...(Object.keys(product).length ? { product } : {}),
      ...(variants.length ? { variants } : {}),
      ...(Object.keys(customFields).length ? { customFields } : {}),
    });
  }
  return { items, errors };
}
