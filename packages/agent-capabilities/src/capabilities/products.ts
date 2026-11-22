import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  adjustInventory,
  attachProductMedia,
  createProduct,
  getResourceCustomFields,
  listBrands,
  listCategories,
  listInventoryLevels,
  listLocations,
  listMedia,
  listProducts,
  listTaxClasses,
  setResourceCustomFields,
  updateProduct,
  writeAgentAudit,
} from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { descriptionFormat, loadProduct, shapeProduct, snapshot } from "./product-shape.ts";

export const Id = z.string().uuid();
const Status = z.enum(["draft", "active", "unlisted", "archived"]);
export const MinorUnits = z.number().int().min(0).max(1_000_000_000).describe("Money in minor units of the store currency (for example paise: 499.00 rupees is 49900).");

const SeoFields = {
  seoTitle: z.string().max(70).optional().describe("Search result title, ideally up to 60 characters."),
  seoDescription: z.string().max(170).optional().describe("Search result description, ideally up to 160 characters."),
};

export function seoPatch(current: unknown, input: { seoTitle?: string | undefined; seoDescription?: string | undefined }): Record<string, unknown> | undefined {
  if (input.seoTitle === undefined && input.seoDescription === undefined) return undefined;
  const seo = { ...((current ?? {}) as Record<string, unknown>) };
  if (input.seoTitle !== undefined) seo.title = input.seoTitle;
  if (input.seoDescription !== undefined) seo.description = input.seoDescription;
  return seo;
}

export function plain(text: string): string {
  if (/[<>]/.test(text)) throw new CapabilityError("invalid_input", "Text is plain text. Remove any HTML characters (< and >).");
  return text;
}

const Slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, for example blue-cotton-shirt.");

// ---------------------------------------------------------------- reads

