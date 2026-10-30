import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type Db, orders, orderItems, orderEvents, returns, returnItems, withTenant } from "@bs/db";
import { ownedBy } from "./orders.ts";
import { getReturnableItems } from "../orders/manual-lifecycle.ts";

/** An order the shopper can still start a return on. */
export interface ReturnableOrder {
  orderId: string;
  number: string;
  placedAt: Date;
  grandTotal: number;
  /** Units that can still be returned, over all lines. */
  returnableUnits: number;
}

export interface CustomerReturnEligibility {
  /** False when the store does not take returns, or does not allow shoppers to start them themselves. */
  enabled: boolean;
  orders: ReturnableOrder[];
}

/** Delivered orders of the signed-in shopper that still have something to return, if the store lets shoppers start returns. */
export async function getCustomerReturnableOrders(db: Db, tenantId: string, customerId: string): Promise<CustomerReturnEligibility> {
  return await withTenant(db, tenantId, async (tx) => {
    const { readReturnSettings } = await import("../admin/return-settings.ts");
    const { readCustomerAccountSettingsInternal } = await import("../admin/customer-account-settings.ts");
    const settings = await readReturnSettings(tx, tenantId);
    const account = await readCustomerAccountSettingsInternal(tx, tenantId);
    if (!(settings.acceptReturns && account.allowSelfServeReturns)) return { enabled: false, orders: [] };

    const owned = await ownedBy(tx, tenantId, customerId);
    const delivered = await tx
      .select({ id: orders.id, number: orders.number, placedAt: orders.placedAt, grandTotal: orders.grandTotal })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "delivered"), owned))
      .orderBy(desc(orders.placedAt));

    const out: ReturnableOrder[] = [];
    for (const o of delivered) {
      const units = (await getReturnableItems(tx, tenantId, o.id)).reduce((n, i) => n + i.returnable, 0);
      if (units > 0) out.push({ orderId: o.id, number: o.number, placedAt: o.placedAt, grandTotal: o.grandTotal, returnableUnits: units });
    }
    return { enabled: true, orders: out };
  });
}

export interface CustomerReturnSummary {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  status: string;
  /** What the store settled on (refund, replacement, store credit). */
  resolution: string;
  units: number;
  createdAt: Date;
}

/** Every return on the shopper's orders, newest first. */
export async function getCustomerReturns(db: Db, tenantId: string, customerId: string): Promise<CustomerReturnSummary[]> {
  return await withTenant(db, tenantId, async (tx) => {
    const owned = await ownedBy(tx, tenantId, customerId);
    const rows = await tx
      .select({
        id: returns.id,
        number: returns.number,
        orderId: returns.orderId,
        orderNumber: orders.number,
        status: returns.status,
        resolution: returns.resolution,
        createdAt: returns.createdAt,
      })
      .from(returns)
      .innerJoin(orders, and(eq(orders.tenantId, returns.tenantId), eq(orders.id, returns.orderId)))
      .where(and(eq(returns.tenantId, tenantId), owned))
      .orderBy(desc(returns.createdAt));
    if (rows.length === 0) return [];
    const qty = await tx
      .select({ returnId: returnItems.returnId, units: sql<number>`coalesce(sum(${returnItems.quantity}), 0)::int` })
      .from(returnItems)
      .where(and(eq(returnItems.tenantId, tenantId), inArray(returnItems.returnId, rows.map((r) => r.id))))
      .groupBy(returnItems.returnId);
    const units = new Map(qty.map((q) => [q.returnId, q.units]));
    return rows.map((r) => ({ ...r, units: units.get(r.id) ?? 0 }));
  });
}

export interface CustomerReturnDetail {
  id: string;
  number: string;
  status: string;
  resolution: string;
  requestedResolution: string | null;
  reason: string;
  customerComment: string | null;
  exchangeRequest: string | null;
  /** The store's message when it approved or turned down the request. */
  decisionMessage: string | null;
  /** How to send the goods back; shown once the return is approved. */
  instructions: string;
  refundMethod: string | null;
  refundAmount: number | null;
  refundedAt: Date | null;
  createdAt: Date;
  order: { id: string; number: string };
  items: Array<{ id: string; title: string; variantTitle: string | null; quantity: number; unitPrice: number }>;
  /** Milestones in fixed wording, oldest first. */
  timeline: Array<{ label: string; at: Date }>;
}

const RETURN_LABELS: Record<string, string> = {
  "return.request": "Return requested",
  "return.approve": "Return approved",
  "return.reject": "Return declined",
  "return.cancel": "Return cancelled",
  "return.pick_up": "Picked up",
  "return.receive": "Received by the store",
  "return.refund": "Refund issued",
  "return.replace": "Replacement arranged",
  "return.close": "Return closed",
};

/** One of the shopper's returns, or null when it is not theirs. Staff-only fields (admin note, restock choice) are never returned. */
export async function getCustomerReturnDetail(db: Db, tenantId: string, customerId: string, returnId: string): Promise<CustomerReturnDetail | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const owned = await ownedBy(tx, tenantId, customerId);
    const [row] = await tx
      .select({ ret: returns, orderNumber: orders.number })
      .from(returns)
      .innerJoin(orders, and(eq(orders.tenantId, returns.tenantId), eq(orders.id, returns.orderId)))
      .where(and(eq(returns.tenantId, tenantId), eq(returns.id, returnId), owned));
    if (!row) return null;
    const { ret } = row;

    const lines = await tx
      .select({
        id: returnItems.id,
        quantity: returnItems.quantity,
        title: orderItems.productTitle,
        variantTitle: orderItems.variantTitle,
        unitPrice: orderItems.unitPrice,
      })
      .from(returnItems)
      .innerJoin(orderItems, and(eq(orderItems.tenantId, returnItems.tenantId), eq(orderItems.id, returnItems.orderItemId)))
      .where(and(eq(returnItems.tenantId, tenantId), eq(returnItems.returnId, ret.id)));

    const events = await tx
      .select({ type: orderEvents.type, createdAt: orderEvents.createdAt })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.tenantId, tenantId),
          eq(orderEvents.orderId, ret.orderId),
          eq(orderEvents.visibleToCustomer, true),
          sql`${orderEvents.data}->>'returnId' = ${ret.id}`,
        ),
      )
      .orderBy(asc(orderEvents.createdAt));
    const timeline = [{ label: "Return requested", at: ret.createdAt }];
    for (const e of events) {
      const label = RETURN_LABELS[e.type];
      if (label && e.type !== "return.request") timeline.push({ label, at: e.createdAt });
    }

    const { readReturnSettings } = await import("../admin/return-settings.ts");
    const settings = await readReturnSettings(tx, tenantId);

    return {
      id: ret.id,
      number: ret.number,
      status: ret.status,
      resolution: ret.resolution,
      requestedResolution: ret.requestedResolution,
      reason: ret.reason,
      customerComment: ret.customerComment,
      exchangeRequest: ret.exchangeRequest,
      decisionMessage: ret.decisionMessage,
      instructions: ret.status === "approved" || ret.status === "picked_up" ? settings.instructions : "",
      refundMethod: ret.refundMethod,
      refundAmount: ret.refundAmount,
      refundedAt: ret.refundedAt,
      createdAt: ret.createdAt,
      order: { id: ret.orderId, number: row.orderNumber },
      items: lines,
      timeline,
    };
  });
}
