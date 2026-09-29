import { and, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { allocateSequenceNumber } from "../orders/sequences.ts";
import { transitionOrder } from "../orders/state-machine.ts";
import { transitionFulfillment } from "../orders/fulfillment-state-machine.ts";
import { generateInvoice } from "../orders/invoices.ts";
import { isFeatureEnabled, FeatureDisabledError } from "../features.ts";

export interface ListOrdersInput {
  view?: "all" | "unfulfilled" | "unpaid" | "cod_to_confirm" | "rto" | undefined;
  search?: string | undefined;
  status?: string | undefined;
  paymentStatus?: string | undefined;
  fulfillmentStatus?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface OrderListItem {
  id: string;
  number: string;
  customerEmail: string;
  customerPhone: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  grandTotal: number;
  placedAt: string;
  itemsCount: number;
}

export async function listAdminOrders(
  rt: Runtime,
  ctx: TenantContext,
  input: ListOrdersInput = {},
): Promise<{ items: OrderListItem[]; total: number }> {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];

    if (input.view === "unfulfilled") {
      conditions.push(eq(schema.orders.fulfillmentStatus, "unfulfilled"));
    } else if (input.view === "unpaid") {
      conditions.push(eq(schema.orders.paymentStatus, "pending"));
    } else if (input.view === "cod_to_confirm") {
      conditions.push(eq(schema.orders.paymentStatus, "pending"));
      conditions.push(sql`${schema.orders.codFee} > 0`);
    } else if (input.view === "rto") {
      conditions.push(eq(schema.orders.fulfillmentStatus, "rto"));
    }

    if (input.status) conditions.push(eq(schema.orders.status, input.status));
    if (input.paymentStatus) conditions.push(eq(schema.orders.paymentStatus, input.paymentStatus));
    if (input.fulfillmentStatus) conditions.push(eq(schema.orders.fulfillmentStatus, input.fulfillmentStatus));
    if (input.search) {
      conditions.push(
        sql`(${schema.orders.number} ILIKE ${`%${input.search}%`} OR ${schema.orders.email} ILIKE ${`%${input.search}%`} OR ${schema.orders.phone} ILIKE ${`%${input.search}%`})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(whereClause);

    const rows = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        email: schema.orders.email,
        phone: schema.orders.phone,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        fulfillmentStatus: schema.orders.fulfillmentStatus,
        grandTotal: schema.orders.grandTotal,
        placedAt: schema.orders.placedAt,
      })
      .from(schema.orders)
      .where(whereClause)
      .orderBy(desc(schema.orders.placedAt))
      .limit(limit)
      .offset(offset);

    // Compute item counts for the page
    const items: OrderListItem[] = [];
    for (const r of rows) {
      const [itemCountRow] = await tx
        .select({ count: sql<number>`coalesce(sum(${schema.orderItems.quantity}), 0)::int` })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, r.id));

      items.push({
        id: r.id,
        number: r.number,
        customerEmail: r.email,
        customerPhone: r.phone,
        status: r.status,
        paymentStatus: r.paymentStatus,
        fulfillmentStatus: r.fulfillmentStatus,
        grandTotal: Number(r.grandTotal),
        placedAt: r.placedAt.toISOString(),
        itemsCount: itemCountRow?.count ?? 0,
      });
    }

    return {
      items,
      total: countResult?.count ?? 0,
    };
  });
}

export async function getAdminOrderDetail(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, input.id))
      .limit(1);

    if (!order) {
      throw new Error(`Order not found: ${input.id}`);
    }

    const items = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, input.id));

    const fulfillments = await tx
      .select()
      .from(schema.fulfillments)
      .where(eq(schema.fulfillments.orderId, input.id));

    const invoices = await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, input.id));

    const events = await tx
      .select()
      .from(schema.orderEvents)
      .where(eq(schema.orderEvents.orderId, input.id))
      .orderBy(desc(schema.orderEvents.createdAt));

    const notes = await tx
      .select()
      .from(schema.orderNotes)
      .where(eq(schema.orderNotes.orderId, input.id))
      .orderBy(desc(schema.orderNotes.createdAt));

    return {
      order: {
        id: order.id,
        number: order.number,
        email: order.email,
        phone: order.phone,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        subtotal: Number(order.subtotal),
        discountTotal: Number(order.discountTotal),
        shippingTotal: Number(order.shippingTotal),
        taxTotal: Number(order.taxTotal),
        grandTotal: Number(order.grandTotal),
        codFee: Number(order.codFee),
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        placedAt: order.placedAt.toISOString(),
        cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
        cancelReason: order.cancelReason,
      },
      items: items.map((it) => ({
        id: it.id,
        productTitle: it.productTitle,
        variantTitle: it.variantTitle,
        sku: it.sku,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        total: Number(it.total),
        fulfilledQty: it.fulfilledQty,
        returnedQty: it.returnedQty,
      })),
      fulfillments: fulfillments.map((f) => ({
        id: f.id,
        status: f.status,
        carrier: f.carrier,
        awb: f.awb,
        trackingUrl: f.trackingUrl,
        shippedAt: f.shippedAt ? f.shippedAt.toISOString() : null,
        deliveredAt: f.deliveredAt ? f.deliveredAt.toISOString() : null,
      })),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        fy: inv.fy,
        type: inv.type,
        issuedAt: inv.issuedAt.toISOString(),
        totals: inv.totals,
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        message: e.message,
        actorType: e.actorType,
        createdAt: e.createdAt.toISOString(),
      })),
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });
}

export async function createAdminDraftOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    email: string;
    phone: string;
    shippingAddress: Record<string, unknown>;
    items: Array<{ variantId: string; quantity: number }>;
  },
) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const seq = await allocateSequenceNumber(tx, ctx.tenantId, "order", "", {
      defaultPrefix: "ORD-",
      defaultPadding: 5,
    });
    const orderNumber = seq.formatted;

    // Fetch variant details
    let subtotal = 0;
    const itemRows = [];
    for (const it of input.items) {
      const [variant] = await tx
        .select({
          id: schema.variants.id,
          title: schema.variants.title,
          sku: schema.variants.sku,
          price: schema.variants.price,
          productId: schema.variants.productId,
        })
        .from(schema.variants)
        .where(eq(schema.variants.id, it.variantId))
        .limit(1);

      if (!variant) throw new Error(`Variant not found: ${it.variantId}`);

      const [product] = await tx
        .select({ title: schema.products.title, hsn: schema.products.hsn })
        .from(schema.products)
        .where(eq(schema.products.id, variant.productId))
        .limit(1);

      const price = Number(variant.price);
      const lineTotal = price * it.quantity;
      subtotal += lineTotal;

      itemRows.push({
        variantId: variant.id,
        productTitle: product?.title ?? "Product",
        variantTitle: variant.title,
        sku: variant.sku,
        hsn: product?.hsn ?? null,
        quantity: it.quantity,
        unitPrice: price,
        total: lineTotal,
      });
    }

    const grandTotal = subtotal; // 0 shipping/tax default on draft order

    const [order] = await tx
      .insert(schema.orders)
      .values({
        tenantId: ctx.tenantId,
        number: orderNumber,
        email: input.email,
        phone: input.phone,
        status: "pending",
        paymentStatus: "pending",
        fulfillmentStatus: "unfulfilled",
        subtotal,
        discountTotal: 0,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal,
        shippingAddress: input.shippingAddress,
      })
      .returning();

    if (!order) {
      throw new Error("Failed to create draft order");
    }

    for (const item of itemRows) {
      await tx.insert(schema.orderItems).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        ...item,
      });
    }

    const staffId = ctx.actor.type === "staff" ? ctx.actor.userId : "system";

    await tx.insert(schema.orderEvents).values({
      tenantId: ctx.tenantId,
      orderId: order.id,
      type: "order.draft_created",
      message: `Draft order ${orderNumber} created by admin staff`,
      actorType: "staff",
      actorId: staffId,
    });

    return {
      orderId: order.id,
      orderNumber,
      grandTotal,
      payLink: `https://${ctx.tenantId}.gobs.cloud/checkout/pay/${order.id}`,
    };
  });
}

