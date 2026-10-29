import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { checkRateLimit, RateLimitExceededError } from "../system/rate-limit.ts";
import { type Db, orders, orderItems, orderEvents, fulfillments, fulfillmentItems, trackingEvents, returns, actionTokens, customers, withTenant } from "@bs/db";

export interface OrderItemSummary {
  id: string;
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  shipsOn?: string | null | undefined;
}

export interface CustomerOrderSummary {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  subtotal: number;
  /** Goods discount from a code (0 when none). */
  discountTotal?: number | undefined;
  shippingTotal: number;
  grandTotal: number;
  placedAt: Date;
  shipsOn?: string | null | undefined;
  itemsCount?: number | undefined;
}

/** One parcel: what the carrier was given and where it is. Staff-only fields (location id, label key) are never exposed. */
export interface TrackingShipment {
  id: string;
  status: string;
  carrier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  items: Array<{ orderItemId: string; productTitle: string; variantTitle: string | null; quantity: number }>;
  /** Carrier scan events for this parcel, newest first. */
  events: Array<{ status: string; message: string; location: string | null; occurredAt: Date }>;
}

export interface TrackingTimelineEntry {
  label: string;
  at: Date;
}

export interface OrderTracking {
  shipments: TrackingShipment[];
  /** Units not in any live parcel yet. */
  unshipped: Array<{ orderItemId: string; productTitle: string; variantTitle: string | null; quantity: number }>;
  /** Order-level milestones in the shopper's words, newest first. Raw event messages (which can carry staff text) are never used. */
  timeline: TrackingTimelineEntry[];
}

export interface CustomerOrderDetail extends CustomerOrderSummary {
  email: string;
  phone: string;
  shippingAddress: unknown;
  billingAddress: unknown;
  items: OrderItemSummary[];
  tracking: OrderTracking;
}

// Only these event types reach the shopper, each with a fixed label: a free-text `message` may hold a staff reason.
const TIMELINE_LABELS: Record<string, string> = {
  "order.confirm": "Order confirmed",
  "order.process": "Preparing your order",
  "fulfillment.create_label": "Shipping label created",
  "fulfillment.pick_up": "Picked up by the courier",
  "fulfillment.transit": "On its way",
  "fulfillment.out_for_delivery": "Out for delivery",
  "fulfillment.deliver": "Delivered",
  "fulfillment.rto": "Returning to the seller",
  "fulfillment.rto_deliver": "Returned to the seller",
  "order.cancel": "Order cancelled",
};

/** Parcels, leftover units and a customer-safe timeline for one order. Runs inside the caller's tenant transaction. */
export async function loadOrderTracking(
  tx: Db,
  tenantId: string,
  orderId: string,
  placedAt: Date,
  items: Array<{ id: string; productTitle: string; variantTitle: string | null; quantity: number }>,
): Promise<OrderTracking> {
  const fs = await tx
    .select()
    .from(fulfillments)
    .where(and(eq(fulfillments.tenantId, tenantId), eq(fulfillments.orderId, orderId)))
    .orderBy(asc(fulfillments.createdAt));
  const live = fs.filter((f) => f.status !== "cancelled");
  const ids = live.map((f) => f.id);

  const lines = ids.length
    ? await tx
        .select()
        .from(fulfillmentItems)
        .where(and(eq(fulfillmentItems.tenantId, tenantId), inArray(fulfillmentItems.fulfillmentId, ids)))
    : [];
  const scans = ids.length
    ? await tx
        .select()
        .from(trackingEvents)
        .where(and(eq(trackingEvents.tenantId, tenantId), inArray(trackingEvents.fulfillmentId, ids)))
        .orderBy(sql`${trackingEvents.occurredAt} DESC`)
    : [];

  const byItem = new Map(items.map((i) => [i.id, i]));
  const shippedQty = new Map<string, number>();
  const shipments: TrackingShipment[] = live.map((f) => ({
    id: f.id,
    status: f.status,
    carrier: f.carrier,
    awb: f.awb,
    trackingUrl: f.trackingUrl && /^https?:\/\//i.test(f.trackingUrl) ? f.trackingUrl : null,
    shippedAt: f.shippedAt,
    deliveredAt: f.deliveredAt,
    items: lines
      .filter((l) => l.fulfillmentId === f.id)
      .flatMap((l) => {
        const it = byItem.get(l.orderItemId);
        shippedQty.set(l.orderItemId, (shippedQty.get(l.orderItemId) ?? 0) + l.quantity);
        return it ? [{ orderItemId: it.id, productTitle: it.productTitle, variantTitle: it.variantTitle, quantity: l.quantity }] : [];
      }),
    events: scans
      .filter((e) => e.fulfillmentId === f.id)
      .map((e) => ({ status: e.status, message: e.message, location: e.location, occurredAt: e.occurredAt })),
  }));

  const unshipped = items
    .map((i) => ({ orderItemId: i.id, productTitle: i.productTitle, variantTitle: i.variantTitle, quantity: i.quantity - (shippedQty.get(i.id) ?? 0) }))
    .filter((i) => i.quantity > 0);

  const evs = await tx
    .select({ type: orderEvents.type, createdAt: orderEvents.createdAt })
    .from(orderEvents)
    .where(and(eq(orderEvents.tenantId, tenantId), eq(orderEvents.orderId, orderId), eq(orderEvents.visibleToCustomer, true)))
    .orderBy(asc(orderEvents.createdAt));
  const milestones: TrackingTimelineEntry[] = [{ label: "Order placed", at: placedAt }];
  for (const e of evs) {
    const label = TIMELINE_LABELS[e.type];
    // a split order repeats the courier steps once per parcel; keep the first of each run
    if (label && milestones[milestones.length - 1]?.label !== label) milestones.push({ label, at: e.createdAt });
  }
  return { shipments, unshipped, timeline: milestones.reverse() };
}

