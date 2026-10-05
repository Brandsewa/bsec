import { createHash } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, withTenant, type Db, QUEUE_NAMES } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { commitReservation } from "../catalog/inventory-reservations.ts";
import { transitionOrder, type OrderStatus } from "./state-machine.ts";
import { transitionFulfillment, type FulfillmentTransitionEvent } from "./fulfillment-state-machine.ts";
import { createAdminFulfillment } from "../admin/orders.ts";
import { isReturnPhotoStorageConfigured } from "./return-photos.ts";

/**
 * Hand-run order lifecycle for merchants who ship themselves (no courier integration):
 * confirm -> shipped -> delivered, collecting cash on delivery. Everything goes through the same
 * state machines the courier integration will use, so the two can coexist.
 */

const ORDER_CHAIN: Array<{ to: OrderStatus; type: "order.process" | "order.partially_fulfill" | "order.fulfill" | "order.deliver" }> = [
  { to: "processing", type: "order.process" },
  { to: "partially_fulfilled", type: "order.partially_fulfill" },
  { to: "fulfilled", type: "order.fulfill" },
  { to: "delivered", type: "order.deliver" },
];

const FULFILLMENT_CHAIN: Record<string, FulfillmentTransitionEvent[]> = {
  pending: [{ type: "fulfillment.create_label" }],
  label_created: [{ type: "fulfillment.pick_up" }, { type: "fulfillment.transit" }],
  picked_up: [{ type: "fulfillment.transit" }],
  in_transit: [],
  out_for_delivery: [],
};

const NOT_SHIPPABLE = ["cancelled", "returned"];

async function loadOrder(tx: Parameters<Parameters<typeof withTenant>[2]>[0], tenantId: string, id: string) {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, id)));
  if (!order) throw new Error("Not Found: Order not found");
  return order;
}

/** Walk the order status forward along the legal chain until it reaches `target`. */
async function walkOrder(
  rt: Runtime,
  ctx: TenantContext,
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  orderId: string,
  current: string,
  target: OrderStatus,
) {
  const from = ORDER_CHAIN.findIndex((s) => s.to === current);
  const to = ORDER_CHAIN.findIndex((s) => s.to === target);
  // "confirmed" sits just before the chain, so it starts at index -1
  for (const step of ORDER_CHAIN.slice(from + 1, to + 1)) {
    await transitionOrder(rt, ctx, orderId, { type: step.type }, tx);
  }
}

export async function confirmAdminOrder(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;
  await withTenant(db, ctx.tenantId, async (tx) => {
    const order = await loadOrder(tx, ctx.tenantId, input.id);
    if (order.status !== "pending") throw new Error(`Precondition: Order is already ${order.status}`);
    await transitionOrder({ ...rt, _db: { db: tx } } as unknown as Runtime, ctx, input.id, { type: "order.confirm", reason: "Confirmed by the store" }, tx);
  });
  // stock moves from "reserved" to sold
  await commitReservation(db, ctx.tenantId, { orderId: input.id });
  return { success: true as const };
}

/**
 * Mark an order shipped or delivered. Creates the shipment if there is none, confirms a pending order
 * first, and on delivery records cash on delivery as collected.
 */
