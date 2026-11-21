import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  adjustInventory,
  createProduct,
  getProduct,
  listCategories,
  listInventoryLevels,
  listLocations,
  listMedia,
  listProducts,
  updateProduct,
  updateVariant,
  writeAgentAudit,
} from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { canAccess } from "../policy.ts";
import { descriptionText, pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";

const Id = z.string().uuid();
const Status = z.enum(["draft", "active", "unlisted", "archived"]);
const MinorUnits = z.number().int().min(0).max(1_000_000_000).describe("Money in minor units of the store currency (for example paise: 499.00 rupees is 49900).");

type ProductDetail = Awaited<ReturnType<typeof getProduct>>;

/** The shape the AI sees for one product. Cost price is finance data, so it only appears when finance read is on. */
function shapeProduct(env: CapabilityEnv, p: ProductDetail) {
  const seo = (p.seo ?? {}) as { title?: string; description?: string };
  const showCost = canAccess(env.session, "finance", "read");
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    slug: p.slug,
    shortDescription: p.shortDescription,
    description: descriptionText(p.descriptionJson),
    tags: p.tags,
    productType: p.productType,
    seoTitle: seo.title,
    seoDescription: seo.description,
    primaryCategoryId: p.primaryCategoryId,
    primaryCategoryName: p.primaryCategoryName,
    currency: env.session.currency,
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      ...(showCost ? { costPrice: v.costPrice } : {}),
      trackInventory: v.trackInventory,
    })),
    images: p.media.map((m) => ({ mediaId: m.mediaId, url: m.url, alt: m.alt, primary: m.isPrimary })),
    updatedAt: p.updatedAt,
  };
}

async function snapshot(env: CapabilityEnv, id: string): Promise<ReturnType<typeof shapeProduct> | null> {
  try {
    return shapeProduct(env, await getProduct(env.rt, env.session.ctx, { id }));
  } catch {
    return null;
  }
}

export const listProductsCap = defineCapability({
  name: "list_products",
  title: "List products",
  description: "Search and list products with status, price range and stock. Use get_product for full details of one.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    search: z.string().max(100).optional().describe("Text to look for in the product title."),
    status: Status.optional(),
    stock: z.enum(["in_stock", "low", "out"]).optional(),
    ...pageInput,
  }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const r = await listProducts(rt, session.ctx, { search: input.search, status: input.status, stock: input.stock, limit, offset, sort: "updated_desc" });
    return toPage(
      r.items.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        slug: p.slug,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        currency: session.currency,
        stock: p.stock,
        variantCount: p.variantCount,
        primaryCategoryName: p.primaryCategoryName,
        updatedAt: p.updatedAt,
      })),
      r.total,
      offset,
      limit,
    );
  },
});

export const getProductCap = defineCapability({
  name: "get_product",
  title: "Get a product",
  description: "Everything about one product: description, SEO title and description, variants with prices and SKUs, and images.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler(env, input) {
    return shapeProduct(env, await getProduct(env.rt, env.session.ctx, { id: input.id }));
  },
});

export const listInventoryCap = defineCapability({
  name: "list_inventory",
  title: "List inventory",
  description: "Stock levels by product variant and location. Use stock=low to find products that are running out, stock=out for sold out.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    search: z.string().max(100).optional().describe("Text to look for in the product title or SKU."),
    stock: z.enum(["in_stock", "low", "out"]).optional(),
    ...pageInput,
  }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const r = await listInventoryLevels(rt, session.ctx, { search: input.search, stock: input.stock, limit, offset, sort: "available_asc" });
    return toPage(
      r.items.map((i) => ({
        variantId: i.variantId,
        locationId: i.locationId,
        product: i.productTitle,
        variant: i.variantTitle,
        sku: i.variantSku,
        location: i.locationName,
        onHand: i.onHand,
        reserved: i.reserved,
        available: i.available,
      })),
      r.total,
      offset,
      limit,
    );
  },
});

export const listCategoriesCap = defineCapability({
  name: "list_categories",
  title: "List categories",
  description: "The store's product categories with their ids. A product needs a primary category before it can be published.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ search: z.string().max(100).optional() }),
  async handler({ rt, session }, input) {
    const rows = await listCategories(rt, session.ctx);
    const term = input.search?.toLowerCase();
    return rows
      .filter((c) => !term || c.name.toLowerCase().includes(term))
      .slice(0, 100)
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, productCount: c.productCount }));
  },
});