/**
 * Orders that belong to a signed-in customer: those linked to them, plus guest orders placed with the phone number they
 * just proved they own with an OTP (checkout does not link a guest order to an account).
 */
export async function ownedBy(tx: Db, tenantId: string, customerId: string) {
  const [c] = await tx
    .select({
      phone: customers.phone,
      phoneVerified: customers.phoneVerified,
      email: customers.email,
      emailVerified: customers.emailVerified,
      isGuest: customers.isGuest,
    })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));

  if (!c) {
    return eq(orders.customerId, customerId);
  }

  // An unverified registration / account must NOT show historical or guest orders until email/phone is verified
  const isVerified = Boolean(c.emailVerified || c.phoneVerified);
  if (!isVerified) {
    // Return empty condition (matching impossible order id) to prevent leaking orders to unverified claimants
    return sql`1 = 0`;
  }

  const conditions = [eq(orders.customerId, customerId)];
  if (c.phone && c.phoneVerified) {
    conditions.push(eq(orders.phone, c.phone));
  }
  if (c.email && c.emailVerified && !c.email.endsWith("@customer.store")) {
    conditions.push(eq(orders.email, c.email));
  }
  const primary = conditions[0] ?? eq(orders.customerId, customerId);
  return conditions.length > 1 ? or(...conditions) : primary;
}

export async function getCustomerOrders(
  db: Db,
  tenantId: string,
  customerId: string,
): Promise<CustomerOrderSummary[]> {
  return await withTenant(db, tenantId, async (tx) => {
    const owned = await ownedBy(tx, tenantId, customerId);
    const rows = await tx
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        fulfillmentStatus: orders.fulfillmentStatus,
        subtotal: orders.subtotal,
        shippingTotal: orders.shippingTotal,
        grandTotal: orders.grandTotal,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          owned,
        ),
      )
      .orderBy(sql`${orders.placedAt} DESC`);

    return rows;
  });
}

export interface CustomerDashboardStats {
  /** Placed and not yet delivered, cancelled or returned. */
  active: number;
  /** Shipped (all or part) and on the way. */
  inTransit: number;
  /** Orders with a return request still being handled, or a parcel being sent back to the seller. */
  inReturn: number;
  delivered: number;
}

/** The four counts on the account dashboard, over the same orders the shopper sees in their order list. */
export async function getCustomerDashboardStats(db: Db, tenantId: string, customerId: string): Promise<CustomerDashboardStats> {
  return await withTenant(db, tenantId, async (tx) => {
    const owned = await ownedBy(tx, tenantId, customerId);
    const rows = await tx
      .select({ id: orders.id, status: orders.status, fulfillmentStatus: orders.fulfillmentStatus })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), owned));
    const open = await tx
      .select({ orderId: returns.orderId })
      .from(returns)
      .where(
        and(
          eq(returns.tenantId, tenantId),
          inArray(returns.orderId, rows.length ? rows.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]),
          inArray(returns.status, ["requested", "approved", "picked_up", "received"]),
        ),
      );
    const done = ["delivered", "cancelled", "returned"];
    // a parcel the courier is sending back to the seller counts as "in return", not as active or in transit
    const coming = rows.filter((r) => r.fulfillmentStatus !== "rto" && r.fulfillmentStatus !== "rto_delivered");
    const returning = new Set(open.map((o) => o.orderId));
    for (const r of rows) if (r.fulfillmentStatus === "rto") returning.add(r.id);
    return {
      active: coming.filter((r) => !done.includes(r.status)).length,
      inTransit: coming.filter((r) => r.status === "fulfilled" || r.status === "partially_fulfilled").length,
      inReturn: returning.size,
      delivered: rows.filter((r) => r.status === "delivered").length,
    };
  });
}

export async function getCustomerOrderDetail(
  db: Db,
  tenantId: string,
  customerId: string,
  orderId: string,
): Promise<CustomerOrderDetail | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const owned = await ownedBy(tx, tenantId, customerId);
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.id, orderId),
          owned,
        ),
      );

    if (!order) return null;

    const items = await tx
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.tenantId, tenantId),
          eq(orderItems.orderId, orderId),
        ),
      );

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      subtotal: order.subtotal,
      discountTotal: Number(order.discountTotal ?? 0),
      shippingTotal: order.shippingTotal,
      grandTotal: order.grandTotal,
      placedAt: order.placedAt,
      shipsOn: order.shipsOn ? String(order.shipsOn) : null,
      email: order.email,
      phone: order.phone,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      items: items.map((it) => ({
        id: it.id,
        variantId: it.variantId,
        productTitle: it.productTitle,
        variantTitle: it.variantTitle,
        sku: it.sku,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
        shipsOn: it.shipsOn ? String(it.shipsOn) : null,
      })),
      tracking: await loadOrderTracking(tx, tenantId, order.id, order.placedAt, items),
    };
  });
}

