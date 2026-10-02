import { createHash } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { commitReservation } from "../catalog/inventory-reservations.ts";
import { transitionOrder, type OrderStatus } from "./state-machine.ts";
import { transitionFulfillment, type FulfillmentTransitionEvent } from "./fulfillment-state-machine.ts";
import { createAdminFulfillment } from "../admin/orders.ts";

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
    await transitionOrder(rt, ctx, input.id, { type: "order.confirm", reason: "Confirmed by the store" }, tx);
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
    const fs = await tx
      .select()
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.tenantId, ctx.tenantId), eq(schema.fulfillments.orderId, input.id)));

    for (const f of fs.filter((x) => x.status !== "cancelled")) {
      if (f.status === "delivered") continue;
      if (f.status === "rto" || f.status === "rto_delivered") throw new Error("Precondition: This shipment is being returned to origin");
      for (const ev of FULFILLMENT_CHAIN[f.status] ?? []) {
        await transitionFulfillment(rt, ctx, f.id, ev, tx);
      }
      if (input.to === "delivered") {
        await transitionFulfillment(rt, ctx, f.id, { type: "fulfillment.deliver" }, tx);
      }
    }

    const order = await loadOrder(tx, ctx.tenantId, input.id);
    await walkOrder(rt, ctx, tx, input.id, order.status, input.to === "delivered" ? "delivered" : "fulfilled");

    if (input.to === "delivered") {
      const due = await tx
        .select({ id: schema.paymentIntents.id })
        .from(schema.paymentIntents)
        .where(
          and(
            eq(schema.paymentIntents.tenantId, ctx.tenantId),
            eq(schema.paymentIntents.orderId, input.id),
            eq(schema.paymentIntents.status, "cod_pending"),
          ),
        );
      for (const p of due) {
        await transitionOrder(rt, ctx, input.id, { type: "payment.cod_collect", intentId: p.id }, tx);
      }
    }
    return { success: true as const, status: input.to };
  });
}

// ---------------------------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------------------------

export const RETURN_WINDOW_DAYS = 7;

export interface ReturnRequestInput {
  orderId: string;
  reason: string;
  resolution?: "refund" | "replacement" | "store_credit" | undefined;
  items: Array<{ orderItemId: string; quantity: number }>;
}

/** Items of a delivered order still returnable: bought minus already returned or in a live return. */
export async function getReturnableItems(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
  orderId: string,
) {
  const items = await tx
    .select()
    .from(schema.orderItems)
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
  return items.map((i) => ({ ...i, returnable: Math.max(0, i.quantity - (held.get(i.id) ?? 0)) }));
}

async function nextReturnNumber(rt: Runtime, tenantId: string) {
  const { allocateSequenceNumber } = await import("./sequences.ts");
  return (await allocateSequenceNumber(rt._db.db, tenantId, "return", "", { defaultPrefix: "RET-", defaultPadding: 4 })).formatted;
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

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const order = await loadOrder(tx, ctx.tenantId, input.orderId);
    if (order.status !== "delivered") throw new Error("Precondition: Only delivered orders can be returned");

    const [delivered] = await tx
      .select({ at: sql<Date | null>`max(${schema.fulfillments.deliveredAt})` })
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.tenantId, ctx.tenantId), eq(schema.fulfillments.orderId, input.orderId)));
    const since = delivered?.at ? new Date(delivered.at) : order.updatedAt;
    if (Date.now() - since.getTime() > RETURN_WINDOW_DAYS * 86_400_000) {
      throw new Error(`Precondition: The ${RETURN_WINDOW_DAYS}-day return window has passed`);
    }

    const returnable = new Map((await getReturnableItems(tx, ctx.tenantId, input.orderId)).map((i) => [i.id, i.returnable]));
    for (const w of wanted) {
      const left = returnable.get(w.orderItemId);
      if (left === undefined) throw new Error("Bad Request: That item isn't on this order");
      if (w.quantity > left) throw new Error(left === 0 ? "Conflict: That item has already been returned" : `Conflict: You can return at most ${left} of that item`);
    }

    const number = await nextReturnNumber(rt, ctx.tenantId);
    const [ret] = await tx
      .insert(schema.returns)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.orderId,
        customerId: order.customerId ?? null,
        number,
        reason,
        resolution: input.resolution ?? "refund",
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
      message: `Return ${number} requested: ${reason}`,
      data: { returnId: ret.id, returnNumber: number },
      actorType: ctx.actor?.type ?? "customer",
      visibleToCustomer: true,
    });
    return { returnId: ret.id, number };
  });
}

export async function listAdminReturns(rt: Runtime, ctx: TenantContext, input: { status?: string | undefined } = {}) {
  assertPermission(ctx, "orders.read");
  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.returns.id,
        number: schema.returns.number,
        status: schema.returns.status,
        reason: schema.returns.reason,
        resolution: schema.returns.resolution,
        adminNote: schema.returns.adminNote,
        createdAt: schema.returns.createdAt,
        orderId: schema.returns.orderId,
        orderNumber: schema.orders.number,
        customerEmail: schema.orders.email,
      })
      .from(schema.returns)
      .innerJoin(schema.orders, and(eq(schema.orders.tenantId, schema.returns.tenantId), eq(schema.orders.id, schema.returns.orderId)))
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), input.status ? eq(schema.returns.status, input.status) : undefined))
      .orderBy(sql`${schema.returns.createdAt} desc`)
      .limit(200);
    const ids = rows.map((r) => r.id);
    const items = ids.length
      ? await tx
          .select({ returnId: schema.returnItems.returnId, quantity: schema.returnItems.quantity, title: schema.orderItems.productTitle, lineTotal: schema.orderItems.total, bought: schema.orderItems.quantity })
          .from(schema.returnItems)
          .innerJoin(schema.orderItems, and(eq(schema.orderItems.tenantId, schema.returnItems.tenantId), eq(schema.orderItems.id, schema.returnItems.orderItemId)))
          .where(and(eq(schema.returnItems.tenantId, ctx.tenantId), inArray(schema.returnItems.returnId, ids)))
      : [];
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      items: items.filter((i) => i.returnId === r.id).map((i) => ({ title: i.title, quantity: i.quantity })),
      refundAmount: items.filter((i) => i.returnId === r.id).reduce((s, i) => s + Math.round((i.quantity * i.lineTotal) / Math.max(1, i.bought)), 0),
    }));
  });
}