export async function advanceAdminOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; to: "shipped" | "delivered"; carrier?: string | undefined; awb?: string | undefined },
) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  const before = await withTenant(db, ctx.tenantId, async (tx) => {
    const order = await loadOrder(tx, ctx.tenantId, input.id);
    if (NOT_SHIPPABLE.includes(order.status)) throw new Error(`Precondition: A ${order.status} order can't be shipped`);

    const today = new Date().toISOString().slice(0, 10);
    if (order.shipsOn && !order.preorderReleasedAt && String(order.shipsOn) > today) {
      throw new Error(`Precondition: Pre-order ships on ${order.shipsOn}`);
    }

    const fs = await tx
      .select({ id: schema.fulfillments.id, status: schema.fulfillments.status })
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.tenantId, ctx.tenantId), eq(schema.fulfillments.orderId, input.id)));
    return { order, live: fs.filter((f) => f.status !== "cancelled") };
  });

  if (before.order.status === "pending") await confirmAdminOrder(rt, ctx, { id: input.id });
  if (before.live.length === 0) {
    await createAdminFulfillment(rt, ctx, { id: input.id, carrier: input.carrier ?? "Self-delivery", awb: input.awb });
  }

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const txRt = { ...rt, _db: { db: tx } } as unknown as Runtime;
    const fs = await tx
      .select()
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.tenantId, ctx.tenantId), eq(schema.fulfillments.orderId, input.id)));

    for (const f of fs.filter((x) => x.status !== "cancelled")) {
      if (f.status === "delivered") continue;
      if (f.status === "rto" || f.status === "rto_delivered") throw new Error("Precondition: This shipment is being returned to origin");
      for (const ev of FULFILLMENT_CHAIN[f.status] ?? []) {
        await transitionFulfillment(txRt, ctx, f.id, ev, tx);
      }
      if (input.to === "delivered") {
        await transitionFulfillment(txRt, ctx, f.id, { type: "fulfillment.deliver" }, tx);
      }
    }

    const order = await loadOrder(tx, ctx.tenantId, input.id);
    await walkOrder(txRt, ctx, tx, input.id, order.status, input.to === "delivered" ? "delivered" : "fulfilled");

    if (input.to === "delivered") {
      // "created" is included: orders made in the admin before this was fixed recorded their COD payment that way,
      // and delivering them must still collect the cash instead of leaving the order "COD pending" for good.
      const due = await tx
        .select({ id: schema.paymentIntents.id, status: schema.paymentIntents.status })
        .from(schema.paymentIntents)
        .where(
          and(
            eq(schema.paymentIntents.tenantId, ctx.tenantId),
            eq(schema.paymentIntents.orderId, input.id),
            eq(schema.paymentIntents.provider, "cod"),
            inArray(schema.paymentIntents.status, ["created", "cod_pending"]),
          ),
        );
      for (const p of due) {
        if (p.status === "created") {
          // Repair, not a transition: the payment state machine (PLAN 11.1) has no created -> cod_pending step because a COD
          // payment is cod_pending from the start. These rows were mis-recorded as "created" by the admin order form.
          await tx.update(schema.paymentIntents).set({ status: "cod_pending", updatedAt: new Date() }).where(eq(schema.paymentIntents.id, p.id));
        }
        await transitionOrder(txRt, ctx, input.id, { type: "payment.cod_collect", intentId: p.id }, tx);
      }
    }
    return { success: true as const, status: input.to };
  });
}

// ---------------------------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------------------------

export interface ReturnRequestInput {
  orderId: string;
  reason: string;
  resolution?: "refund" | "replacement" | "store_credit" | undefined;
  exchangeRequest?: string | undefined;
  customerComment?: string | undefined;
  photos?: string[] | undefined;
  items: Array<{ orderItemId: string; quantity: number }>;
}

/** Items of a delivered order still returnable: bought minus already returned or in a live return. Non-returnable products have 0. */
export async function getReturnableItems(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
  orderId: string,
) {
  const items = await tx
    .select({
      id: schema.orderItems.id,
      orderId: schema.orderItems.orderId,
      variantId: schema.orderItems.variantId,
      productTitle: schema.orderItems.productTitle,
      variantTitle: schema.orderItems.variantTitle,
      quantity: schema.orderItems.quantity,
      unitPrice: schema.orderItems.unitPrice,
      total: schema.orderItems.total,
      returnableFlag: schema.products.returnable,
    })
    .from(schema.orderItems)
    .innerJoin(schema.variants, and(eq(schema.variants.tenantId, schema.orderItems.tenantId), eq(schema.variants.id, schema.orderItems.variantId)))
    .leftJoin(schema.products, and(eq(schema.products.tenantId, schema.variants.tenantId), eq(schema.products.id, schema.variants.productId)))
    .where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, orderId)));

  const open = await tx
    .select({ orderItemId: schema.returnItems.orderItemId, quantity: schema.returnItems.quantity })
    .from(schema.returnItems)
    .innerJoin(schema.returns, and(eq(schema.returns.tenantId, schema.returnItems.tenantId), eq(schema.returns.id, schema.returnItems.returnId)))
    .where(
      and(
        eq(schema.returnItems.tenantId, tenantId),
        eq(schema.returns.orderId, orderId),
        inArray(schema.returns.status, ["requested", "approved", "picked_up", "received", "refunded", "replaced", "closed"]),
      ),
    );
  const held = new Map<string, number>();
  for (const o of open) held.set(o.orderItemId, (held.get(o.orderItemId) ?? 0) + o.quantity);
  return items.map((i) => {
    const isReturnableProduct = i.returnableFlag !== false;
    const remaining = Math.max(0, i.quantity - (held.get(i.id) ?? 0));
    return { ...i, returnable: isReturnableProduct ? remaining : 0, isNonReturnable: !isReturnableProduct };
  });
}