export async function getOrderByActionToken(
  db: Db,
  tenantId: string,
  token: string,
): Promise<CustomerOrderDetail | null> {
  const tokenHash = createHash("sha256").update(token.trim()).digest("hex");

  return await withTenant(db, tenantId, async (tx) => {
    const [actionToken] = await tx
      .select()
      .from(actionTokens)
      .where(
        and(
          eq(actionTokens.tenantId, tenantId),
          eq(actionTokens.purpose, "order_view"),
          eq(actionTokens.tokenHash, tokenHash),
          gt(actionTokens.expiresAt, new Date()),
        ),
      );

    if (!actionToken) return null;

    const orderId = actionToken.targetId;
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.id, orderId),
        ),
      );

    if (!order) return null;

    const items = await tx
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.tenantId, tenantId),
          eq(orderItems.orderId, orderId),
        ),
      );

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      subtotal: order.subtotal,
      discountTotal: Number(order.discountTotal ?? 0),
      shippingTotal: order.shippingTotal,
      grandTotal: order.grandTotal,
      placedAt: order.placedAt,
      shipsOn: order.shipsOn ? String(order.shipsOn) : null,
      email: order.email,
      phone: order.phone,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      items: items.map((it) => ({
        id: it.id,
        variantId: it.variantId,
        productTitle: it.productTitle,
        variantTitle: it.variantTitle,
        sku: it.sku,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
        shipsOn: it.shipsOn ? String(it.shipsOn) : null,
      })),
      tracking: await loadOrderTracking(tx, tenantId, order.id, order.placedAt, items),
    };
  });
}

/**
 * A fresh 30-day "view this order" token for an order the signed-in customer owns, so the account can link to the
 * existing /o/{token} page (tracking, returns). Null when the order is not theirs.
 */
export async function mintOrderViewTokenForCustomer(
  db: Db,
  tenantId: string,
  customerId: string,
  orderId: string,
  /** How long the link lives; a page that only needs it for one visit asks for a few hours. */
  ttlMs: number = 30 * 86_400_000,
): Promise<string | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const owned = await ownedBy(tx, tenantId, customerId);
    const [order] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), owned));
    if (!order) return null;
    const raw = `ord_${randomBytes(24).toString("hex")}`;
    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "order_view",
      targetId: orderId,
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return raw;
  });
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/** Constant-time string equality (lengths may leak; the compared values are an email or a phone the asker already typed). */
function sameText(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * The public "track my order" lookup: an order number plus the email or phone it was placed with.
 * Returns a 24-hour `order_view` token for the existing /o/{token} page, or null for *every* failure (unknown number,
 * wrong contact, draft order) so the answer never reveals whether an order exists. Throws RateLimitExceededError after
 * repeated attempts from one address or against one order number.
 */
export async function lookupOrderForTracking(
  db: Db,
  tenantId: string,
  input: { number: string; contact: string; ip: string; method?: "either" | "email" | "phone" | undefined },
): Promise<string | null> {
  const number = input.number.trim().replace(/^#/, "").toUpperCase();
  const contact = input.contact.trim();
  if (number.length < 2 || number.length > 40 || contact.length < 3 || contact.length > 120) return null;

  for (const [key, limit] of [
    [`track:ip:${tenantId}:${input.ip}`, 10],
    [`track:order:${tenantId}:${number}`, 6],
  ] as const) {
    const res = await checkRateLimit(db, { key, limit, windowSeconds: 600 });
    if (!res.allowed) {
      throw new RateLimitExceededError(`Too many attempts. Please retry after ${res.retryAfter} seconds.`, res.retryAfter, res.limit, key);
    }
  }

  return await withTenant(db, tenantId, async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, email: orders.email, phone: orders.phone, status: orders.status })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), sql`ltrim(upper(${orders.number}), '#') = ${number}`))
      .limit(1);

    const wantsEmail = contact.includes("@");
    // a store that only accepts one kind of contact treats the other as a plain miss
    if ((input.method === "email" && !wantsEmail) || (input.method === "phone" && wantsEmail)) return null;
    const typed = wantsEmail ? contact.toLowerCase() : digitsOf(contact).slice(-10);
    const actual = order ? (wantsEmail ? order.email.trim().toLowerCase() : digitsOf(order.phone).slice(-10)) : "";
    // always compare, even when there is no order, so a miss costs about the same as a wrong contact
    const matches = sameText(typed, actual) && typed.length >= (wantsEmail ? 3 : 10);
    if (!order || !matches || order.status === "draft") return null;

    const raw = `ord_${randomBytes(24).toString("hex")}`;
    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "order_view",
      targetId: order.id,
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return raw;
  });
}
