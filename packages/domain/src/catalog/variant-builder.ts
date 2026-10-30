import { and, asc, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { syncMediaUsages } from "../media-services.ts";
import { loadProductDetailInternal } from "../catalog-services.ts";
import { syncVariantMarketPrices } from "../markets/service.ts";
import {
  MAX_VARIANTS_PER_PRODUCT,
  comboTitle,
  nextSku,
  normalizeOptions,
  optionCombinations,
  sameCombo,
  type OptionInput,
} from "./variant-options.ts";

type VariantRow = typeof schema.variants.$inferSelect;

function toVariant(row: VariantRow) {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    barcode: row.barcode,
    title: row.title,
    optionValues: row.optionValues as Record<string, string> | null,
    price: Number(row.price),
    compareAtPrice: row.compareAtPrice ? Number(row.compareAtPrice) : undefined,
    costPrice: row.costPrice ? Number(row.costPrice) : undefined,
    weightGrams: row.weightGrams,
    dimensions: row.dimensions as Record<string, unknown> | null,
    trackInventory: row.trackInventory,
    allowBackorder: row.allowBackorder,
    preorderEnabled: row.preorderEnabled,
    preorderShipsOn: row.preorderShipsOn ? String(row.preorderShipsOn).slice(0, 10) : null,
    preorderMessage: row.preorderMessage,
    position: row.position,
    imageMediaId: row.imageMediaId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function audit(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContext,
  action: string,
  targetId: string,
  diff: Record<string, unknown>,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "product",
    targetId,
    diff,
  });
}

export interface SetProductOptionsInput {
  productId: string;
  options: OptionInput[];
  /** Price (paise) for variants created by this change. Defaults to the product's first variant price. */
  defaultPriceMinor?: number | undefined;
}

/**
 * Replaces a product's options and brings its variants in line (the variant builder):
 *  - variants whose option values match a combination are kept as they are (price, SKU, stock untouched);
 *  - a product that had no options and one variant keeps that variant as the first combination;
 *  - missing combinations get new variants with generated SKUs;
 *  - variants that match no combination are left alone (never deleted here) so no order history or stock is lost;
 *    they show in the admin as "not in the option grid" and can be deleted by hand.
 * Limits: 3 options, 30 values each, 250 variants per product.
 */
export async function setProductOptions(rt: Runtime, ctx: TenantContext, input: SetProductOptionsInput) {
  assertPermission(ctx, "products.write");
  const options = normalizeOptions(input.options);
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [product] = await tx
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.id, input.productId), eq(schema.products.tenantId, ctx.tenantId)))
      .limit(1);
    if (!product) throw new Error("Not Found: product not found");

    const existing = await tx
      .select()
      .from(schema.variants)
      .where(and(eq(schema.variants.productId, input.productId), eq(schema.variants.tenantId, ctx.tenantId)))
      .orderBy(asc(schema.variants.position), asc(schema.variants.createdAt));

    await tx
      .delete(schema.productOptions)
      .where(and(eq(schema.productOptions.productId, input.productId), eq(schema.productOptions.tenantId, ctx.tenantId)));
    for (const [i, opt] of options.entries()) {
      await tx.insert(schema.productOptions).values({ tenantId: ctx.tenantId, productId: input.productId, name: opt.name, position: i, values: opt.values });
    }

    const combos = optionCombinations(options);
    const matched = new Set<string>();
    const unmatchedCombos: Array<Record<string, string>> = [];
    for (const combo of combos) {
      const hit = existing.find((v) => !matched.has(v.id) && sameCombo(v.optionValues as Record<string, string> | null, combo));
      if (hit) matched.add(hit.id);
      else unmatchedCombos.push(combo);
    }

    // First time options are added to a one-variant product: that variant becomes the first combination.
    const unmatchedExisting = existing.filter((v) => !matched.has(v.id));
    const hadNoOptions = existing.every((v) => !v.optionValues || Object.keys(v.optionValues as object).length === 0);
    if (combos.length > 0 && hadNoOptions && existing.length === 1 && unmatchedCombos.length > 0) {
      const [first, ...rest] = unmatchedCombos;
      const only = unmatchedExisting[0];
      if (first && only) {
        await tx
          .update(schema.variants)
          .set({ optionValues: first, title: comboTitle(first, options), updatedAt: new Date() })
          .where(eq(schema.variants.id, only.id));
        matched.add(only.id);
        unmatchedCombos.length = 0;
        unmatchedCombos.push(...rest);
      }
    }

    if (existing.length + unmatchedCombos.length > MAX_VARIANTS_PER_PRODUCT) {
      throw new Error(`Bad Request: this would give the product more than ${MAX_VARIANTS_PER_PRODUCT} variants`);
    }

    if (unmatchedCombos.length > 0) {
      const skuRows = await tx.select({ sku: schema.variants.sku }).from(schema.variants).where(eq(schema.variants.tenantId, ctx.tenantId));
      const taken = new Set(skuRows.map((r) => r.sku.toLowerCase()));
      const baseSku = (existing[0]?.sku ?? product.slug.toUpperCase()).replace(/-\d+$/, "");
      const price = BigInt(input.defaultPriceMinor ?? Number(existing[0]?.price ?? 0n));
      let position = existing.reduce((m, v) => Math.max(m, v.position), -1) + 1;
      for (const combo of unmatchedCombos) {
        await tx.insert(schema.variants).values({
          tenantId: ctx.tenantId,
          productId: input.productId,
          sku: nextSku(baseSku, taken),
          title: comboTitle(combo, options),
          optionValues: combo,
          price,
          trackInventory: true,
          allowBackorder: false,
          position: position++,
        });
      }
    }

    if (unmatchedCombos.length > 0) {
      const ids = await tx.select({ id: schema.variants.id }).from(schema.variants).where(and(eq(schema.variants.productId, input.productId), eq(schema.variants.tenantId, ctx.tenantId)));
      await syncVariantMarketPrices(tx, ctx.tenantId, ids.map((r) => r.id));
    }
    await audit(tx, ctx, "product.options_updated", input.productId, {
      options: options.map((o) => ({ name: o.name, values: o.values })),
      created: unmatchedCombos.length,
    });
  });

  await invalidateCache(rt, ctx, { type: "product_updated", productId: input.productId });
  return loadProductDetailInternal(rt, ctx.tenantId, input.productId);
}

