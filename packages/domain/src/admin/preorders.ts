import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, withTenant, QUEUE_NAMES } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

export interface ListPreordersInput {
  view?: "all" | "waiting" | "ready" | "shipped" | "cancelled" | undefined;
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  sort?: "ships_asc" | "ships_desc" | "placed_asc" | "placed_desc" | undefined;
}

export interface PreorderItemRecord {
  id: string;
  number: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerName: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  grandTotal: number;
  placedAt: string;
  shipsOn: string;
  preorderReleasedAt: string | null;
  itemsCount: number;
  preorderItemsCount: number;
  firstItemTitle: string | null;
}

export interface PreorderStatsRecord {
  openPreorders: number;
  readyToShip: number;
  dueNext14Days: number;
  overdue: number;
}

function nameFromAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null;
  const a = address as { fullName?: unknown; name?: unknown };
  if (typeof a.fullName === "string" && a.fullName.trim()) return a.fullName.trim();
  if (typeof a.name === "string" && a.name.trim()) return a.name.trim();
  return null;
}

/**
 * Lists preorders for the tenant with view filtering and pagination (ORDERS-PREORDERS-PLAN §3.3).
 */
export async function listPreorders(
  rt: Runtime,
  ctx: TenantContext,
  input: ListPreordersInput = {},
): Promise<{ items: PreorderItemRecord[]; total: number; page: number; pageSize: number }> {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const today = new Date().toISOString().slice(0, 10);
    const conditions = [
      eq(schema.orders.tenantId, ctx.tenantId),
      isNotNull(schema.orders.shipsOn),
    ];

    const view = input.view ?? "all";
    if (view === "waiting") {
      // Future date, not released, not shipped, not cancelled
      conditions.push(
        gt(schema.orders.shipsOn, today),
        isNull(schema.orders.preorderReleasedAt),
        sql`${schema.orders.status} NOT IN ('cancelled', 'fulfilled', 'delivered')`,
        sql`${schema.orders.fulfillmentStatus} != 'fulfilled'`,
      );
    } else if (view === "ready") {
      // Date reached OR released early, not shipped, not cancelled
      conditions.push(
        sql`(${schema.orders.shipsOn} <= ${today} OR ${schema.orders.preorderReleasedAt} IS NOT NULL)`,
        sql`${schema.orders.status} NOT IN ('cancelled', 'fulfilled', 'delivered')`,
        sql`${schema.orders.fulfillmentStatus} != 'fulfilled'`,
      );
    } else if (view === "shipped") {
      conditions.push(
        sql`(${schema.orders.fulfillmentStatus} = 'fulfilled' OR ${schema.orders.status} IN ('fulfilled', 'delivered'))`,
      );
    } else if (view === "cancelled") {
      conditions.push(eq(schema.orders.status, "cancelled"));
    }

    if (input.search && input.search.trim()) {
      const q = `%${input.search.trim()}%`;
      conditions.push(
        sql`(${schema.orders.number} ILIKE ${q} OR ${schema.orders.email} ILIKE ${q} OR ${schema.orders.phone} ILIKE ${q})`,
      );
    }

    const whereClause = and(...conditions);

    const orderBy = {
      ships_asc: [asc(schema.orders.shipsOn), asc(schema.orders.placedAt), asc(schema.orders.id)],
      ships_desc: [desc(schema.orders.shipsOn), desc(schema.orders.placedAt), desc(schema.orders.id)],
      placed_asc: [asc(schema.orders.placedAt), asc(schema.orders.id)],
      placed_desc: [desc(schema.orders.placedAt), desc(schema.orders.id)],
    }[input.sort ?? "ships_asc"];

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
        shippingAddress: schema.orders.shippingAddress,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        fulfillmentStatus: schema.orders.fulfillmentStatus,
        grandTotal: schema.orders.grandTotal,
        placedAt: schema.orders.placedAt,
        shipsOn: schema.orders.shipsOn,
        preorderReleasedAt: schema.orders.preorderReleasedAt,
      })
      .from(schema.orders)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset);

    if (rows.length === 0) {
      return {
        items: [],
        total: countResult?.count ?? 0,
        page,
        pageSize,
      };
    }

    const orderIds = rows.map((r) => r.id);

    // Item counts for page (total and preorder items)
    const countRows = await tx
      .select({
        orderId: schema.orderItems.orderId,
        totalCount: sql<number>`coalesce(sum(${schema.orderItems.quantity}), 0)::int`,
        preorderCount: sql<number>`coalesce(sum(case when ${schema.orderItems.shipsOn} is not null then ${schema.orderItems.quantity} else 0 end), 0)::int`,
      })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.tenantId, ctx.tenantId), inArray(schema.orderItems.orderId, orderIds)))
      .groupBy(schema.orderItems.orderId);

    const countsMap = new Map(countRows.map((c) => [c.orderId, c]));

    // First item title for page
    const firstItemRows: Array<{ order_id: string; product_title: string }> = (
      await tx.execute<{ order_id: string; product_title: string }>(sql`
        SELECT DISTINCT ON (order_id) order_id, product_title
        FROM order_items
        WHERE tenant_id = ${ctx.tenantId}
          AND order_id IN ${orderIds}
        ORDER BY order_id, id ASC
      `)
    ).rows;
    const firstItemTitles = new Map<string, string>(firstItemRows.map((f) => [f.order_id, f.product_title]));

    const items: PreorderItemRecord[] = rows.map((r) => {
      const c = countsMap.get(r.id);
      return {
        id: r.id,
        number: r.number,
        customerEmail: r.email,
        customerPhone: r.phone,
        customerName: nameFromAddress(r.shippingAddress),
        status: r.status,
        paymentStatus: r.paymentStatus,
        fulfillmentStatus: r.fulfillmentStatus,
        grandTotal: Number(r.grandTotal),
        placedAt: r.placedAt.toISOString(),
        shipsOn: String(r.shipsOn),
        preorderReleasedAt: r.preorderReleasedAt ? r.preorderReleasedAt.toISOString() : null,
        itemsCount: c?.totalCount ?? 0,
        preorderItemsCount: c?.preorderCount ?? 0,
        firstItemTitle: firstItemTitles.get(r.id) ?? null,
      };
    });

    return {
      items,
      total: countResult?.count ?? 0,
      page,
      pageSize,
    };
  });
}