async function nextReturnNumber(db: Db, tenantId: string) {
  const { allocateSequenceNumber } = await import("./sequences.ts");
  return (await allocateSequenceNumber(db, tenantId, "return", "", { defaultPrefix: "RET-", defaultPadding: 4 })).formatted;
}

/**
 * A shopper (or the merchant on their behalf) asks to send items back.
 * `actor` is already authorised by the caller: the storefront proves it with the order token.
 */
export async function requestReturn(rt: Runtime, ctx: TenantContext, input: ReturnRequestInput) {
  const db = rt._db.db;
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Bad Request: Please tell us why you want to return this");
  const wanted = input.items.filter((i) => i.quantity > 0);
  if (wanted.length === 0) throw new Error("Bad Request: Choose at least one item to return");

  const photos = Array.isArray(input.photos) ? input.photos.slice(0, 5) : [];

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const { readReturnSettings } = await import("../admin/return-settings.ts");
    const settings = await readReturnSettings(tx, ctx.tenantId);

    if (!settings.acceptReturns) {
      throw new Error("Precondition: Return requests are not accepted by this store");
    }

    // Reason validation: must match one of the store's configured reasons (by ID or label)
    const matchedReason = settings.reasons.find(
      (r) => r.id.toLowerCase() === reason.toLowerCase() || r.label.toLowerCase() === reason.toLowerCase(),
    );
    if (!matchedReason) {
      throw new Error("Bad Request: Please choose a valid return reason configured by the store");
    }

    // Photos can only be attached when private photo storage is configured; until then the "required" rule cannot be met, so it is not enforced.
    if (matchedReason.photoRequirement === "required" && photos.length === 0 && isReturnPhotoStorageConfigured()) {
      throw new Error("Bad Request: Photos are required for this return reason");
    }

    if (input.resolution === "replacement" && !settings.allowExchanges) {
      throw new Error("Precondition: Exchanges are not available for this store");
    }

    const order = await loadOrder(tx, ctx.tenantId, input.orderId);
    if (order.status !== "delivered") throw new Error("Precondition: Only delivered orders can be returned");

    const [delivered] = await tx
      .select({ at: sql<Date | null>`max(${schema.fulfillments.deliveredAt})` })
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.tenantId, ctx.tenantId), eq(schema.fulfillments.orderId, input.orderId)));
    const since = delivered?.at ? new Date(delivered.at) : order.updatedAt;
    const windowDays = settings.returnWindowDays;
    if (Date.now() - since.getTime() > windowDays * 86_400_000) {
      throw new Error(`Precondition: The ${windowDays}-day return window has passed`);
    }

    const returnableItems = await getReturnableItems(tx, ctx.tenantId, input.orderId);
    const returnableMap = new Map(returnableItems.map((i) => [i.id, i.returnable]));
    for (const w of wanted) {
      const left = returnableMap.get(w.orderItemId);
      if (left === undefined) throw new Error("Bad Request: That item isn't on this order");
      const matchedItem = returnableItems.find((i) => i.id === w.orderItemId);
      if (matchedItem?.isNonReturnable) {
        throw new Error(`Precondition: "${matchedItem.productTitle}" is marked final sale and cannot be returned`);
      }
      if (w.quantity > left) {
        throw new Error(left === 0 ? "Conflict: That item has already been returned" : `Conflict: You can return at most ${left} of that item`);
      }
    }

    // Validate attached return photos: must belong to this tenant, order, folder 'returns', and not already attached
    if (photos.length > 0) {
      const mediaRows = await tx
        .select({ id: schema.media.id, folder: schema.media.folder, storageKey: schema.media.storageKey })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.tenantId, ctx.tenantId),
            inArray(schema.media.id, photos),
          ),
        );

      if (mediaRows.length !== photos.length) {
        throw new Error("Bad Request: One or more photos are invalid or do not exist");
      }

      const expectedPrefix = `tenants/${ctx.tenantId}/returns/${input.orderId}/`;
      for (const m of mediaRows) {
        if (m.folder !== "returns" || !m.storageKey.startsWith(expectedPrefix)) {
          throw new Error("Bad Request: One or more photos do not belong to this order");
        }
      }

      // Check if any photo is already attached to an existing return
      const existingReturnsWithPhotos = await tx
        .select({ photos: schema.returns.photos })
        .from(schema.returns)
        .where(
          and(
            eq(schema.returns.tenantId, ctx.tenantId),
            sql`${schema.returns.photos} && ARRAY[${sql.join(photos.map((p) => sql`${p}::uuid`), sql`, `)}]::uuid[]`,
          ),
        );

      if (existingReturnsWithPhotos.length > 0) {
        throw new Error("Conflict: One or more photos are already attached to a return");
      }
    }

    const number = await nextReturnNumber(tx, ctx.tenantId);
    const resolution = input.resolution === "replacement" ? "replacement" : "refund";
    const [ret] = await tx
      .insert(schema.returns)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.orderId,
        customerId: order.customerId ?? null,
        number,
        reason,
        resolution,
        requestedResolution: resolution,
        customerComment: input.customerComment ? input.customerComment.trim().slice(0, 1000) : null,
        exchangeRequest: input.exchangeRequest ? input.exchangeRequest.trim().slice(0, 1000) : null,
        photos,
      })
      .returning();
    if (!ret) throw new Error("Failed to create return");

    for (const w of wanted) {
      await tx.insert(schema.returnItems).values({ tenantId: ctx.tenantId, returnId: ret.id, orderItemId: w.orderItemId, quantity: w.quantity });
    }

    await tx.insert(schema.orderEvents).values({
      tenantId: ctx.tenantId,
      orderId: input.orderId,
      type: "return.request",
      message: `Return ${number} requested (${resolution === "replacement" ? "exchange" : "refund"}): ${reason}`,
      data: { returnId: ret.id, returnNumber: number, resolution },
      actorType: ctx.actor?.type ?? "customer",
      visibleToCustomer: true,
    });

    return { returnId: ret.id, number };
  });
}

