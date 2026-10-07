import { and, desc, asc, eq, ne, gte, lte, sql, inArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { getReturnPhotoUrls } from "../orders/return-photos.ts";

export interface AdminReturnStats {
  needsReview: number;
  awaitingItem: number;
  toResolve: number;
  resolvedLast30Days: number;
}

export interface AdminReturnListItem {
  id: string;
  number: string;
  status: string;
  reason: string;
  resolution: string;
  requestedResolution: string | null;
  customerComment: string | null;
  exchangeRequest: string | null;
  decisionMessage: string | null;
  adminNote: string | null;
  refundMethod: string | null;
  refundReference: string | null;
  refundAmount: number | null;
  refundedAt: string | null;
  exchangeNote: string | null;
  exchangeOrderId: string | null;
  photosCount: number;
  createdAt: string;
  updatedAt: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  customerEmail: string | null;
  customerName: string | null;
  items: Array<{ title: string; variantTitle: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
  computedRefundAmount: number;
}

export interface ListAdminReturnsInput {
  view?: "all" | "needs_review" | "approved" | "received" | "resolved" | "rejected_closed" | "archived" | undefined;
  search?: string | undefined;
  resolution?: "refund" | "replacement" | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  sort?: "created_desc" | "created_asc" | "amount_desc" | "amount_asc" | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ListAdminReturnsResult {
  items: AdminReturnListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Reads KPI aggregate metrics for Returns workbench (ORDERS-RETURNS-PLAN §3.4).
 */
export async function getAdminReturnStats(
  rt: Runtime,
  ctx: TenantContext,
): Promise<AdminReturnStats> {
  assertPermission(ctx, "orders.read");

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [stats] = await tx
      .select({
        needsReview: sql<number>`count(*) filter (where ${schema.returns.status} = 'requested')::int`,
        awaitingItem: sql<number>`count(*) filter (where ${schema.returns.status} in ('approved', 'picked_up'))::int`,
        toResolve: sql<number>`count(*) filter (where ${schema.returns.status} = 'received')::int`,
        resolvedLast30Days: sql<number>`count(*) filter (where ${schema.returns.status} in ('refunded', 'replaced') and ${schema.returns.updatedAt} >= now() - interval '30 days')::int`,
      })
      .from(schema.returns)
      .where(eq(schema.returns.tenantId, ctx.tenantId));

    return {
      needsReview: stats?.needsReview ?? 0,
      awaitingItem: stats?.awaitingItem ?? 0,
      toResolve: stats?.toResolve ?? 0,
      resolvedLast30Days: stats?.resolvedLast30Days ?? 0,
    };
  });
}

/**
 * Lists returns with tabs, search, filters, sorting, and pagination (ORDERS-RETURNS-PLAN §3.4).
 */
export async function listAdminReturns(
  rt: Runtime,
  ctx: TenantContext,
  input: ListAdminReturnsInput = {},
): Promise<ListAdminReturnsResult> {
  assertPermission(ctx, "orders.read");

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const conditions = [eq(schema.returns.tenantId, ctx.tenantId)];

    // Tab / View filtering
    if (input.view === "needs_review") {
      conditions.push(eq(schema.returns.status, "requested"));
    } else if (input.view === "approved") {
      conditions.push(inArray(schema.returns.status, ["approved", "picked_up"]));
    } else if (input.view === "received") {
      conditions.push(eq(schema.returns.status, "received"));
    } else if (input.view === "resolved") {
      conditions.push(inArray(schema.returns.status, ["refunded", "replaced"]));
    } else if (input.view === "rejected_closed") {
      conditions.push(inArray(schema.returns.status, ["rejected", "cancelled", "closed"]));
    } else if (input.view === "archived") {
      conditions.push(eq(schema.returns.status, "archived"));
    } else {
      conditions.push(ne(schema.returns.status, "archived"));
    }

    // Resolution filter
    if (input.resolution) {
      conditions.push(eq(schema.returns.resolution, input.resolution));
    }

    // Date range filter
    if (input.dateFrom) {
      conditions.push(gte(schema.returns.createdAt, new Date(input.dateFrom)));
    }
    if (input.dateTo) {
      const to = new Date(input.dateTo);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.returns.createdAt, to));
    }

    // Search query
    if (input.search && input.search.trim()) {
      const term = `%${input.search.trim()}%`;
      conditions.push(
        sql`(${schema.returns.number} ILIKE ${term} OR ${schema.orders.number} ILIKE ${term} OR ${schema.orders.email} ILIKE ${term} OR (${schema.orders.shippingAddress}->>'fullName') ILIKE ${term})`,
      );
    }

    const whereClause = and(...conditions);

    // Total count
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.returns)
      .innerJoin(schema.orders, and(eq(schema.orders.tenantId, schema.returns.tenantId), eq(schema.orders.id, schema.returns.orderId)))
      .where(whereClause);
    const total = countRow?.count ?? 0;

    // Sort order
    let orderClause = desc(schema.returns.createdAt);
    if (input.sort === "created_asc") {
      orderClause = asc(schema.returns.createdAt);
    } else if (input.sort === "amount_desc") {
      orderClause = desc(schema.returns.refundAmount);
    } else if (input.sort === "amount_asc") {
      orderClause = asc(schema.returns.refundAmount);
    }

    const rows = await tx
      .select({
        id: schema.returns.id,
        number: schema.returns.number,
        status: schema.returns.status,
        reason: schema.returns.reason,
        resolution: schema.returns.resolution,
        requestedResolution: schema.returns.requestedResolution,
        customerComment: schema.returns.customerComment,
        exchangeRequest: schema.returns.exchangeRequest,
        decisionMessage: schema.returns.decisionMessage,
        adminNote: schema.returns.adminNote,
        refundMethod: schema.returns.refundMethod,
        refundReference: schema.returns.refundReference,
        refundAmount: schema.returns.refundAmount,
        refundedAt: schema.returns.refundedAt,
        exchangeNote: schema.returns.exchangeNote,
        exchangeOrderId: schema.returns.exchangeOrderId,
        photos: schema.returns.photos,
        createdAt: schema.returns.createdAt,
        updatedAt: schema.returns.updatedAt,
        orderId: schema.returns.orderId,
        orderNumber: schema.orders.number,
        orderStatus: schema.orders.status,
        customerEmail: schema.orders.email,
        customerName: sql<string | null>`${schema.orders.shippingAddress}->>'fullName'`,
      })
      .from(schema.returns)
      .innerJoin(schema.orders, and(eq(schema.orders.tenantId, schema.returns.tenantId), eq(schema.orders.id, schema.returns.orderId)))
      .where(whereClause)
      .orderBy(orderClause)
      .limit(pageSize)
      .offset(offset);

    const returnIds = rows.map((r) => r.id);
    const lineItems = returnIds.length
      ? await tx
          .select({
            returnId: schema.returnItems.returnId,
            quantity: schema.returnItems.quantity,
            title: schema.orderItems.productTitle,
            variantTitle: schema.orderItems.variantTitle,
            unitPrice: schema.orderItems.unitPrice,
            lineTotal: schema.orderItems.total,
            bought: schema.orderItems.quantity,
          })
          .from(schema.returnItems)
          .innerJoin(
            schema.orderItems,
            and(eq(schema.orderItems.tenantId, schema.returnItems.tenantId), eq(schema.orderItems.id, schema.returnItems.orderItemId)),
          )
          .where(and(eq(schema.returnItems.tenantId, ctx.tenantId), inArray(schema.returnItems.returnId, returnIds)))
      : [];

    const items: AdminReturnListItem[] = rows.map((r) => {
      const retLines = lineItems.filter((l) => l.returnId === r.id);
      const computedRefundAmount = Math.round(
        retLines.reduce((sum, l) => sum + (l.quantity * l.lineTotal) / Math.max(1, l.bought), 0),
      );

      return {
        id: r.id,
        number: r.number,
        status: r.status,
        reason: r.reason,
        resolution: r.resolution,
        requestedResolution: r.requestedResolution,
        customerComment: r.customerComment,
        exchangeRequest: r.exchangeRequest,
        decisionMessage: r.decisionMessage,
        adminNote: r.adminNote,
        refundMethod: r.refundMethod,
        refundReference: r.refundReference,
        refundAmount: r.refundAmount,
        refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
        exchangeNote: r.exchangeNote,
        exchangeOrderId: r.exchangeOrderId,
        photosCount: Array.isArray(r.photos) ? r.photos.length : 0,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        orderStatus: r.orderStatus,
        customerEmail: r.customerEmail,
        customerName: r.customerName,
        items: retLines.map((l) => ({
          title: l.title,
          variantTitle: l.variantTitle,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        computedRefundAmount,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
    };
  });
}

export interface AdminReturnDetail {
  id: string;
  number: string;
  status: string;
  reason: string;
  resolution: string;
  requestedResolution: string | null;
  customerComment: string | null;
  exchangeRequest: string | null;
  decisionMessage: string | null;
  adminNote: string | null;
  refundMethod: string | null;
  refundReference: string | null;
  refundAmount: number | null;
  refundedAt: string | null;
  exchangeNote: string | null;
  exchangeOrderId: string | null;
  photos: Array<{ id: string; url: string; filename: string }>;
  createdAt: string;
  updatedAt: string;
  order: {
    id: string;
    number: string;
    status: string;
    paymentStatus: string;
    grandTotal: number;
    totalAlreadyRefunded: number;
    maxRefundable: number;
    paymentMethod: string;
    customerEmail: string | null;
    customerName: string | null;
    customerPhone: string | null;
    shippingAddress: Record<string, unknown> | null;
    createdAt: string;
  };
  items: Array<{
    id: string;
    orderItemId: string;
    title: string;
    variantTitle: string | null;
    quantity: number;
    bought: number;
    unitPrice: number;
    lineTotal: number;
    restock: boolean;
  }>;
  computedRefundAmount: number;
  timeline: Array<{
    id: string;
    type: string;
    message: string;
    actorType: string;
    actorId: string | null;
    createdAt: string;
    data: Record<string, unknown> | null;
  }>;
}

/**
 * Reads complete return case details for the admin review sheet (ORDERS-RETURNS-PLAN §3.4).
 */
export async function getAdminReturnDetail(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<AdminReturnDetail> {
  assertPermission(ctx, "orders.read");

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [ret] = await tx
      .select()
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    if (!ret) throw new Error("Not Found: Return not found");

    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, ret.orderId)));

    if (!order) throw new Error("Not Found: Order not found");

    // Existing refunds for this order
    const existingRefunds = await tx
      .select({ amount: schema.refunds.amount })
      .from(schema.refunds)
      .where(and(eq(schema.refunds.tenantId, ctx.tenantId), eq(schema.refunds.orderId, order.id), eq(schema.refunds.status, "succeeded")));
    const totalAlreadyRefunded = existingRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
    const maxRefundable = Math.max(0, order.grandTotal - totalAlreadyRefunded);

    const [intent] = await tx
      .select({ provider: schema.paymentIntents.provider })
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, ctx.tenantId), eq(schema.paymentIntents.orderId, order.id)))
      .limit(1);
    const paymentMethod = intent?.provider ?? "cod";

    // Return items
    const lines = await tx
      .select({
        id: schema.returnItems.id,
        orderItemId: schema.returnItems.orderItemId,
        quantity: schema.returnItems.quantity,
        restock: schema.returnItems.restock,
        title: schema.orderItems.productTitle,
        variantTitle: schema.orderItems.variantTitle,
        unitPrice: schema.orderItems.unitPrice,
        lineTotal: schema.orderItems.total,
        bought: schema.orderItems.quantity,
      })
      .from(schema.returnItems)
      .innerJoin(
        schema.orderItems,
        and(eq(schema.orderItems.tenantId, schema.returnItems.tenantId), eq(schema.orderItems.id, schema.returnItems.orderItemId)),
      )
      .where(and(eq(schema.returnItems.tenantId, ctx.tenantId), eq(schema.returnItems.returnId, ret.id)));

    const computedRefundAmount = Math.round(
      lines.reduce((sum, l) => sum + (l.quantity * l.lineTotal) / Math.max(1, l.bought), 0),
    );

    // Photos signed URLs
    const photos = await getReturnPhotoUrls(tx, ctx.tenantId, ret.photos ?? []);

    // Timeline events
    const timelineEvents = await tx
      .select({
        id: schema.orderEvents.id,
        type: schema.orderEvents.type,
        message: schema.orderEvents.message,
        actorType: schema.orderEvents.actorType,
        actorId: schema.orderEvents.actorId,
        createdAt: schema.orderEvents.createdAt,
        data: schema.orderEvents.data,
      })
      .from(schema.orderEvents)
      .where(
        and(
          eq(schema.orderEvents.tenantId, ctx.tenantId),
          eq(schema.orderEvents.orderId, order.id),
          sql`(${schema.orderEvents.data}->>'returnId' = ${ret.id} OR ${schema.orderEvents.data}->>'returnNumber' = ${ret.number} OR ${schema.orderEvents.type} LIKE 'return.%')`,
        ),
      )
      .orderBy(desc(schema.orderEvents.createdAt));

    const shippingAddress = (order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : null) as Record<string, unknown> | null;
    const customerName = typeof shippingAddress?.fullName === "string" ? shippingAddress.fullName : null;
    const customerPhone = typeof shippingAddress?.phone === "string" ? shippingAddress.phone : null;

    return {
      id: ret.id,
      number: ret.number,
      status: ret.status,
      reason: ret.reason,
      resolution: ret.resolution,
      requestedResolution: ret.requestedResolution,
      customerComment: ret.customerComment,
      exchangeRequest: ret.exchangeRequest,
      decisionMessage: ret.decisionMessage,
      adminNote: ret.adminNote,
      refundMethod: ret.refundMethod,
      refundReference: ret.refundReference,
      refundAmount: ret.refundAmount,
      refundedAt: ret.refundedAt ? ret.refundedAt.toISOString() : null,
      exchangeNote: ret.exchangeNote,
      exchangeOrderId: ret.exchangeOrderId,
      photos,
      createdAt: ret.createdAt.toISOString(),
      updatedAt: ret.updatedAt.toISOString(),
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        paymentStatus: order.paymentStatus,
        grandTotal: order.grandTotal,
        totalAlreadyRefunded,
        maxRefundable,
        paymentMethod,
        customerEmail: order.email,
        customerName,
        customerPhone,
        shippingAddress,
        createdAt: order.createdAt.toISOString(),
      },
      items: lines.map((l) => ({
        id: l.id,
        orderItemId: l.orderItemId,
        title: l.title,
        variantTitle: l.variantTitle,
        quantity: l.quantity,
        bought: l.bought,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        restock: l.restock,
      })),
      computedRefundAmount,
      timeline: timelineEvents.map((t) => ({
        id: t.id,
        type: t.type,
        message: t.message,
        actorType: t.actorType,
        actorId: t.actorId,
        createdAt: t.createdAt.toISOString(),
        data: t.data && typeof t.data === "object" ? (t.data as Record<string, unknown>) : null,
      })),
    };
  });
}