/**
 * Returns aggregate metrics for preorders (ORDERS-PREORDERS-PLAN §3.3).
 */
export async function getPreorderStats(
  rt: Runtime,
  ctx: TenantContext,
): Promise<PreorderStatsRecord> {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const today = new Date().toISOString().slice(0, 10);
    const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const [stats] = await tx
      .select({
        openPreorders: sql<number>`
          coalesce(count(*) filter (
            where ${schema.orders.status} not in ('cancelled', 'fulfilled', 'delivered')
              and ${schema.orders.fulfillmentStatus} != 'fulfilled'
          ), 0)::int
        `,
        readyToShip: sql<number>`
          coalesce(count(*) filter (
            where (${schema.orders.shipsOn} <= ${today} or ${schema.orders.preorderReleasedAt} is not null)
              and ${schema.orders.status} not in ('cancelled', 'fulfilled', 'delivered')
              and ${schema.orders.fulfillmentStatus} != 'fulfilled'
          ), 0)::int
        `,
        dueNext14Days: sql<number>`
          coalesce(count(*) filter (
            where ${schema.orders.shipsOn} > ${today}
              and ${schema.orders.shipsOn} <= ${in14Days}
              and ${schema.orders.preorderReleasedAt} is null
              and ${schema.orders.status} not in ('cancelled', 'fulfilled', 'delivered')
              and ${schema.orders.fulfillmentStatus} != 'fulfilled'
          ), 0)::int
        `,
        overdue: sql<number>`
          coalesce(count(*) filter (
            where ${schema.orders.shipsOn} < ${today}
              and ${schema.orders.status} not in ('cancelled', 'fulfilled', 'delivered')
              and ${schema.orders.fulfillmentStatus} != 'fulfilled'
          ), 0)::int
        `,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.tenantId, ctx.tenantId),
          isNotNull(schema.orders.shipsOn),
        ),
      );

    return {
      openPreorders: stats?.openPreorders ?? 0,
      readyToShip: stats?.readyToShip ?? 0,
      dueNext14Days: stats?.dueNext14Days ?? 0,
      overdue: stats?.overdue ?? 0,
    };
  });
}

/**
 * Changes ship date on one or more preorders in a single business transaction (ORDERS-PREORDERS-PLAN §3.2 rule 5).
 * Updates orders.ships_on and order_items.ships_on, inserts order_events, writes audit logs,
 * and enqueues customer notification jobs.
 */
