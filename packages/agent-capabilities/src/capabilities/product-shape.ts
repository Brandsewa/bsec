import { getProduct } from "@bs/domain";
import { canAccess } from "../policy.ts";
import type { CapabilityEnv } from "../types.ts";

export type ProductDetail = Awaited<ReturnType<typeof getProduct>>;

/** Variants returned inside one product result; a product can have up to 250, so more come from list_variants. */
export const VARIANTS_IN_PRODUCT = 40;

/** Text of a stored description. Plain descriptions are `{ type: "text", text }`; rich ones (editor blocks) are flattened to their text. */
export function plainTextOf(value: unknown, max = 4000): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, max);
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (parts.join(" ").length > max) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      for (const [k, child] of Object.entries(o)) if (k !== "text") walk(child);
    }
  };
  walk(value);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** plain: written by the AI or imported as text; rich: formatted in the admin editor (replacing it with plain text loses the formatting). */
export function descriptionFormat(value: unknown): "none" | "plain" | "rich" {
  if (!value) return "none";
  const t = (value as { type?: unknown }).type;
  return t === "text" ? "plain" : "rich";
}

/** One variant as the AI sees it. Cost price is finance data: it only appears when finance read is on. */
export function shapeVariant(env: CapabilityEnv, v: ProductDetail["variants"][number]) {
  const showCost = canAccess(env.session, "finance", "read");
  return {
    id: v.id,
    sku: v.sku,
    title: v.title,
    optionValues: v.optionValues,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    ...(showCost ? { costPrice: v.costPrice } : {}),
    barcode: v.barcode,
    weightGrams: v.weightGrams,
    dimensions: v.dimensions,
    trackInventory: v.trackInventory,
    allowBackorder: v.allowBackorder,
    preorderEnabled: v.preorderEnabled || undefined,
    preorderShipsOn: v.preorderShipsOn,
    preorderMessage: v.preorderMessage,
    imageMediaId: v.imageMediaId,
    position: v.position,
  };
}

/** Everything about one product that the admin product page can edit, in one shape. */
export function shapeProduct(env: CapabilityEnv, p: ProductDetail) {
  const seo = (p.seo ?? {}) as { title?: string; description?: string };
  return {
    id: p.id,
    productNumber: p.productNumber,
    title: p.title,
    slug: p.slug,
    status: p.status,
    publishedAt: p.publishedAt,
    shortDescription: p.shortDescription,
    description: plainTextOf(p.descriptionJson),
    descriptionFormat: descriptionFormat(p.descriptionJson),
    tags: p.tags,
    productType: p.productType,
    brandId: p.brandId,
    taxClassId: p.taxClassId,
    hsn: p.hsn,
    requiresShipping: p.requiresShipping,
    isFeatured: p.isFeatured,
    priceOnRequest: p.priceOnRequest || undefined,
    returnable: p.returnable,
    seoTitle: seo.title,
    seoDescription: seo.description,
    primaryCategoryId: p.primaryCategoryId,
    primaryCategoryName: p.primaryCategoryName,
    extraCategoryIds: p.extraCategoryIds,
    collectionIds: p.collectionIds,
    currency: env.session.currency,
    options: p.options.map((o) => ({ name: o.name, values: o.values })),
    variantCount: p.variants.length,
    variants: p.variants.slice(0, VARIANTS_IN_PRODUCT).map((v) => shapeVariant(env, v)),
    variantsOmitted: Math.max(0, p.variants.length - VARIANTS_IN_PRODUCT) || undefined,
    images: p.media.map((m) => ({ productMediaId: m.id, mediaId: m.mediaId, url: m.url, alt: m.alt, primary: m.isPrimary, position: m.position })),
    updatedAt: p.updatedAt,
  };
}

export async function loadProduct(env: CapabilityEnv, id: string): Promise<ProductDetail> {
  return getProduct(env.rt, env.session.ctx, { id });
}

/** The product as it is now, or null when it cannot be read (used for the "before" in the audit trail). */
export async function snapshot(env: CapabilityEnv, id: string): Promise<ReturnType<typeof shapeProduct> | null> {
  try {
    return shapeProduct(env, await loadProduct(env, id));
  } catch {
    return null;
  }
}