export const listProductsCap = defineCapability({
  name: "list_products",
  title: "List products",
  description: "Search and list products with status, price range and stock. Use get_product for everything about one product.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    search: z.string().max(100).optional().describe("Text to look for in the product title."),
    status: Status.optional(),
    stock: z.enum(["in_stock", "low", "out"]).optional(),
    categoryId: Id.optional().describe("Only products in this category (from list_categories)."),
    ...pageInput,
  }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const r = await listProducts(rt, session.ctx, { search: input.search, status: input.status, stock: input.stock, categoryId: input.categoryId, limit, offset, sort: "updated_desc" });
    return toPage(
      r.items.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
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
  description:
    "Everything about one product: title, slug, status, descriptions, tags, product type, brand, tax class, HSN, shipping and returns flags, SEO title and description, categories, collections, options, variants (up to 40; use list_variants for more) and images with their ids.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler(env, input) {
    return shapeProduct(env, await loadProduct(env, input.id));
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

export const listBrandsCap = defineCapability({
  name: "list_brands",
  title: "List brands",
  description: "The store's brands with their ids, to set a product's brand.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ search: z.string().max(100).optional() }),
  async handler({ rt, session }, input) {
    const rows = await listBrands(rt, session.ctx, input.search ? { search: input.search } : undefined);
    return rows.slice(0, 100).map((b) => ({ id: b.id, name: b.name, slug: b.slug }));
  },
});

export const listTaxClassesCap = defineCapability({
  name: "list_tax_classes",
  title: "List tax classes",
  description: "The store's tax classes with their rates, to set a product's tax class.",
  resource: "products",
  action: "read",
  kind: "read",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({}),
  async handler({ rt, session }) {
    const rows = await listTaxClasses(rt, session.ctx);
    return rows.map((t) => ({ id: t.id, name: t.name, rateBps: t.rateBps, isDefault: t.isDefault }));
  },
});

export const listMediaCap = defineCapability({
  name: "list_media",
  title: "List library images",
  description: "Images already in the store's media library, with ids. Use these ids to attach images to products (add_product_image) or variants.",
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

export const getProductCustomFieldsCap = defineCapability({
  name: "get_product_custom_fields",
  title: "Get a product's custom fields",
  description: "The store's own product fields (Growth plan and above) with their current values for one product. Each field has an id, a label, a type and, for dropdowns, its options.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id.describe("The product id.") }),
  async handler({ rt, session }, input) {
    return getResourceCustomFields(rt, session.ctx, { resourceType: "product", resourceId: input.id });
  },
});

// ---------------------------------------------------------------- writes: product level

const OptionInput = z.object({ name: z.string().min(1).max(40), values: z.array(z.string().min(1).max(60)).min(1).max(30) });

const VariantInput = z.object({
  sku: z.string().min(1).max(64).optional().describe("Leave out to generate one."),
  title: z.string().min(1).max(120).optional().describe("Leave out to build it from the option values."),
  price: MinorUnits,
  compareAtPrice: MinorUnits.optional(),
  costPrice: MinorUnits.optional(),
  barcode: z.string().max(64).optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  optionValues: z.record(z.string(), z.string()).optional().describe("For example { \"Size\": \"M\", \"Color\": \"Blue\" }; keys are the option names."),
  trackInventory: z.boolean().optional(),
  allowBackorder: z.boolean().optional(),
});

export const createProductCap = defineCapability({
  name: "create_product",
  title: "Create a product (draft)",
  description:
    "Creates a new product as a draft; it is not visible to shoppers until published. Give either `price` for a single-variant product, or `options` with `variants` for a product with sizes, colours and so on. Everything else is optional and can be edited later: slug, descriptions, tags, SEO, brand, tax class, HSN, shipping and returns flags, categories, collections and images (media ids). Prices are minor units (paise).",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({
    title: z.string().min(1).max(200),
    slug: Slug.optional().describe("The URL handle. Leave out to build it from the title."),
    price: MinorUnits.optional().describe("For a product with one variant. Not used when `variants` is given."),
    compareAtPrice: MinorUnits.optional(),
    sku: z.string().min(1).max(64).optional().describe("SKU of the single variant. Leave out to generate one."),
    options: z.array(OptionInput).max(3).optional().describe("Up to 3 options, for example Size and Color."),
    variants: z.array(VariantInput).min(1).max(100).optional().describe("One entry per combination when options are given."),
    shortDescription: z.string().max(300).optional(),
    description: z.string().max(8000).optional().describe("Plain text."),
    tags: z.array(z.string().max(40)).max(30).optional(),
    productType: z.string().max(80).optional(),
    brandId: Id.optional().describe("From list_brands."),
    taxClassId: Id.optional().describe("From list_tax_classes."),
    hsn: z.string().max(20).optional(),
    requiresShipping: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    priceOnRequest: z.boolean().optional(),
    returnable: z.boolean().optional(),
    primaryCategoryId: Id.optional().describe("From list_categories. Needed before publishing."),
    extraCategoryIds: z.array(Id).max(20).optional(),
    collectionIds: z.array(Id).max(50).optional().describe("Collections to put the product in (from list_collections)."),
    imageMediaIds: z.array(Id).max(20).optional().describe("Library images to attach, first one is the main image (from list_media)."),
    ...SeoFields,
  }),
  async handler(env, input) {
    const variants = input.variants ?? (input.price !== undefined ? [{ price: input.price, compareAtPrice: input.compareAtPrice, sku: input.sku }] : null);
    if (!variants) throw new CapabilityError("invalid_input", "Give a price (single variant) or a list of variants with options.");
    if (variants.length > 1 && (!input.options || input.options.length === 0)) throw new CapabilityError("invalid_input", "A product with several variants needs options (for example Size) so each variant says which combination it is.");
    const seo = seoPatch(null, input);
    const optionNames = (input.options ?? []).map((o) => o.name);
    const created = await createProduct(env.rt, env.session.ctx, {
      title: input.title,
      ...(input.slug ? { slug: input.slug } : {}),
      status: "draft",
      ...(input.shortDescription ? { shortDescription: plain(input.shortDescription) } : {}),
      ...(input.description ? { descriptionJson: { type: "text", text: plain(input.description) } } : {}),
      tags: input.tags ?? [],
      ...(input.productType ? { productType: input.productType } : {}),
      ...(input.brandId ? { brandId: input.brandId } : {}),
      ...(input.taxClassId ? { taxClassId: input.taxClassId } : {}),
      ...(input.hsn ? { hsn: input.hsn } : {}),
      ...(input.requiresShipping !== undefined ? { requiresShipping: input.requiresShipping } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.priceOnRequest !== undefined ? { priceOnRequest: input.priceOnRequest } : {}),
      ...(input.returnable !== undefined ? { returnable: input.returnable } : {}),
      ...(input.primaryCategoryId ? { primaryCategoryId: input.primaryCategoryId } : {}),
      ...(input.extraCategoryIds ? { extraCategoryIds: input.extraCategoryIds } : {}),
      ...(input.collectionIds ? { collectionIds: input.collectionIds } : {}),
      ...(seo ? { seo } : {}),
      ...(input.options && input.options.length ? { options: input.options.map((o) => ({ name: o.name, values: o.values })) } : {}),
      variants: variants.map((v, i) => {
        const vv = v as z.infer<typeof VariantInput> & { title?: string | undefined };
        const combo = vv.optionValues ? optionNames.map((n) => vv.optionValues?.[n]).filter(Boolean).join(" / ") : "";
        return {
          sku: vv.sku ?? `AI-${randomBytes(4).toString("hex").toUpperCase()}`,
          title: vv.title ?? (combo || (variants.length === 1 ? "Default" : `Variant ${i + 1}`)),
          price: vv.price,
          ...(vv.compareAtPrice !== undefined ? { compareAtPrice: vv.compareAtPrice } : {}),
          ...(vv.costPrice !== undefined ? { costPrice: vv.costPrice } : {}),
          ...(vv.trackInventory !== undefined ? { trackInventory: vv.trackInventory } : {}),
          ...(vv.allowBackorder !== undefined ? { allowBackorder: vv.allowBackorder } : {}),
          ...(vv.optionValues ? { optionValues: vv.optionValues } : {}),
        };
      }),
    });
    for (const mediaId of input.imageMediaIds ?? []) await attachProductMedia(env.rt, env.session.ctx, { productId: created.id, mediaId });
    const after = shapeProduct(env, await loadProduct(env, created.id));
    await writeAgentAudit(env.rt, env.session, { action: "product.created", targetType: "product", targetId: after.id, after });
    return after;
  },
});

export const updateProductCap = defineCapability({
  name: "update_product",
  title: "Edit a product",
  description:
    "Changes only the product fields you pass: title, slug, descriptions, tags, product type, brand, tax class, HSN, shipping and returns flags, featured, price on request, SEO title and description, primary category and extra categories. Pass null to clear brand, tax class, HSN or product type. `extraCategoryIds` replaces the extra categories. Does not change status (publish_product, unpublish_product, archive_product), variants (update_variant, add_variant), options, images or collections (set_product_collections). Changing a slug changes the product's web address.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({
    id: Id,
    title: z.string().min(1).max(200).optional(),
    slug: Slug.optional(),
    shortDescription: z.string().max(300).optional(),
    description: z.string().max(8000).optional().describe("Plain text. If the current description was formatted in the admin editor, also pass confirmReplaceFormatting."),
    confirmReplaceFormatting: z.boolean().optional().describe("Set true to replace a formatted description by this plain text."),
    tags: z.array(z.string().max(40)).max(30).optional().describe("Replaces all tags."),
    productType: z.string().max(80).nullable().optional(),
    brandId: Id.nullable().optional(),
    taxClassId: Id.nullable().optional(),
    hsn: z.string().max(20).nullable().optional(),
    requiresShipping: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    priceOnRequest: z.boolean().optional(),
    returnable: z.boolean().optional(),
    primaryCategoryId: Id.nullable().optional().describe("Null removes the primary category (a published product needs one)."),
    extraCategoryIds: z.array(Id).max(20).optional().describe("Replaces the extra categories."),
    ...SeoFields,
  }),
  async handler(env, input) {
    const before = await loadProduct(env, input.id);
    if (input.description !== undefined && descriptionFormat(before.descriptionJson) === "rich" && !input.confirmReplaceFormatting) {
      throw new CapabilityError("conflict", "This product's description is formatted (headings, bold, lists) in the admin editor. Replacing it with plain text removes that formatting. Pass confirmReplaceFormatting: true to go ahead.");
    }
    const seo = seoPatch(before.seo, input);
    const updated = await updateProduct(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.shortDescription !== undefined ? { shortDescription: plain(input.shortDescription) } : {}),
      ...(input.description !== undefined ? { descriptionJson: { type: "text", text: plain(input.description) } } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.productType !== undefined ? { productType: input.productType ?? "" } : {}),
      ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
      ...(input.taxClassId !== undefined ? { taxClassId: input.taxClassId } : {}),
      ...(input.hsn !== undefined ? { hsn: input.hsn } : {}),
      ...(input.requiresShipping !== undefined ? { requiresShipping: input.requiresShipping } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.priceOnRequest !== undefined ? { priceOnRequest: input.priceOnRequest } : {}),
      ...(input.returnable !== undefined ? { returnable: input.returnable } : {}),
      ...(input.primaryCategoryId !== undefined ? { primaryCategoryId: input.primaryCategoryId } : {}),
      ...(input.extraCategoryIds !== undefined ? { extraCategoryIds: input.extraCategoryIds } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapeProduct(env, updated);
    await writeAgentAudit(env.rt, env.session, { action: "product.updated", targetType: "product", targetId: input.id, before: shapeProduct(env, before), after });
    return after;
  },
});

export const setProductCollectionsCap = defineCapability({
  name: "set_product_collections",
  title: "Change a product's collections",
  description: "Adds the product to some collections and/or removes it from others, leaving its other collections alone. Or pass `replaceWith` to set the exact list. Only manual collections hold products by hand. Collection ids come from list_collections.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z
    .object({
      id: Id.describe("The product id."),
      add: z.array(Id).max(50).optional(),
      remove: z.array(Id).max(50).optional(),
      replaceWith: z.array(Id).max(50).optional().describe("The complete list of collections; cannot be combined with add or remove."),
    })
    .refine((v) => v.replaceWith === undefined || (v.add === undefined && v.remove === undefined), "Use replaceWith alone, or add and remove."),
  async handler(env, input) {
    const before = await loadProduct(env, input.id);
    let next: string[];
    if (input.replaceWith) next = [...new Set(input.replaceWith)];
    else {
      const removal = new Set(input.remove ?? []);
      next = [...new Set([...before.collectionIds, ...(input.add ?? [])])].filter((c) => !removal.has(c));
    }
    const updated = await updateProduct(env.rt, env.session.ctx, { id: input.id, collectionIds: next });
    const after = shapeProduct(env, updated);
    await writeAgentAudit(env.rt, env.session, { action: "product.collections_changed", targetType: "product", targetId: input.id, before: { collectionIds: before.collectionIds }, after: { collectionIds: after.collectionIds } });
    return { id: input.id, collectionIds: after.collectionIds };
  },
});

export const setProductCustomFieldsCap = defineCapability({
  name: "set_product_custom_fields",
  title: "Set a product's custom fields",
  description: "Sets values of the store's own product fields (Growth plan and above). `values` maps a field id (from get_product_custom_fields) to its value; a null clears the field. Values are checked against each field's type.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id.describe("The product id."), values: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 50, "Pass between 1 and 50 fields.") }),
  async handler(env, input) {
    const before = await getResourceCustomFields(env.rt, env.session.ctx, { resourceType: "product", resourceId: input.id });
    const after = await setResourceCustomFields(env.rt, env.session.ctx, { resourceType: "product", resourceId: input.id, values: input.values });
    await writeAgentAudit(env.rt, env.session, { action: "product.custom_fields_set", targetType: "product", targetId: input.id, before: before.fields, after: after.fields });
    return after;
  },
});

// ---------------------------------------------------------------- stock and status

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
  listBrandsCap,
  listTaxClassesCap,
  listMediaCap,
  getProductCustomFieldsCap,
  createProductCap,
  updateProductCap,
  setProductCollectionsCap,
  setProductCustomFieldsCap,
  setInventoryCap,
  publishProductCap,
  unpublishProductCap,
  archiveProductCap,
];