export async function changePreorderShipDate(
  rt: Runtime,
  ctx: TenantContext,
  input: { orderIds: string[]; shipsOn: string; reason?: string | undefined },
): Promise<{ updatedCount: number; skippedCount: number }> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(input.shipsOn)) {
    throw new Error("Invalid date format. Expected YYYY-MM-DD.");
  }

  const { updatedOrders, skippedCount } = await withTenant(db, ctx.tenantId, async (tx) => {
    // Select eligible unshipped orders
    const candidateOrders = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        email: schema.orders.email,
        shipsOn: schema.orders.shipsOn,
        status: schema.orders.status,
        fulfillmentStatus: schema.orders.fulfillmentStatus,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.tenantId, ctx.tenantId),
          inArray(schema.orders.id, input.orderIds),
          isNotNull(schema.orders.shipsOn),
        ),
      );

    const eligible = candidateOrders.filter(
      (o) =>
        o.status !== "cancelled" &&
        o.status !== "fulfilled" &&
        o.status !== "delivered" &&
        o.fulfillmentStatus !== "fulfilled",
    );

    const staffId = ctx.actor.type === "staff" ? ctx.actor.userId : "system";

    for (const order of eligible) {
      // Update order shipsOn
      await tx
        .update(schema.orders)
        .set({
          shipsOn: input.shipsOn,
        })
        .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, order.id)));

      // Update line items shipsOn for pre-order lines
      await tx
        .update(schema.orderItems)
        .set({
          shipsOn: input.shipsOn,
        })
        .where(
          and(
            eq(schema.orderItems.tenantId, ctx.tenantId),
            eq(schema.orderItems.orderId, order.id),
            isNotNull(schema.orderItems.shipsOn),
          ),
        );

      // Append timeline event
      const eventMessage = `Ship date changed to ${input.shipsOn}${input.reason ? ` (${input.reason})` : ""}`;
      await tx.insert(schema.orderEvents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        type: "order.preorder_date_changed",
        message: eventMessage,
        actorType: ctx.actor.type,
        actorId: staffId,
      });

      // Write audit log
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "order.preorder_date_changed",
        targetType: "order",
        targetId: order.id,
        diff: {
          before: order.shipsOn,
          after: input.shipsOn,
          reason: input.reason ?? null,
        },
      });
    }

    return {
      updatedOrders: eligible,
      skippedCount: input.orderIds.length - eligible.length,
    };
  });

  // Post-commit side effects: enqueue notification jobs via pg-boss (AGENTS.md rule 13)
  for (const order of updatedOrders) {
    if (rt._jobs?.isRunning()) {
      await rt._jobs.send(QUEUE_NAMES.ORDER_PREORDER_DATE_CHANGED, {
        tenantId: ctx.tenantId,
        orderId: order.id,
        orderNumber: order.number,
        email: order.email,
        shipsOn: input.shipsOn,
        reason: input.reason ?? null,
      }).catch(() => null);
    }
  }

  return {
    updatedCount: updatedOrders.length,
    skippedCount,
  };
}

/**
 * Releases a preorder immediately for fulfillment before its scheduled ship date (ORDERS-PREORDERS-PLAN §3.2 rule 4).
 * Audited and recorded on the order timeline.
 */
export async function releasePreorderNow(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [order] = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        shipsOn: schema.orders.shipsOn,
        preorderReleasedAt: schema.orders.preorderReleasedAt,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, input.id)))
      .limit(1);

    if (!order) {
      throw new Error(`Order not found: ${input.id}`);
    }

    if (!order.shipsOn) {
      throw new Error("This order is not a pre-order");
    }

    if (order.preorderReleasedAt) {
      return { success: true };
    }

    const now = new Date();
    await tx
      .update(schema.orders)
      .set({
        preorderReleasedAt: now,
      })
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, input.id)));

    const staffId = ctx.actor.type === "staff" ? ctx.actor.userId : "system";

    await tx.insert(schema.orderEvents).values({
      tenantId: ctx.tenantId,
      orderId: order.id,
      type: "order.preorder_released",
      message: "Pre-order released for early fulfillment",
      actorType: ctx.actor.type,
      actorId: staffId,
    });

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "order.preorder_released",
      targetType: "order",
      targetId: order.id,
      diff: {
        releasedAt: now.toISOString(),
      },
    });

    return { success: true };
  });
}