export async function addAdminOrderNote(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; body: string },
) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const authorId = ctx.actor.type === "staff" ? ctx.actor.userId : "system";
    const [note] = await tx
      .insert(schema.orderNotes)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.id,
        authorId,
        body: input.body,
      })
      .returning();

    if (!note) {
      throw new Error("Failed to add order note");
    }

    return {
      success: true,
      noteId: note.id,
    };
  });
}

export async function cancelAdminOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; reason: string },
) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    await transitionOrder(
      rt,
      ctx,
      input.id,
      {
        type: "order.cancel",
        reason: input.reason,
      },
      tx,
    );

    return { success: true };
  });
}

export async function refundAdminOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; amount: number; reason?: string | undefined },
) {
  assertPermission(ctx, "orders.refund");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    // Find active payment intent for order with row lock
    const [existingIntent] = await tx
      .select()
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, ctx.tenantId), eq(schema.paymentIntents.orderId, input.id)))
      .limit(1)
      .for("update");

    let intentId = existingIntent?.id;
    if (!intentId) {
      // Allocate a payment intent record if none existed (e.g. manual/cash)
      const [newIntent] = await tx
        .insert(schema.paymentIntents)
        .values({
          tenantId: ctx.tenantId,
          orderId: input.id,
          amount: input.amount,
          currency: "INR",
          provider: "manual",
          status: "captured",
        })
        .returning();
      if (!newIntent) throw new Error("Failed to create payment intent for refund");
      intentId = newIntent.id;
    }

    // 1. Transition order and payment intent status (locks row and enforces guards)
    await transitionOrder(
      rt,
      ctx,
      input.id,
      {
        type: "payment.refund",
        intentId,
        amount: input.amount,
        reason: input.reason ?? "Admin initiated refund",
      },
      tx,
    );

    // 2. Record refund record
    const [refund] = await tx
      .insert(schema.refunds)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.id,
        intentId,
        amount: input.amount,
        status: "succeeded",
        reason: input.reason ?? "Admin initiated refund",
      })
      .returning();

    if (!refund) throw new Error("Failed to insert refund record");

    return { success: true, refundId: refund.id };
  });
}