export type ReturnAction = "approve" | "reject" | "pick_up" | "receive" | "refund" | "close";

/** Move a return forward; `refund` also records the money going back and (when stock is restocked) puts items back on the shelf. */
export async function actOnReturn(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; action: ReturnAction; note?: string | undefined; restock?: boolean | undefined },
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

    switch (input.action) {
      case "approve":
        await transitionReturn(rt, ctx, input.id, { type: "return.approve", adminNote: input.note }, tx);
        break;
      case "reject":
        await transitionReturn(rt, ctx, input.id, { type: "return.reject", reason: input.note?.trim() || "Not eligible", adminNote: input.note }, tx);
        break;
      case "pick_up":
        await transitionReturn(rt, ctx, input.id, { type: "return.pick_up" }, tx);
        break;
      case "close":
        await transitionReturn(rt, ctx, input.id, { type: "return.close", note: input.note }, tx);
        break;
      case "receive": {
        await transitionReturn(rt, ctx, input.id, { type: "return.receive", restock: input.restock }, tx);
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
        break;
      }
      case "refund": {
        const lines = await tx
          .select({ quantity: schema.returnItems.quantity, lineTotal: schema.orderItems.total, bought: schema.orderItems.quantity })
          .from(schema.returnItems)
          .innerJoin(schema.orderItems, and(eq(schema.orderItems.tenantId, schema.returnItems.tenantId), eq(schema.orderItems.id, schema.returnItems.orderItemId)))
          .where(and(eq(schema.returnItems.tenantId, ctx.tenantId), eq(schema.returnItems.returnId, input.id)));
        // what the shopper actually paid for those units (the line total already has any discount taken off)
        const amount = Math.round(lines.reduce((s, l) => s + (l.quantity * l.lineTotal) / Math.max(1, l.bought), 0));
        const [intent] = await tx
          .select()
          .from(schema.paymentIntents)
          .where(and(eq(schema.paymentIntents.tenantId, ctx.tenantId), eq(schema.paymentIntents.orderId, ret.orderId)))
          .limit(1);
        if (!intent) throw new Error("Precondition: This order has no payment to refund");
        await transitionReturn(rt, ctx, input.id, { type: "return.refund", refundAmount: amount }, tx);
        // Online payments move through the payment state machine; cash on delivery is refunded by hand, so just record it.
        if (intent.status === "captured" || intent.status === "partially_refunded") {
          await transitionOrder(rt, ctx, ret.orderId, { type: "payment.partial_refund", intentId: intent.id, amount, reason: `Return ${ret.number}` }, tx);
        }
        await tx.insert(schema.refunds).values({
          tenantId: ctx.tenantId,
          orderId: ret.orderId,
          intentId: intent.id,
          amount,
          status: "succeeded",
          reason: `Return ${ret.number}`,
          initiatedBy: "admin",
        });
        break;
      }
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
  items: Array<{ id: string; title: string; variant: string | null; returnable: number }>;
  returns: Array<{ number: string; status: string; reason: string; createdAt: string }>;
}

/** What the shopper sees under their order: what can still be returned and the returns already opened. */
export async function getOrderReturnsByToken(rt: Runtime, tenantId: string, token: string): Promise<OrderReturnsView | null> {
  return await withTenant(rt._db.db, tenantId, async (tx) => {
    const orderId = await orderIdForToken(tx, tenantId, token);
    if (!orderId) return null;
    const order = await loadOrder(tx, tenantId, orderId);
    const items = (await getReturnableItems(tx, tenantId, orderId)).map((i) => ({
      id: i.id,
      title: i.productTitle,
      variant: i.variantTitle && i.variantTitle !== "Default" ? i.variantTitle : null,
      returnable: i.returnable,
    }));
    const rows = await tx
      .select()
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, tenantId), eq(schema.returns.orderId, orderId)))
      .orderBy(sql`${schema.returns.createdAt} desc`);
    return {
      orderId,
      canRequest: order.status === "delivered" && items.some((i) => i.returnable > 0),
      items,
      returns: rows.map((r) => ({ number: r.number, status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString() })),
    };
  });
}

export async function requestReturnByToken(
  rt: Runtime,
  ctx: TenantContext,
  input: { token: string; reason: string; items: Array<{ orderItemId: string; quantity: number }> },
) {
  const orderId = await withTenant(rt._db.db, ctx.tenantId, (tx) => orderIdForToken(tx, ctx.tenantId, input.token));
  if (!orderId) throw new Error("Not Found: This order link is not valid any more");
  return requestReturn(rt, ctx, { orderId, reason: input.reason, items: input.items });
}