export const listMediaCap = defineCapability({
  name: "list_media",
  title: "List library images",
  description: "Images already in the store's media library, with ids. Use these ids to attach images to products.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ search: z.string().max(100).optional().describe("Text to look for in the file name."), limit: z.number().int().min(1).max(50).optional() }),
  async handler({ rt, session }, input) {
    const r = await listMedia(rt, session.ctx, { q: input.search, kinds: ["image"], limit: input.limit ?? 20 });
    return r.items.map((m) => ({ id: m.id, name: (m as { filename?: string; name?: string }).filename ?? (m as { name?: string }).name, url: (m as { url?: string }).url, alt: (m as { alt?: string | null }).alt }));
  },
});

const SeoFields = {
  seoTitle: z.string().max(70).optional().describe("Search result title, ideally up to 60 characters."),
  seoDescription: z.string().max(170).optional().describe("Search result description, ideally up to 160 characters."),
};

function seoPatch(current: unknown, input: { seoTitle?: string | undefined; seoDescription?: string | undefined }): Record<string, unknown> | undefined {
  if (input.seoTitle === undefined && input.seoDescription === undefined) return undefined;
  const seo = { ...((current ?? {}) as Record<string, unknown>) };
  if (input.seoTitle !== undefined) seo.title = input.seoTitle;
  if (input.seoDescription !== undefined) seo.description = input.seoDescription;
  return seo;
}

function clean(text: string): string {
  if (/[<>]/.test(text)) throw new CapabilityError("invalid_input", "Descriptions are plain text. Remove any HTML characters (< and >).");
  return text;
}

export const createProductCap = defineCapability({
  name: "create_product",
  title: "Create a product (draft)",
  description: "Creates a new product as a draft with one variant. It is not visible to shoppers until it is published. Prices are in minor units (paise).",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({
    title: z.string().min(1).max(200),
    price: MinorUnits,
    compareAtPrice: MinorUnits.optional(),
    sku: z.string().min(1).max(64).optional().describe("Leave out to generate one."),
    shortDescription: z.string().max(300).optional(),
    description: z.string().max(8000).optional().describe("Plain text."),
    tags: z.array(z.string().max(40)).max(30).optional(),
    primaryCategoryId: Id.optional().describe("From list_categories. Needed before publishing."),
    ...SeoFields,
  }),
  async handler(env, input) {
    const seo = seoPatch(null, input);
    const created = await createProduct(env.rt, env.session.ctx, {
      title: input.title,
      status: "draft",
      ...(input.shortDescription ? { shortDescription: clean(input.shortDescription) } : {}),
      ...(input.description ? { descriptionJson: { type: "text", text: clean(input.description) } } : {}),
      tags: input.tags ?? [],
      ...(input.primaryCategoryId ? { primaryCategoryId: input.primaryCategoryId } : {}),
      ...(seo ? { seo } : {}),
      variants: [
        {
          sku: input.sku ?? `AI-${randomBytes(4).toString("hex").toUpperCase()}`,
          title: "Default",
          price: input.price,
          ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
        },
      ],
    });
    const after = shapeProduct(env, created);
    await writeAgentAudit(env.rt, env.session, { action: "product.created", targetType: "product", targetId: after.id, after });
    return after;
  },
});

