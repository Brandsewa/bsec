import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import {
  adjustInventory,
  loadProductDetailInternal,
  updateCategory,
  updateCollection,
  updateProduct,
  updateVariant,
  type UpdateCategoryInput,
  type UpdateCollectionInput,
  type UpdateProductInput,
  type UpdateVariantInput,
} from "../catalog-services.ts";
import { listCustomFieldDefinitions, setResourceCustomFields } from "./custom-fields.ts";

/**
 * Bulk editor (docs/BULK-EDITOR-PLAN.md). Each record is saved on its own through the same single-record services the
 * edit pages use, so permissions, validation, market-price sync and cache invalidation stay in one place. A failing
 * record (duplicate SKU or slug, missing primary category) is reported per row and never blocks the others.
 */
export const BULK_EDIT_MAX_RECORDS = 250;
export const BULK_SAVE_MAX_RECORDS = 100;

export interface BulkVariantPatch extends Omit<UpdateVariantInput, "id"> {
  id: string;
  /** Wanted on-hand quantity at the default location. Saved as a correction movement of the difference. */
  stockOnHand?: number | undefined;
}

export interface BulkProductItem {
  id: string;
  product?: Omit<UpdateProductInput, "id"> | undefined;
  variants?: BulkVariantPatch[] | undefined;
  /** Custom field values by definition id (null clears). */
  customFields?: Record<string, unknown> | undefined;
}

export interface BulkResult {
  id: string;
  ok: boolean;
  error?: string | undefined;
}

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Could not save";
  if (/unique|duplicate/i.test(msg)) return "That SKU or URL handle is already used";
  return msg.replace(/^(Bad Request|Forbidden|Conflict): ?/i, "");
}

async function audit(rt: Runtime, ctx: TenantContext, action: string, targetType: string, targetId: string, fields: string[]) {
  await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action,
      targetType,
      targetId,
      diff: { bulk: true, fields },
    }),
  );
}

function changedKeys(...parts: Array<object | undefined>): string[] {
  const keys = new Set<string>();
  for (const p of parts) if (p) for (const k of Object.keys(p)) if (k !== "id") keys.add(k);
  return [...keys].sort();
}

/** Loads up to 250 products (with variants, media, categories, collections), stock and custom fields for the grid. */
export async function getProductsForBulkEdit(rt: Runtime, ctx: TenantContext, input: { ids: string[] }) {
  assertPermission(ctx, "products.read");
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return { items: [], locationId: null, stock: {}, customFields: { enabled: false, definitions: [], values: {} } };
  if (ids.length > BULK_EDIT_MAX_RECORDS) throw new Error(`Bad Request: edit up to ${BULK_EDIT_MAX_RECORDS} products at a time`);

  const items: Awaited<ReturnType<typeof loadProductDetailInternal>>[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = await Promise.all(
      ids.slice(i, i + 10).map((id) => loadProductDetailInternal(rt, ctx.tenantId, id).catch(() => null)),
    );
    for (const c of chunk) if (c) items.push(c);
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const variantIds = items.flatMap((p) => p.variants.map((v) => v.id));
  const defs = await listCustomFieldDefinitions(rt, ctx, { resourceType: "product" });

  const { locationId, stock, values } = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [loc] = await tx
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.isActive, true))
      .orderBy(asc(schema.locations.isDefault), asc(schema.locations.createdAt));
    // isDefault sorts false first in ascending order, so pick the default explicitly when there is one.
    const [def] = await tx.select({ id: schema.locations.id }).from(schema.locations).where(and(eq(schema.locations.isActive, true), eq(schema.locations.isDefault, true)));
    const locationId = def?.id ?? loc?.id ?? null;

    const stock: Record<string, number> = {};
    if (locationId && variantIds.length) {
      const rows = await tx
        .select({ variantId: schema.inventoryLevels.variantId, onHand: schema.inventoryLevels.onHand })
        .from(schema.inventoryLevels)
        .where(and(eq(schema.inventoryLevels.locationId, locationId), inArray(schema.inventoryLevels.variantId, variantIds)));
      for (const r of rows) stock[r.variantId] = r.onHand;
    }

    const values: Record<string, Record<string, unknown>> = {};
    if (defs.enabled && defs.definitions.length) {
      const rows = await tx
        .select({ productId: schema.customFieldValues.productId, definitionId: schema.customFieldValues.definitionId, value: schema.customFieldValues.value })
        .from(schema.customFieldValues)
        .where(inArray(schema.customFieldValues.productId, ids));
      for (const r of rows) if (r.productId) (values[r.productId] ??= {})[r.definitionId] = r.value;
    }
    return { locationId, stock, values };
  });

  return { items, locationId, stock, customFields: { enabled: defs.enabled, definitions: defs.definitions, values } };
}