/**
 * Archives a return case so it is hidden from active operational views.
 */
export async function archiveAdminReturn(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "orders.write");

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [ret] = await tx
      .select({ id: schema.returns.id, orderId: schema.returns.orderId, number: schema.returns.number })
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    if (!ret) throw new Error("Not Found: Return not found");

    await tx
      .update(schema.returns)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    await tx.insert(schema.orderEvents).values({
      tenantId: ctx.tenantId,
      orderId: ret.orderId,
      type: "return.archived",
      message: `Return ${ret.number} archived`,
      data: { returnId: ret.id, returnNumber: ret.number },
      actorType: ctx.actor?.type ?? "system",
      actorId: ctx.actor && "userId" in ctx.actor ? ctx.actor.userId : null,
      visibleToCustomer: false,
    });

    return { success: true };
  });
}

/**
 * Restores an archived return case back to closed status.
 */
export async function restoreAdminReturn(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "orders.write");

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [ret] = await tx
      .select({ id: schema.returns.id, orderId: schema.returns.orderId, number: schema.returns.number })
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    if (!ret) throw new Error("Not Found: Return not found");

    await tx
      .update(schema.returns)
      .set({ status: "closed", updatedAt: new Date() })
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    await tx.insert(schema.orderEvents).values({
      tenantId: ctx.tenantId,
      orderId: ret.orderId,
      type: "return.restored",
      message: `Return ${ret.number} restored from archive`,
      data: { returnId: ret.id, returnNumber: ret.number },
      actorType: ctx.actor?.type ?? "system",
      actorId: ctx.actor && "userId" in ctx.actor ? ctx.actor.userId : null,
      visibleToCustomer: false,
    });

    return { success: true };
  });
}

/**
 * Permanently deletes a return case. Requires the return to be archived first.
 */
export async function deleteAdminReturn(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "orders.write");

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [ret] = await tx
      .select({
        id: schema.returns.id,
        status: schema.returns.status,
        orderId: schema.returns.orderId,
        number: schema.returns.number,
      })
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    if (!ret) throw new Error("Not Found: Return not found");

    if (ret.status !== "archived") {
      throw new Error("Only archived returns can be deleted. Please archive the return first.");
    }

    await tx
      .delete(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.id, input.id)));

    await tx.insert(schema.orderEvents).values({
      tenantId: ctx.tenantId,
      orderId: ret.orderId,
      type: "return.deleted",
      message: `Return ${ret.number} permanently deleted`,
      data: { returnNumber: ret.number },
      actorType: ctx.actor?.type ?? "system",
      actorId: ctx.actor && "userId" in ctx.actor ? ctx.actor.userId : null,
      visibleToCustomer: false,
    });

    return { success: true };
  });
}