/**
 * A shopper or merchant cancels a pending return request (only before approval).
 */
export async function cancelReturn(
  rt: Runtime,
  ctx: TenantContext,
  input: { returnId: string; reason?: string | undefined },
) {
  const db = rt._db.db;
  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [ret] = await tx
      .select()
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.returnId)));
    if (!ret) throw new Error("Not Found: Return not found");
    if (ret.status !== "requested") {
      throw new Error(`Precondition: Only requested returns can be cancelled (current status: ${ret.status})`);
    }

    const { transitionReturn } = await import("./return-state-machine.ts");
    const result = await transitionReturn({ ...rt, _db: { db: tx } } as unknown as Runtime, ctx, input.returnId, { type: "return.cancel", reason: input.reason }, tx);

    if (ctx.actor.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "returns.cancel",
        targetType: "return",
        targetId: input.returnId,
        diff: { before: { status: ret.status }, after: { status: "cancelled", reason: input.reason } },
      });
    }

    return { success: true as const, status: result.newStatus };
  });
}

export type ReturnAction = "approve" | "reject" | "pick_up" | "receive" | "refund" | "replace" | "close";

export interface ActOnReturnInput {
  id: string;
  action: ReturnAction;
  note?: string | undefined;
  resolution?: "refund" | "replacement" | undefined;
  decisionMessage?: string | undefined;
  restock?: boolean | undefined;
  refundAmount?: number | undefined;
  refundMethod?: string | undefined;
  refundReference?: string | undefined;
  exchangeNote?: string | undefined;
  exchangeOrderId?: string | undefined;
}

