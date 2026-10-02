import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { type Db, orders, orderItems, actionTokens, customers, withTenant } from "@bs/db";

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

export interface CustomerOrderDetail extends CustomerOrderSummary {
  email: string;
  phone: string;
  shippingAddress: unknown;
  billingAddress: unknown;
  items: OrderItemSummary[];
}

/**
 * Orders that belong to a signed-in customer: those linked to them, plus guest orders placed with the phone number they
 * just proved they own with an OTP (checkout does not link a guest order to an account).
 */
async function ownedBy(tx: Db, tenantId: string, customerId: string) {
  const [c] = await tx
    .select({
      phone: customers.phone,
      phoneVerified: customers.phoneVerified,
      email: customers.email,
      emailVerified: customers.emailVerified,
    })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));

  const conditions = [eq(orders.customerId, customerId)];
  if (c?.phone && c.phoneVerified) {
    conditions.push(eq(orders.phone, c.phone));
  }
  if (c?.email && c.emailVerified && !c.email.endsWith("@customer.store")) {
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
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    return raw;
  });
}
