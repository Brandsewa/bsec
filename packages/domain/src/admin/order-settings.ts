import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { allocateSequenceNumber, type AllocatedSequence } from "../orders/sequences.ts";
import { invalidateCache } from "../cache-invalidation.ts";

export interface OrderSettingsRecord {
  prefix: string;
  padding: number;
  nextValue: number;
  currentNextValue: number;
}

export interface UpdateOrderSettingsInput {
  prefix?: string | undefined;
  padding?: number | undefined;
  nextValue?: number | undefined;
}

/**
 * Reads order numbering settings for the tenant (PLAN §11.2 / ORDERS-SETTINGS-PLAN §4.1).
 * Reads from number_sequences (kind = 'order', scope = '') and store_settings.order_prefix.
 */
export async function getOrderSettings(rt: Runtime, ctx: TenantContext): Promise<OrderSettingsRecord> {
  assertPermission(ctx, "settings.write");
  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    return await readOrderSettingsInternal(tx, ctx.tenantId);
  });
}

/**
 * Internal reader for order settings inside a tenant transaction.
 */
export async function readOrderSettingsInternal(tx: Db, tenantId: string): Promise<OrderSettingsRecord> {
  const [seqRow] = await tx
    .select()
    .from(schema.numberSequences)
    .where(and(eq(schema.numberSequences.tenantId, tenantId), eq(schema.numberSequences.kind, "order"), eq(schema.numberSequences.scope, "")))
    .limit(1);

  const [storeSettingsRow] = await tx
    .select({ orderPrefix: schema.storeSettings.orderPrefix })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.tenantId, tenantId))
    .limit(1);

  const [ordersCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(eq(schema.orders.tenantId, tenantId));

  const totalOrders = ordersCount?.count ?? 0;
  const currentNextValue = seqRow ? Number(seqRow.nextValue) : Math.max(1, totalOrders + 1);
  const prefix = seqRow ? seqRow.prefix : (storeSettingsRow?.orderPrefix ?? "ORD-");
  const padding = seqRow ? seqRow.padding : 5;
  const nextValue = currentNextValue;

  return {
    prefix,
    padding,
    nextValue,
    currentNextValue,
  };
}

/**
 * Updates order numbering settings for the tenant (ORDERS-SETTINGS-PLAN §4.1).
 * Updates number_sequences and store_settings.order_prefix in one transaction.
 * Audited with a before-and-after diff.
 * Lowering nextValue below currentNextValue is refused.
 */
export async function updateOrderSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateOrderSettingsInput,
): Promise<OrderSettingsRecord> {
  assertPermission(ctx, "settings.write");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const before = await readOrderSettingsInternal(tx, ctx.tenantId);

    if (input.nextValue !== undefined && input.nextValue < before.currentNextValue) {
      throw new Error(`Bad Request: Next order number cannot be lower than the current next order number (${before.currentNextValue})`);
    }

    const newPrefix = input.prefix !== undefined ? input.prefix : before.prefix;
    const newPadding = input.padding !== undefined ? input.padding : before.padding;
    const newNextValue = input.nextValue !== undefined ? input.nextValue : before.nextValue;

    // 1. Ensure or update number_sequences row
    const [existingSeq] = await tx
      .select({ id: schema.numberSequences.id })
      .from(schema.numberSequences)
      .where(and(eq(schema.numberSequences.tenantId, ctx.tenantId), eq(schema.numberSequences.kind, "order"), eq(schema.numberSequences.scope, "")))
      .limit(1);

    if (existingSeq) {
      await tx
        .update(schema.numberSequences)
        .set({
          prefix: newPrefix,
          padding: newPadding,
          nextValue: newNextValue,
          updatedAt: new Date(),
        })
        .where(eq(schema.numberSequences.id, existingSeq.id));
    } else {
      await tx.insert(schema.numberSequences).values({
        tenantId: ctx.tenantId,
        kind: "order",
        scope: "",
        prefix: newPrefix,
        padding: newPadding,
        nextValue: newNextValue,
      });
    }

    // 2. Keep store_settings.order_prefix in sync
    const [existingStoreSettings] = await tx
      .select({ id: schema.storeSettings.id })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .limit(1);

    if (existingStoreSettings) {
      await tx
        .update(schema.storeSettings)
        .set({
          orderPrefix: newPrefix,
          updatedAt: new Date(),
        })
        .where(eq(schema.storeSettings.id, existingStoreSettings.id));
    }

    // 3. Audit log (Rule 6: every store mutation writes audit_logs)
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "order_settings.update",
      targetType: "order_settings",
      targetId: ctx.tenantId,
      diff: {
        before: {
          prefix: before.prefix,
          padding: before.padding,
          nextValue: before.nextValue,
        },
        after: {
          prefix: newPrefix,
          padding: newPadding,
          nextValue: newNextValue,
        },
      },
    });

    return {
      prefix: newPrefix,
      padding: newPadding,
      nextValue: newNextValue,
      currentNextValue: newNextValue,
    };
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}

/**
 * Allocates the next order sequence number respecting the store's settings (fixes S1/S2).
 * Reads defaultPrefix from store_settings if the sequence row has not been created yet.
 */
export async function allocateOrderNumber(tx: Db, tenantId: string): Promise<AllocatedSequence> {
  const [storeSettingsRow] = await tx
    .select({ orderPrefix: schema.storeSettings.orderPrefix })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.tenantId, tenantId))
    .limit(1);

  const defaultPrefix = storeSettingsRow?.orderPrefix ?? "ORD-";

  return await allocateSequenceNumber(tx, tenantId, "order", "", {
    defaultPrefix,
    defaultPadding: 5,
  });
}
