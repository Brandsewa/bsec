import { z } from "zod";
import { createVariant, deleteVariant, setProductOptions, updateVariant, writeAgentAudit } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability } from "../types.ts";
import { Id, MinorUnits, plain } from "./products.ts";
import { loadProduct, shapeProduct, shapeVariant } from "./product-shape.ts";

const Dimensions = z
  .object({ lengthCm: z.number().min(0).max(1000).optional(), widthCm: z.number().min(0).max(1000).optional(), heightCm: z.number().min(0).max(1000).optional() })
  .describe("Package size in centimetres.");

export const listVariantsCap = defineCapability({
  name: "list_variants",
  title: "List a product's variants",
  description: "All variants of one product (a product can have up to 250), with price, SKU, option values, stock tracking and the other variant fields. Use this when get_product says variants were omitted.",
  resource: "products",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ productId: Id, ...pageInput }),
  async handler(env, input) {
    const { limit, offset } = pageParams(input);
    const p = await loadProduct(env, input.productId);
    const page = p.variants.slice(offset, offset + limit).map((v) => shapeVariant(env, v));
    return { currency: env.session.currency, options: p.options.map((o) => ({ name: o.name, values: o.values })), ...toPage(page, p.variants.length, offset, limit) };
  },
});

export const addVariantCap = defineCapability({
  name: "add_variant",
  title: "Add a variant to a product",
  description:
    "Adds one variant (for example a new size) to an existing product, up to 250 per product. The SKU must be unique across the store. For several variants at once from options, use set_product_options. Prices are minor units (paise).",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({
    productId: Id,
    sku: z.string().min(1).max(64),
    title: z.string().min(1).max(120),
    price: MinorUnits,
    compareAtPrice: MinorUnits.optional(),
    costPrice: MinorUnits.optional(),
    barcode: z.string().max(64).optional(),
    weightGrams: z.number().int().min(0).max(1_000_000).optional(),
    dimensions: Dimensions.optional(),
    optionValues: z.record(z.string(), z.string()).optional().describe('For example { "Size": "XL" }; keys are the product\'s option names.'),
    trackInventory: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
    imageMediaId: Id.optional().describe("A library image for this variant (from list_media)."),
  }),
  async handler(env, input) {
    const created = await createVariant(env.rt, env.session.ctx, {
      productId: input.productId,
      sku: input.sku,
      title: plain(input.title),
      price: input.price,
      ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
      ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}),
      ...(input.dimensions ? { dimensions: input.dimensions } : {}),
      ...(input.optionValues ? { optionValues: input.optionValues } : {}),
      ...(input.trackInventory !== undefined ? { trackInventory: input.trackInventory } : {}),
      ...(input.allowBackorder !== undefined ? { allowBackorder: input.allowBackorder } : {}),
      ...(input.imageMediaId ? { imageMediaId: input.imageMediaId } : {}),
    });
    const after = shapeVariant(env, created);
    await writeAgentAudit(env.rt, env.session, { action: "variant.created", targetType: "variant", targetId: created.id, after });
    return after;
  },
});

export const updateVariantCap = defineCapability({
  name: "update_variant",
  title: "Edit a variant",
  description:
    "Changes only the variant fields you pass: SKU, title, price, compare-at price, cost price, barcode, weight, package size, stock tracking, backorders, pre-order settings, the variant's image and its option values. Variant ids come from get_product or list_variants. Pass null to clear compare-at price, cost price, barcode, weight, package size, image or pre-order fields. Prices are minor units (paise).",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({
    id: Id.describe("The variant id."),
    sku: z.string().min(1).max(64).optional(),
    title: z.string().min(1).max(120).optional(),
    price: MinorUnits.optional(),
    compareAtPrice: MinorUnits.nullable().optional(),
    costPrice: MinorUnits.nullable().optional(),
    barcode: z.string().max(64).nullable().optional(),
    weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
    dimensions: Dimensions.nullable().optional(),
    trackInventory: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
    preorderEnabled: z.boolean().optional(),
    preorderShipsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd").nullable().optional(),
    preorderMessage: z.string().max(200).nullable().optional(),
    imageMediaId: Id.nullable().optional().describe("A library image for this variant; null removes it."),
    optionValues: z.record(z.string(), z.string()).nullable().optional(),
  }),
  async handler(env, input) {
    const { id, title, ...rest } = input;
    const updated = await updateVariant(env.rt, env.session.ctx, { id, ...(title !== undefined ? { title: plain(title) } : {}), ...rest });
    const after = shapeVariant(env, updated);
    await writeAgentAudit(env.rt, env.session, { action: "variant.updated", targetType: "variant", targetId: id, after });
    return after;
  },
});

export const deleteVariantCap = defineCapability({
  name: "delete_variant",
  title: "Delete a variant",
  description:
    "Permanently deletes one variant that was never sold. A variant that appears on any order is refused (its history stays), and a product always keeps at least one variant. This cannot be undone; to stop selling a variant that was sold, set its stock to zero or unpublish the product.",
  resource: "products",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id.describe("The variant id.") }),
  async handler(env, input) {
    await deleteVariant(env.rt, env.session.ctx, { id: input.id });
    await writeAgentAudit(env.rt, env.session, { action: "variant.deleted", targetType: "variant", targetId: input.id });
    return { deleted: true, id: input.id };
  },
});

export const setProductOptionsCap = defineCapability({
  name: "set_product_options",
  title: "Set a product's options and build its variants",
  description:
    "Replaces the product's options (up to 3, for example Size and Color, up to 30 values each) and creates the missing variants for every combination, up to 250 variants. Existing variants that still match a combination are kept as they are (price, SKU and stock untouched); variants that match nothing are left alone, never deleted (remove them with delete_variant). New variants get the price you pass or the first variant's price and a generated SKU; edit them afterwards with update_variant.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({
    productId: Id,
    options: z.array(z.object({ name: z.string().min(1).max(40), values: z.array(z.string().min(1).max(60)).min(1).max(30) })).max(3),
    defaultPrice: MinorUnits.optional().describe("Price for the variants this call creates."),
  }),
  async handler(env, input) {
    if (new Set(input.options.map((o) => o.name.toLowerCase())).size !== input.options.length) throw new CapabilityError("invalid_input", "Each option needs a different name.");
    const before = shapeProduct(env, await loadProduct(env, input.productId));
    await setProductOptions(env.rt, env.session.ctx, { productId: input.productId, options: input.options, ...(input.defaultPrice !== undefined ? { defaultPriceMinor: input.defaultPrice } : {}) });
    const after = shapeProduct(env, await loadProduct(env, input.productId));
    await writeAgentAudit(env.rt, env.session, { action: "product.options_set", targetType: "product", targetId: input.productId, before: { options: before.options, variantCount: before.variantCount }, after: { options: after.options, variantCount: after.variantCount } });
    return { id: input.productId, options: after.options, variantCount: after.variantCount, variants: after.variants, variantsOmitted: after.variantsOmitted };
  },
});

export const variantCapabilities = [listVariantsCap, addVariantCap, updateVariantCap, deleteVariantCap, setProductOptionsCap];
