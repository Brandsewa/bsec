import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  cartItems,
  carts,
  orderItems,
  orders,
  products,
  variants,
  withTenant,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

export interface AbandonedCheckoutItemRecord {
  id: string;
  cartToken: string;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  itemsSummary: {
    firstTitle: string | null;
    count: number;
    productId: string | null;
    productSlug: string | null;
  };
  total: number; // paise
  currency: string;
  abandonedAt: string;
  recovered: boolean;
  recoveredAt: string | null;
  emailStatus: "not_sent" | "sent" | "failed" | "not_applicable";
  recoverySentAt: string | null;
}

export interface AbandonedCheckoutStatsRecord {
  abandoned: number;
  open: number;
  recovered: number;
  emailsSent: number;
  potentialRevenue: number; // paise
}

export interface ListAdminAbandonedCheckoutsInput {
  view?: "all" | "open" | "recovered" | undefined;
  search?: string | undefined;
  emailStatus?: "all" | "not_sent" | "sent" | "failed" | "not_applicable" | undefined;
  sort?: "abandoned_desc" | "abandoned_asc" | "total_desc" | "total_asc" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Returns KPI statistics for abandoned checkouts (ORDERS-ABANDONED-CHECKOUTS-PLAN §1.1).
 * Own query, own Suspense boundary.
 */
export async function getAdminAbandonedCheckoutStats(
  rt: Runtime,
  ctx: TenantContext,
): Promise<AbandonedCheckoutStatsRecord> {
  assertPermission(ctx, "orders.read");

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    // A cart is recovered when recovered_at IS NOT NULL OR an order exists with orders.cart_id = carts.id and orders.placed_at > carts.last_activity_at
    const isRecoveredSql = sql<boolean>`(${carts.recoveredAt} IS NOT NULL OR EXISTS (
      SELECT 1 FROM ${orders} o
      WHERE o.tenant_id = ${carts.tenantId}
        AND o.cart_id = ${carts.id}
        AND o.placed_at > ${carts.lastActivityAt}
    ))`;

    const isOpenSql = sql<boolean>`(${carts.status} = 'abandoned' AND NOT (${isRecoveredSql}))`;
    const isAbandonedScopeSql = sql<boolean>`(${carts.status} = 'abandoned' OR (${isRecoveredSql}))`;

    const cartTotalSql = sql<number>`COALESCE(
      (SELECT SUM(ci.unit_price_snapshot * ci.quantity)::bigint FROM ${cartItems} ci WHERE ci.cart_id = "carts"."id"),
      (SELECT o.grand_total FROM ${orders} o WHERE o.cart_id = "carts"."id" LIMIT 1),
      0
    )`;

    // Carts that reached checkout: has email, phone, or shippingAddress
    const reachedCheckoutSql = sql<boolean>`(${carts.email} IS NOT NULL OR ${carts.phone} IS NOT NULL OR ${carts.shippingAddress} IS NOT NULL)`;

    const [stats] = await tx
      .select({
        abandoned: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${isAbandonedScopeSql}), 0)::int`,
        open: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${isOpenSql}), 0)::int`,
        recovered: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${isRecoveredSql}), 0)::int`,
        emailsSent: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${isAbandonedScopeSql} AND ${carts.recoverySentAt} IS NOT NULL), 0)::int`,
        potentialRevenue: sql<number>`COALESCE(SUM(${cartTotalSql}) FILTER (WHERE ${isOpenSql}), 0)::bigint`,
      })
      .from(carts)
      .where(
        and(
          eq(carts.tenantId, ctx.tenantId),
          reachedCheckoutSql,
          isAbandonedScopeSql,
        ),
      );

    return {
      abandoned: Number(stats?.abandoned ?? 0),
      open: Number(stats?.open ?? 0),
      recovered: Number(stats?.recovered ?? 0),
      emailsSent: Number(stats?.emailsSent ?? 0),
      potentialRevenue: Number(stats?.potentialRevenue ?? 0),
    };
  });
}

/**
 * Lists abandoned checkouts with SQL paging, filtering, searching and sorting.
 * Guaranteed constant number of queries per page load (constant query count invariant).
 */