export const updateProductCap = defineCapability({
  name: "update_product",
  title: "Edit a product",
  description:
    "Changes the product fields you pass and leaves the rest alone: title, descriptions, tags, SEO title and description, primary category. It does not change status (use publish_product and archive_product) or prices (use update_variant).",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({
    id: Id,
    title: z.string().min(1).max(200).optional(),
    shortDescription: z.string().max(300).optional(),
    description: z.string().max(8000).optional().describe("Plain text."),
    tags: z.array(z.string().max(40)).max(30).optional().describe("Replaces all tags."),
    primaryCategoryId: Id.optional(),
    ...SeoFields,
  }),
  async handler(env, input) {
    const before = await getProduct(env.rt, env.session.ctx, { id: input.id });
    const seo = seoPatch(before.seo, input);
    const updated = await updateProduct(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.shortDescription !== undefined ? { shortDescription: clean(input.shortDescription) } : {}),
      ...(input.description !== undefined ? { descriptionJson: { type: "text", text: clean(input.description) } } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.primaryCategoryId !== undefined ? { primaryCategoryId: input.primaryCategoryId } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapeProduct(env, updated);
    await writeAgentAudit(env.rt, env.session, { action: "product.updated", targetType: "product", targetId: input.id, before: shapeProduct(env, before), after });
    return after;
  },
});

export const updateVariantCap = defineCapability({
  name: "update_variant",
  title: "Change a variant's price or SKU",
  description: "Changes the price, compare-at price or SKU of one variant (get variant ids from get_product). Prices are in minor units (paise).",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({
    id: Id.describe("The variant id."),
    price: MinorUnits.optional(),
    compareAtPrice: MinorUnits.nullable().optional().describe("Null removes the compare-at price."),
    sku: z.string().min(1).max(64).optional(),
  }),
  async handler(env, input) {
    const updated = await updateVariant(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
    });
    const after = { id: updated.id, sku: updated.sku, price: updated.price, compareAtPrice: updated.compareAtPrice };
    await writeAgentAudit(env.rt, env.session, { action: "variant.updated", targetType: "variant", targetId: input.id, after });
    return after;
  },
});

export const setInventoryCap = defineCapability({
  name: "set_inventory",
  title: "Adjust stock",
  description: "Adds or removes stock for a variant by a number (positive adds, negative removes). Get variant and location ids from list_inventory. Leave out locationId to use the first location.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({
    variantId: Id,
    locationId: Id.optional(),
    quantityDelta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Use a number other than 0."),
    reason: z.enum(["received", "damaged", "returned", "correction"]).default("correction"),
    notes: z.string().max(200).optional(),
  }),
  async handler(env, input) {
    let locationId = input.locationId;
    if (!locationId) {
      const locations = await listLocations(env.rt, env.session.ctx, { status: "active" });
      locationId = locations[0]?.id;
      if (!locationId) throw new CapabilityError("not_found", "The store has no stock location yet.");
    }
    await adjustInventory(env.rt, env.session.ctx, { variantId: input.variantId, locationId, quantityDelta: input.quantityDelta, reason: input.reason, ...(input.notes ? { notes: input.notes } : {}) });
    const after = { variantId: input.variantId, locationId, quantityDelta: input.quantityDelta, reason: input.reason };
    await writeAgentAudit(env.rt, env.session, { action: "inventory.adjusted", targetType: "variant", targetId: input.variantId, after });
    return after;
  },
});

async function setStatus(env: CapabilityEnv, id: string, status: "draft" | "active" | "archived", action: string) {
  const before = await snapshot(env, id);
  const updated = await updateProduct(env.rt, env.session.ctx, { id, status });
  const after = shapeProduct(env, updated);
  await writeAgentAudit(env.rt, env.session, { action, targetType: "product", targetId: id, before, after });
  return after;
}

export const publishProductCap = defineCapability({
  name: "publish_product",
  title: "Publish a product",
  description: "Makes a draft or archived product visible to shoppers. The product needs a primary category (list_categories, update_product). Only works when the store allows AI apps to publish.",
  resource: "products",
  action: "write",
  kind: "write",
  publishes: true,
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  handler: (env, input) => setStatus(env, input.id, "active", "product.published"),
});

export const unpublishProductCap = defineCapability({
  name: "unpublish_product",
  title: "Unpublish a product",
  description: "Hides a product from shoppers and returns it to draft. Nothing is deleted.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: true },
  input: z.object({ id: Id }),
  handler: (env, input) => setStatus(env, input.id, "draft", "product.unpublished"),
});

export const archiveProductCap = defineCapability({
  name: "archive_product",
  title: "Archive a product",
  description: "Archives a product: it disappears from the storefront and the product list but is kept and can be restored (set it back to draft with unpublish_product). Nothing is permanently deleted.",
  resource: "products",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: true },
  input: z.object({ id: Id }),
  handler: (env, input) => setStatus(env, input.id, "archived", "product.archived"),
});

export const productCapabilities = [
  listProductsCap,
  getProductCap,
  listInventoryCap,
  listCategoriesCap,
  listMediaCap,
  createProductCap,
  updateProductCap,
  updateVariantCap,
  setInventoryCap,
  publishProductCap,
  unpublishProductCap,
  archiveProductCap,
];