/** Move a return forward; audited per Rule 6; recording a refund requires orders.refund. */
export async function actOnReturn(
  rt: Runtime,
  ctx: TenantContext,
  input: ActOnReturnInput,
) {
  assertPermission(ctx, input.action === "refund" ? "orders.refund" : "orders.write");
  const db = rt._db.db;
  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [ret] = await tx
      .select()
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));
    if (!ret) throw new Error("Not Found: Return not found");
    const { transitionReturn } = await import("./return-state-machine.ts");
    const txRt = { ...rt, _db: { db: tx } } as unknown as Runtime;

    switch (input.action) {
      case "approve":
        await transitionReturn(
          txRt,
          ctx,
          input.id,
          {
            type: "return.approve",
            resolution: input.resolution ?? (ret.requestedResolution === "replacement" ? "replacement" : "refund"),
            decisionMessage: input.decisionMessage,
            adminNote: input.note,
          },
          tx,
        );
        break;
      case "reject":
        if (!input.note?.trim() && !input.decisionMessage?.trim()) {
          throw new Error("Bad Request: Please provide a reason for rejection");
        }
        await transitionReturn(
          txRt,
          ctx,
          input.id,
          {
            type: "return.reject",
            reason: input.decisionMessage?.trim() || input.note?.trim() || "Not eligible",
            decisionMessage: input.decisionMessage,
            adminNote: input.note,
          },
          tx,
        );
        break;
      case "pick_up":
        await transitionReturn(txRt, ctx, input.id, { type: "return.pick_up" }, tx);
        break;
      case "close":
        await transitionReturn(txRt, ctx, input.id, { type: "return.close", note: input.note }, tx);
        break;
      case "receive": {
        await transitionReturn(txRt, ctx, input.id, { type: "return.receive", restock: input.restock }, tx);
        const lines = await tx
          .select({ ri: schema.returnItems, oi: schema.orderItems })
          .from(schema.returnItems)
          .innerJoin(schema.orderItems, and(eq(schema.orderItems.tenantId, schema.returnItems.tenantId), eq(schema.orderItems.id, schema.returnItems.orderItemId)))
          .where(and(eq(schema.returnItems.tenantId, ctx.tenantId), eq(schema.returnItems.returnId, input.id)));
        const [shelf] = await tx
          .select({ id: schema.locations.id })
          .from(schema.locations)
          .where(eq(schema.locations.tenantId, ctx.tenantId))
          .orderBy(sql`${schema.locations.isDefault} desc`)
          .limit(1);
        for (const { ri, oi } of lines) {
          await tx.update(schema.orderItems).set({ returnedQty: sql`${schema.orderItems.returnedQty} + ${ri.quantity}` }).where(eq(schema.orderItems.id, oi.id));
          const loc = shelf;
          const back = input.restock !== false && ri.restock && loc !== undefined;
          await tx.update(schema.returnItems).set({ restock: back }).where(eq(schema.returnItems.id, ri.id));
          if (back) {
            await tx
              .update(schema.inventoryLevels)
              .set({ onHand: sql`${schema.inventoryLevels.onHand} + ${ri.quantity}`, updatedAt: new Date() })
              .where(and(eq(schema.inventoryLevels.variantId, oi.variantId), eq(schema.inventoryLevels.locationId, loc.id)));
            await tx.insert(schema.inventoryMovements).values({
              tenantId: ctx.tenantId,
              variantId: oi.variantId,
              locationId: loc.id,
              delta: ri.quantity,
              reason: "return",
              note: `Return ${ret.number}`,
            });
          }
        }
        if (lines.some(({ ri }) => input.restock !== false && ri.restock && shelf !== undefined) && rt._jobs) {
          await rt._jobs.send(QUEUE_NAMES.FINANCE_POST, {
            tenantId: ctx.tenantId,
            kind: "restock",
            id: input.id,
          });
        }
        break;
      }
      case "refund": {
        const lines = await tx
          .select({ quantity: schema.returnItems.quantity, lineTotal: schema.orderItems.total, bought: schema.orderItems.quantity })
          .from(schema.returnItems)
          .innerJoin(schema.orderItems, and(eq(schema.orderItems.tenantId, schema.returnItems.tenantId), eq(schema.orderItems.id, schema.returnItems.orderItemId)))
          .where(and(eq(schema.returnItems.tenantId, ctx.tenantId), eq(schema.returnItems.returnId, input.id)));
        const computedDefault = Math.round(lines.reduce((s, l) => s + (l.quantity * l.lineTotal) / Math.max(1, l.bought), 0));
        const amount = input.refundAmount !== undefined ? input.refundAmount : computedDefault;
        if (amount <= 0) throw new Error("Bad Request: Refund amount must be greater than zero");

        const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, ret.orderId)));
        if (!order) throw new Error("Order not found");

        const existingRefunds = await tx
          .select({ amount: schema.refunds.amount })
          .from(schema.refunds)
          .where(and(eq(schema.refunds.tenantId, ctx.tenantId), eq(schema.refunds.orderId, ret.orderId), eq(schema.refunds.status, "succeeded")));
        const totalAlreadyRefunded = existingRefunds.reduce((s, r) => s + Number(r.amount), 0);
        const maxRefundable = Math.max(0, order.grandTotal - totalAlreadyRefunded);
        if (amount > maxRefundable) {
          throw new Error(`Conflict: Refund of ₹${(amount / 100).toFixed(2)} exceeds maximum refundable amount of ₹${(maxRefundable / 100).toFixed(2)}`);
        }

        const [intent] = await tx
          .select()
          .from(schema.paymentIntents)
          .where(and(eq(schema.paymentIntents.tenantId, ctx.tenantId), eq(schema.paymentIntents.orderId, ret.orderId)))
          .limit(1);

        await transitionReturn(
          txRt,
          ctx,
          input.id,
          {
            type: "return.refund",
            refundAmount: amount,
            refundMethod: input.refundMethod ?? "manual",
            refundReference: input.refundReference,
            adminNote: input.note,
          },
          tx,
        );

        if (intent && (intent.status === "captured" || intent.status === "partially_refunded")) {
          await transitionOrder(txRt, ctx, ret.orderId, { type: "payment.partial_refund", intentId: intent.id, amount, reason: `Return ${ret.number}` }, tx);
        }

        const [insertedRefund] = await tx.insert(schema.refunds).values({
          tenantId: ctx.tenantId,
          orderId: ret.orderId,
          intentId: intent?.id ?? null,
          amount,
          method: input.refundMethod ?? "manual",
          reference: input.refundReference ?? null,
          status: "succeeded",
          reason: `Return ${ret.number}`,
          initiatedBy: "admin",
        }).returning({ id: schema.refunds.id });

        if (rt._jobs && insertedRefund) {
          await rt._jobs.send(QUEUE_NAMES.FINANCE_POST, {
            tenantId: ctx.tenantId,
            kind: "refund",
            id: insertedRefund.id,
          });
        }

        // Slice 6D: Credit notes on refunds (flagged behind settings.gst_v2)
        // If the order has an issued invoice, issue a credit note linked to original invoice and return
        const { isFeatureEnabled } = await import("../features.ts");
        const gstV2Enabled = await isFeatureEnabled(tx, ctx.tenantId, "settings.gst_v2");
        if (gstV2Enabled) {
          const [parentInvoice] = await tx
            .select()
            .from(schema.invoices)
            .where(
              and(
                eq(schema.invoices.tenantId, ctx.tenantId),
                eq(schema.invoices.orderId, ret.orderId),
                eq(schema.invoices.type, "invoice"),
              ),
            )
            .orderBy(schema.invoices.createdAt)
            .limit(1);

          if (parentInvoice) {
            // Check if credit note already issued for this return (idempotency)
            const [existingCn] = await tx
              .select({ id: schema.invoices.id })
              .from(schema.invoices)
              .where(
                and(
                  eq(schema.invoices.tenantId, ctx.tenantId),
                  eq(schema.invoices.returnId, input.id),
                  eq(schema.invoices.type, "credit_note"),
                ),
              )
              .limit(1);

            if (!existingCn) {
              const { generateInvoice } = await import("./invoices.ts");
              const returnedLines = await tx
                .select({
                  orderItemId: schema.returnItems.orderItemId,
                  quantity: schema.returnItems.quantity,
                })
                .from(schema.returnItems)
                .where(
                  and(
                    eq(schema.returnItems.tenantId, ctx.tenantId),
                    eq(schema.returnItems.returnId, input.id),
                  ),
                );

              await generateInvoice(
                txRt,
                ctx,
                {
                  orderId: ret.orderId,
                  type: "credit_note",
                  returnId: input.id,
                  parentInvoiceId: parentInvoice.id,
                  creditLines: returnedLines,
                },
                tx,
              );
            }
          }
        }
        break;
      }
      case "replace": {
        await transitionReturn(
          txRt,
          ctx,
          input.id,
          {
            type: "return.replace",
            exchangeNote: input.exchangeNote,
            exchangeOrderId: input.exchangeOrderId,
            adminNote: input.note,
          },
          tx,
        );
        break;
      }
    }

    // Rule 6: Audit log for all staff actions
    if (ctx.actor.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: `returns.${input.action}`,
        targetType: "return",
        targetId: input.id,
        diff: {
          before: { status: ret.status },
          after: { action: input.action, note: input.note, input },
        },
      });
    }

    const [after] = await tx.select({ status: schema.returns.status }).from(schema.returns).where(eq(schema.returns.id, input.id));
    return { success: true as const, status: after?.status ?? ret.status };
  });
}