/** Saves up to 100 products. Returns one result per product; stock is written against the default location. */
export async function bulkUpdateProducts(rt: Runtime, ctx: TenantContext, input: { items: BulkProductItem[] }): Promise<{ results: BulkResult[] }> {
  assertPermission(ctx, "products.write");
  if (input.items.length > BULK_SAVE_MAX_RECORDS) throw new Error(`Bad Request: save up to ${BULK_SAVE_MAX_RECORDS} products at a time`);

  const needsStock = input.items.some((i) => i.variants?.some((v) => v.stockOnHand !== undefined));
  let locationId: string | null = null;
  const current = new Map<string, number>();
  if (needsStock) {
    const ids = input.items.flatMap((i) => (i.variants ?? []).filter((v) => v.stockOnHand !== undefined).map((v) => v.id));
    await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      const [def] = await tx.select({ id: schema.locations.id }).from(schema.locations).where(and(eq(schema.locations.isActive, true), eq(schema.locations.isDefault, true)));
      const [any] = def ? [def] : await tx.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.isActive, true)).orderBy(asc(schema.locations.createdAt));
      locationId = any?.id ?? null;
      if (locationId) {
        const rows = await tx
          .select({ variantId: schema.inventoryLevels.variantId, onHand: schema.inventoryLevels.onHand })
          .from(schema.inventoryLevels)
          .where(and(eq(schema.inventoryLevels.locationId, locationId), inArray(schema.inventoryLevels.variantId, ids)));
        for (const r of rows) current.set(r.variantId, r.onHand);
      }
    });
  }

  const results: BulkResult[] = [];
  for (const item of input.items) {
    try {
      const variantPatches = (item.variants ?? []).map(({ stockOnHand: _s, ...rest }) => rest);
      if (item.product && Object.keys(item.product).length) await updateProduct(rt, ctx, { id: item.id, ...item.product });
      for (const v of item.variants ?? []) {
        const { stockOnHand, ...patch } = v;
        if (Object.keys(patch).length > 1) await updateVariant(rt, ctx, patch);
        if (stockOnHand !== undefined) {
          if (!locationId) throw new Error("Add an inventory location before editing stock");
          const delta = stockOnHand - (current.get(v.id) ?? 0);
          if (delta !== 0) await adjustInventory(rt, ctx, { variantId: v.id, locationId, quantityDelta: delta, reason: "correction", notes: "Bulk editor" });
        }
      }
      if (item.customFields && Object.keys(item.customFields).length) {
        await setResourceCustomFields(rt, ctx, { resourceType: "product", resourceId: item.id, values: item.customFields });
      }
      const fields = [
        ...changedKeys(item.product),
        ...variantPatches.flatMap((v) => changedKeys(v).map((k) => `variant.${k}`)),
        ...(item.variants?.some((v) => v.stockOnHand !== undefined) ? ["variant.stockOnHand"] : []),
        ...(item.customFields ? ["customFields"] : []),
      ];
      await audit(rt, ctx, "product.bulk_updated", "product", item.id, [...new Set(fields)]);
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: cleanError(e) });
    }
  }
  return { results };
}

export async function bulkUpdateCategories(rt: Runtime, ctx: TenantContext, input: { items: UpdateCategoryInput[] }): Promise<{ results: BulkResult[] }> {
  assertPermission(ctx, "products.write");
  if (input.items.length > BULK_SAVE_MAX_RECORDS) throw new Error(`Bad Request: save up to ${BULK_SAVE_MAX_RECORDS} categories at a time`);
  const results: BulkResult[] = [];
  for (const item of input.items) {
    try {
      await updateCategory(rt, ctx, item);
      await audit(rt, ctx, "category.bulk_updated", "category", item.id, changedKeys(item));
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: cleanError(e) });
    }
  }
  return { results };
}

export async function bulkUpdateCollections(rt: Runtime, ctx: TenantContext, input: { items: UpdateCollectionInput[] }): Promise<{ results: BulkResult[] }> {
  assertPermission(ctx, "products.write");
  if (input.items.length > BULK_SAVE_MAX_RECORDS) throw new Error(`Bad Request: save up to ${BULK_SAVE_MAX_RECORDS} collections at a time`);
  const results: BulkResult[] = [];
  for (const item of input.items) {
    try {
      await updateCollection(rt, ctx, item);
      await audit(rt, ctx, "collection.bulk_updated", "collection", item.id, changedKeys(item));
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: cleanError(e) });
    }
  }
  return { results };
}