export interface CreateVariantInput {
  productId: string;
  sku: string;
  title: string;
  price: number;
  compareAtPrice?: number | undefined;
  costPrice?: number | undefined;
  barcode?: string | null | undefined;
  weightGrams?: number | null | undefined;
  dimensions?: Record<string, unknown> | null | undefined;
  optionValues?: Record<string, string> | undefined;
  trackInventory?: boolean | undefined;
  allowBackorder?: boolean | undefined;
  imageMediaId?: string | undefined;
}

/** Adds one variant to an existing product (up to 250 per product). SKUs are unique per store. */
export async function createVariant(rt: Runtime, ctx: TenantContext, input: CreateVariantInput) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.id, input.productId), eq(schema.products.tenantId, ctx.tenantId)))
      .limit(1);
    if (!product) throw new Error("Not Found: product not found");

    const [count] = await tx
      .select({ n: sql<number>`count(*)::int`, maxPos: sql<number>`coalesce(max(${schema.variants.position}), -1)::int` })
      .from(schema.variants)
      .where(and(eq(schema.variants.productId, input.productId), eq(schema.variants.tenantId, ctx.tenantId)));
    if (Number(count?.n ?? 0) >= MAX_VARIANTS_PER_PRODUCT) {
      throw new Error(`Bad Request: a product can have at most ${MAX_VARIANTS_PER_PRODUCT} variants`);
    }

    const [dup] = await tx
      .select({ id: schema.variants.id })
      .from(schema.variants)
      .where(and(eq(schema.variants.sku, input.sku.trim()), eq(schema.variants.tenantId, ctx.tenantId)))
      .limit(1);
    if (dup) throw new Error(`Conflict: the SKU "${input.sku.trim()}" is already used by another variant`);

    const [created] = await tx
      .insert(schema.variants)
      .values({
        tenantId: ctx.tenantId,
        productId: input.productId,
        sku: input.sku.trim(),
        title: input.title.trim(),
        price: BigInt(input.price),
        compareAtPrice: input.compareAtPrice ? BigInt(input.compareAtPrice) : null,
        costPrice: input.costPrice ? BigInt(input.costPrice) : null,
        barcode: input.barcode?.trim() || null,
        weightGrams: input.weightGrams ?? null,
        dimensions: input.dimensions ?? null,
        optionValues: input.optionValues ?? null,
        trackInventory: input.trackInventory ?? true,
        allowBackorder: input.allowBackorder ?? false,
        imageMediaId: input.imageMediaId ?? null,
        position: Number(count?.maxPos ?? -1) + 1,
      })
      .returning();
    if (!created) throw new Error("Failed to create variant");
    await syncVariantMarketPrices(tx, ctx.tenantId, [created.id]);
    if (input.imageMediaId) {
      await syncMediaUsages(tx, ctx, { ownerType: "variant", ownerId: created.id, field: "image", mediaIds: [input.imageMediaId] });
    }
    await audit(tx, ctx, "variant.created", input.productId, { variantId: created.id, sku: created.sku });
    return created;
  });

  await invalidateCache(rt, ctx, { type: "product_updated", productId: input.productId });
  return toVariant(row);
}

/**
 * Deletes a variant that was never sold. A variant that appears on any order is refused (its history must stay), and a
 * product always keeps at least one variant.
 */
export async function deleteVariant(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  const productId = await withTenant(db, ctx.tenantId, async (tx) => {
    const [variant] = await tx
      .select()
      .from(schema.variants)
      .where(and(eq(schema.variants.id, input.id), eq(schema.variants.tenantId, ctx.tenantId)))
      .limit(1);
    if (!variant) throw new Error("Not Found: variant not found");

    const [siblings] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.variants)
      .where(and(eq(schema.variants.productId, variant.productId), eq(schema.variants.tenantId, ctx.tenantId)));
    if (Number(siblings?.n ?? 0) <= 1) throw new Error("Conflict: a product needs at least one variant");

    const [sold] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.variantId, input.id), eq(schema.orderItems.tenantId, ctx.tenantId)));
    if (Number(sold?.n ?? 0) > 0) {
      throw new Error("Conflict: this variant is on past orders and cannot be deleted. Turn off stock tracking or archive the product instead");
    }

    await tx.delete(schema.variants).where(and(eq(schema.variants.id, input.id), eq(schema.variants.tenantId, ctx.tenantId)));
    await audit(tx, ctx, "variant.deleted", variant.productId, { variantId: variant.id, sku: variant.sku });
    return variant.productId;
  });

  await invalidateCache(rt, ctx, { type: "product_updated", productId });
  return { success: true as const };
}