// ---------------------------------------------------------------------------------------------
// The shopper's side: the order link (token) is the proof of ownership
// ---------------------------------------------------------------------------------------------

async function orderIdForToken(tx: Parameters<Parameters<typeof withTenant>[2]>[0], tenantId: string, token: string) {
  const [t] = await tx
    .select({ targetId: schema.actionTokens.targetId })
    .from(schema.actionTokens)
    .where(
      and(
        eq(schema.actionTokens.tenantId, tenantId),
        eq(schema.actionTokens.purpose, "order_view"),
        eq(schema.actionTokens.tokenHash, createHash("sha256").update(token.trim()).digest("hex")),
        gt(schema.actionTokens.expiresAt, new Date()),
      ),
    );
  return t?.targetId ?? null;
}

export interface OrderReturnsView {
  orderId: string;
  canRequest: boolean;
  acceptReturns: boolean;
  allowExchanges: boolean;
  reasons: Array<{ id: string; label: string; photoRequirement: "required" | "optional" | "not_asked" }>;
  policyText: string;
  instructions: string;
  items: Array<{ id: string; title: string; variant: string | null; returnable: number; isNonReturnable?: boolean }>;
  returns: Array<{
    id: string;
    number: string;
    status: string;
    reason: string;
    resolution: string;
    requestedResolution: string | null;
    customerComment: string | null;
    exchangeRequest: string | null;
    decisionMessage: string | null;
    refundMethod: string | null;
    refundAmount: number | null;
    exchangeNote: string | null;
    createdAt: string;
  }>;
}