export async function createAdminFulfillment(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    id: string;
    locationId?: string | undefined;
    carrier?: string | undefined;
    awb?: string | undefined;
    items?: Array<{ orderItemId: string; quantity: number }> | undefined;
  },
) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  const fulfillmentEnabled = await isFeatureEnabled(db, ctx.tenantId, "fulfillment");
  if (!fulfillmentEnabled) {
    throw new FeatureDisabledError("fulfillment", "Fulfillment is currently disabled for this store");
  }

  return await withTenant(db, ctx.tenantId, async (tx) => {
    let locationId = input.locationId;
    if (!locationId) {
      const [loc] = await tx
        .select({ id: schema.locations.id })
        .from(schema.locations)
        .where(eq(schema.locations.isDefault, true))
        .limit(1);
      locationId = loc?.id;
      if (!locationId) {
        const [anyLoc] = await tx
          .select({ id: schema.locations.id })
          .from(schema.locations)
          .limit(1);
        locationId = anyLoc?.id;
      }
    }
    if (!locationId) throw new Error("No inventory location found to fulfill from");

    const [fulfillment] = await tx
      .insert(schema.fulfillments)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.id,
        locationId,
        status: "pending",
        carrier: input.carrier ?? "Shiprocket",
        awb: input.awb ?? null,
      })
      .returning();

    if (!fulfillment) throw new Error("Failed to create fulfillment record");

    // Line items
    const orderItems = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, input.id));

    const itemsToPack = input.items ?? orderItems.map((oi) => ({ orderItemId: oi.id, quantity: oi.quantity }));
    for (const it of itemsToPack) {
      await tx.insert(schema.fulfillmentItems).values({
        tenantId: ctx.tenantId,
        fulfillmentId: fulfillment.id,
        orderItemId: it.orderItemId,
        quantity: it.quantity,
      });

      // Update fulfilledQty on order_item
      await tx
        .update(schema.orderItems)
        .set({
          fulfilledQty: sql`${schema.orderItems.fulfilledQty} + ${it.quantity}`,
        })
        .where(eq(schema.orderItems.id, it.orderItemId));
    }

    // Progress fulfillment to label_created
    await transitionFulfillment(
      rt,
      ctx,
      fulfillment.id,
      {
        type: "fulfillment.create_label",
        carrier: input.carrier ?? "Shiprocket",
        awb: input.awb,
      },
      tx,
    );

    // Update order fulfillment_status
    await tx
      .update(schema.orders)
      .set({
        fulfillmentStatus: "fulfilled",
      })
      .where(eq(schema.orders.id, input.id));

    return {
      fulfillmentId: fulfillment.id,
      status: "label_created",
    };
  });
}

export async function createAdminOrderInvoice(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const inv = await generateInvoice(rt, ctx, { orderId: input.id }, tx);
    return {
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.number,
    };
  });
}
