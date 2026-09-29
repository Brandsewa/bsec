import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { type Db, orders, orderItems, actionTokens, withTenant } from "@bs/db";

export interface OrderItemSummary {
  id: string;
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface CustomerOrderSummary {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  subtotal: number;
  shippingTotal: number;
  grandTotal: number;
  placedAt: Date;
  itemsCount?: number | undefined;
}

export interface CustomerOrderDetail extends CustomerOrderSummary {
  email: string;
  phone: string;
  shippingAddress: unknown;
  billingAddress: unknown;
  items: OrderItemSummary[];
}

export async function getCustomerOrders(
  db: Db,
  tenantId: string,
  customerId: string,
): Promise<CustomerOrderSummary[]> {
  return await withTenant(db, tenantId, async (tx) => {
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
          eq(orders.customerId, customerId),
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
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.id, orderId),
          eq(orders.customerId, customerId),
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
      shippingTotal: order.shippingTotal,
      grandTotal: order.grandTotal,
      placedAt: order.placedAt,
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
      shippingTotal: order.shippingTotal,
      grandTotal: order.grandTotal,
      placedAt: order.placedAt,
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
      })),
    };
  });
}