/** What the shopper sees under their order: what can still be returned and the returns already opened. */
export async function getOrderReturnsByToken(rt: Runtime, tenantId: string, token: string): Promise<OrderReturnsView | null> {
  return await withTenant(rt._db.db, tenantId, async (tx) => {
    const orderId = await orderIdForToken(tx, tenantId, token);
    if (!orderId) return null;
    const order = await loadOrder(tx, tenantId, orderId);

    const { readReturnSettings } = await import("../admin/return-settings.ts");
    const settings = await readReturnSettings(tx, tenantId);

    const { readCustomerAccountSettingsInternal } = await import("../admin/customer-account-settings.ts");
    const accountSettings = await readCustomerAccountSettingsInternal(tx, tenantId);

    const items = (await getReturnableItems(tx, tenantId, orderId)).map((i) => ({
      id: i.id,
      title: i.productTitle,
      variant: i.variantTitle && i.variantTitle !== "Default" ? i.variantTitle : null,
      returnable: i.returnable,
      isNonReturnable: i.isNonReturnable,
    }));
    const rows = await tx
      .select()
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, tenantId), eq(schema.returns.orderId, orderId)))
      .orderBy(sql`${schema.returns.createdAt} desc`);

    return {
      orderId,
      canRequest: accountSettings.allowSelfServeReturns && settings.acceptReturns && order.status === "delivered" && items.some((i) => i.returnable > 0),
      acceptReturns: settings.acceptReturns,
      allowExchanges: settings.allowExchanges,
      reasons: isReturnPhotoStorageConfigured()
        ? settings.reasons
        : settings.reasons.map((r) => ({ ...r, photoRequirement: "not_asked" as const })),
      policyText: settings.policyText,
      instructions: settings.instructions,
      items,
      returns: rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        reason: r.reason,
        resolution: r.resolution,
        requestedResolution: r.requestedResolution,
        customerComment: r.customerComment,
        exchangeRequest: r.exchangeRequest,
        decisionMessage: r.decisionMessage,
        refundMethod: r.refundMethod,
        refundAmount: r.refundAmount,
        exchangeNote: r.exchangeNote,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}