export async function listAdminAbandonedCheckouts(
  rt: Runtime,
  ctx: TenantContext,
  input: ListAdminAbandonedCheckoutsInput = {},
): Promise<{ items: AbandonedCheckoutItemRecord[]; total: number }> {
  assertPermission(ctx, "orders.read");

  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const view = input.view ?? "all";
  const emailStatus = input.emailStatus ?? "all";
  const sort = input.sort ?? "abandoned_desc";
  const search = input.search?.trim();

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const isRecoveredSql = sql<boolean>`(${carts.recoveredAt} IS NOT NULL OR EXISTS (
      SELECT 1 FROM ${orders} o
      WHERE o.tenant_id = ${carts.tenantId}
        AND o.cart_id = ${carts.id}
        AND o.placed_at > ${carts.lastActivityAt}
    ))`;

    const isOpenSql = sql<boolean>`(${carts.status} = 'abandoned' AND NOT (${isRecoveredSql}))`;
    const isAbandonedScopeSql = sql<boolean>`(${carts.status} = 'abandoned' OR (${isRecoveredSql}))`;

    const conditions = [
      eq(carts.tenantId, ctx.tenantId),
      // Checkout reached rule (D1)
      sql<boolean>`(${carts.email} IS NOT NULL OR ${carts.phone} IS NOT NULL OR ${carts.shippingAddress} IS NOT NULL)`,
    ];

    // Tab / View filtering
    if (view === "open") {
      conditions.push(isOpenSql);
    } else if (view === "recovered") {
      conditions.push(isRecoveredSql);
    } else {
      conditions.push(isAbandonedScopeSql);
    }

    // Email status filtering
    if (emailStatus === "sent") {
      conditions.push(isNotNull(carts.recoverySentAt));
    } else if (emailStatus === "not_sent") {
      const cond = and(isNull(carts.recoverySentAt), isNotNull(carts.email));
      if (cond) conditions.push(cond);
    } else if (emailStatus === "not_applicable") {
      conditions.push(isNull(carts.email));
    } else if (emailStatus === "failed") {
      // In Phase 1 without retry ladder, no carts are in failed state
      conditions.push(sql`FALSE`);
    }

    // Search filter: customer name, email, phone, or product title
    if (search) {
      const term = `%${search}%`;
      const searchOr = or(
        ilike(carts.email, term),
        ilike(carts.phone, term),
        sql<boolean>`${carts.shippingAddress}->>'fullName' ILIKE ${term}`,
        sql<boolean>`EXISTS (
          SELECT 1 FROM ${cartItems} ci
          INNER JOIN ${variants} v ON v.id = ci.variant_id
          INNER JOIN ${products} p ON p.id = v.product_id
          WHERE ci.cart_id = ${carts.id} AND p.title ILIKE ${term}
        )`,
        sql<boolean>`EXISTS (
          SELECT 1 FROM ${orders} o
          INNER JOIN ${orderItems} oi ON oi.order_id = o.id
          WHERE o.cart_id = ${carts.id} AND oi.product_title ILIKE ${term}
        )`,
      );
      if (searchOr) conditions.push(searchOr);
    }

    const whereClause = and(...conditions);

    // 1. Total count query
    const [countRow] = await tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(carts)
      .where(whereClause);

    const total = Number(countRow?.total ?? 0);
    if (total === 0) {
      return { items: [], total: 0 };
    }

    // Cart total SQL expression for sorting and display
    const cartTotalSql = sql<number>`COALESCE(
      (SELECT SUM(ci.unit_price_snapshot * ci.quantity)::bigint FROM ${cartItems} ci WHERE ci.cart_id = "carts"."id"),
      (SELECT o.grand_total FROM ${orders} o WHERE o.cart_id = "carts"."id" LIMIT 1),
      0
    )`;

    // Sort order
    let orderByClause;
    if (sort === "abandoned_asc") {
      orderByClause = [asc(carts.lastActivityAt)];
    } else if (sort === "total_desc") {
      orderByClause = [desc(cartTotalSql), desc(carts.lastActivityAt)];
    } else if (sort === "total_asc") {
      orderByClause = [asc(cartTotalSql), desc(carts.lastActivityAt)];
    } else {
      orderByClause = [desc(carts.lastActivityAt)];
    }

    // 2. Fetch page rows
    const pageRows = await tx
      .select({
        id: carts.id,
        token: carts.token,
        email: carts.email,
        phone: carts.phone,
        currency: carts.currency,
        shippingAddress: carts.shippingAddress,
        lastActivityAt: carts.lastActivityAt,
        recoveredAt: carts.recoveredAt,
        recoverySentAt: carts.recoverySentAt,
        isRecovered: isRecoveredSql,
        computedTotal: cartTotalSql,
      })
      .from(carts)
      .where(whereClause)
      .orderBy(...orderByClause)
      .limit(limit)
      .offset(offset);

    const cartIds = pageRows.map((r) => r.id);

    // 3. One grouped query for item previews from cart_items
    const cartItemPreviews = await tx
      .select({
        cartId: cartItems.cartId,
        quantity: cartItems.quantity,
        unitPrice: cartItems.unitPriceSnapshot,
        createdAt: cartItems.createdAt,
        productTitle: products.title,
        productId: products.id,
        productSlug: products.slug,
      })
      .from(cartItems)
      .innerJoin(variants, eq(variants.id, cartItems.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .where(inArray(cartItems.cartId, cartIds))
      .orderBy(asc(cartItems.createdAt));

    // Also check order_items for any carts that converted into orders
    const orderItemPreviews = await tx
      .select({
        cartId: orders.cartId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        createdAt: orderItems.createdAt,
        productTitle: orderItems.productTitle,
        variantId: orderItems.variantId,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(inArray(orders.cartId, cartIds))
      .orderBy(asc(orderItems.createdAt));

    // Map previews by cartId
    const previewsByCart = new Map<
      string,
      {
        firstTitle: string | null;
        count: number;
        productId: string | null;
        productSlug: string | null;
        totalPaise: number;
      }
    >();

    for (const item of cartItemPreviews) {
      const existing = previewsByCart.get(item.cartId) ?? {
        firstTitle: item.productTitle,
        count: 0,
        productId: item.productId,
        productSlug: item.productSlug,
        totalPaise: 0,
      };
      existing.count += item.quantity;
      existing.totalPaise += item.unitPrice * item.quantity;
      if (!existing.firstTitle) {
        existing.firstTitle = item.productTitle;
        existing.productId = item.productId;
        existing.productSlug = item.productSlug;
      }
      previewsByCart.set(item.cartId, existing);
    }

    // Merge order items for recovered carts if cart_items was cleared
    for (const item of orderItemPreviews) {
      if (!item.cartId) continue;
      const existing = previewsByCart.get(item.cartId);
      if (!existing || existing.count === 0) {
        const entry = existing ?? {
          firstTitle: item.productTitle,
          count: 0,
          productId: null,
          productSlug: null,
          totalPaise: 0,
        };
        entry.count += item.quantity;
        entry.totalPaise += item.unitPrice * item.quantity;
        if (!entry.firstTitle) {
          entry.firstTitle = item.productTitle;
        }
        previewsByCart.set(item.cartId, entry);
      }
    }

    // Build the final items array
    const items: AbandonedCheckoutItemRecord[] = pageRows.map((row) => {
      const preview = previewsByCart.get(row.id);
      const shippingAddr = row.shippingAddress as { fullName?: string | null } | null;
      const customerName = shippingAddr?.fullName?.trim() || null;

      let emailStatus: "not_sent" | "sent" | "failed" | "not_applicable" = "not_sent";
      if (!row.email) {
        emailStatus = "not_applicable";
      } else if (row.recoverySentAt) {
        emailStatus = "sent";
      }

      const computed = Number(row.computedTotal);
      const totalPaise = computed > 0 ? computed : (preview?.totalPaise ?? 0);

      return {
        id: row.id,
        cartToken: row.token,
        customer: {
          name: customerName,
          email: row.email ?? null,
          phone: row.phone ?? null,
        },
        itemsSummary: {
          firstTitle: preview?.firstTitle ?? null,
          count: preview?.count ?? 0,
          productId: preview?.productId ?? null,
          productSlug: preview?.productSlug ?? null,
        },
        total: totalPaise,
        currency: row.currency || "INR",
        abandonedAt: row.lastActivityAt.toISOString(),
        recovered: Boolean(row.isRecovered),
        recoveredAt: row.recoveredAt ? row.recoveredAt.toISOString() : null,
        emailStatus,
        recoverySentAt: row.recoverySentAt ? row.recoverySentAt.toISOString() : null,
      };
    });

    return { items, total };
  });
}