export async function requestReturnByToken(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    token: string;
    reason: string;
    resolution?: "refund" | "replacement" | undefined;
    exchangeRequest?: string | undefined;
    customerComment?: string | undefined;
    photos?: string[] | undefined;
    items: Array<{ orderItemId: string; quantity: number }>;
  },
) {
  const { readCustomerAccountSettingsInternal } = await import("../admin/customer-account-settings.ts");
  const accountSettings = await withTenant(rt._db.db, ctx.tenantId, (tx) => readCustomerAccountSettingsInternal(tx, ctx.tenantId));
  if (!accountSettings.allowSelfServeReturns) {
    throw new Error("Precondition: Self-service returns are disabled for this store");
  }

  const orderId = await withTenant(rt._db.db, ctx.tenantId, (tx) => orderIdForToken(tx, ctx.tenantId, input.token));
  if (!orderId) throw new Error("Not Found: This order link is not valid any more");
  return requestReturn(rt, ctx, {
    orderId,
    reason: input.reason,
    resolution: input.resolution,
    exchangeRequest: input.exchangeRequest,
    customerComment: input.customerComment,
    photos: input.photos,
    items: input.items,
  });
}

/**
 * A shopper cancels their order using the secure order-view link/token.
 * Allowed only when allowSelfServeCancellation is enabled, order is not fulfilled/shipped,
 * and payment is unpaid/pending/COD-pending.
 */
export async function cancelOrderByToken(
  rt: Runtime,
  tenantId: string,
  token: string,
  input?: { reason?: string | undefined },
) {
  const { readCustomerAccountSettingsInternal } = await import("../admin/customer-account-settings.ts");
  const accountSettings = await withTenant(rt._db.db, tenantId, (tx) => readCustomerAccountSettingsInternal(tx, tenantId));
  if (!accountSettings.allowSelfServeCancellation) {
    throw new Error("Precondition: Self-service order cancellation is disabled for this store");
  }

  return await withTenant(rt._db.db, tenantId, async (tx) => {
    const orderId = await orderIdForToken(tx, tenantId, token);
    if (!orderId) throw new Error("Not Found: This order link is not valid any more");

    const order = await loadOrder(tx, tenantId, orderId);

    if (order.status === "cancelled") {
      throw new Error("Precondition: Order is already cancelled");
    }
    if (["fulfilled", "delivered", "returned"].includes(order.status)) {
      throw new Error(`Precondition: Cannot cancel an order that is ${order.status}`);
    }

    const shippedStatuses = [
      "shipped",
      "partially_shipped",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "rto",
      "rto_delivered",
    ];
    if (shippedStatuses.includes(order.fulfillmentStatus)) {
      throw new Error("Precondition: Cannot cancel an order that is already shipped or fulfilled");
    }

    const cancellablePaymentStatuses = ["pending", "unpaid", "cod_pending", "failed"];
    if (order.paymentStatus && !cancellablePaymentStatuses.includes(order.paymentStatus)) {
      throw new Error(`Precondition: Cannot cancel an order with payment status '${order.paymentStatus}'`);
    }

    const customerCtx: TenantContext = {
      tenantId,
      storeStatus: "live",
      actor: order.customerId ? { type: "customer", customerId: order.customerId } : { type: "anonymous" },
      roles: [],
      permissions: [],
      requestId: crypto.randomUUID(),
    };

    const cancelReason = input?.reason?.trim() || "Cancelled by customer";

    const txRt = { ...rt, _db: { db: tx } } as unknown as Runtime;
    await transitionOrder(
      txRt,
      customerCtx,
      orderId,
      {
        type: "order.cancel",
        reason: cancelReason,
      },
      tx,
    );

    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorType: "customer",
      actorId: order.customerId ?? null,
      action: "orders.cancel",
      targetType: "order",
      targetId: orderId,
      diff: {
        before: { status: order.status, paymentStatus: order.paymentStatus },
        after: { status: "cancelled", cancelReason },
      },
    });

    return { success: true as const, orderId, status: "cancelled" as const };
  });
}
