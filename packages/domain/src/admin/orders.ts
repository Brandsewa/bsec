import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { schema, withTenant, QUEUE_NAMES } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { allocateOrderNumber } from "./order-settings.ts";
import { readStoreConfig } from "./store-config.ts";
import { getTenantShippingRates } from "../orders/shipping-rates.ts";
import { allocateDiscount } from "../orders/pricing.ts";
import { calculateGstLineItem, normalizeState } from "../orders/invoices.ts";
import { reserveInventory, commitReservation, InsufficientInventoryError } from "../catalog/inventory-reservations.ts";
import { transitionOrder } from "../orders/state-machine.ts";
import { transitionFulfillment } from "../orders/fulfillment-state-machine.ts";
import { generateInvoice } from "../orders/invoices.ts";
import { isFeatureEnabled, FeatureDisabledError } from "../features.ts";

export interface ListOrdersInput {
  view?: "all" | "unfulfilled" | "unpaid" | "cod_to_confirm" | "rto" | "open" | "archived" | undefined;
  search?: string | undefined;
  status?: string | undefined;
  paymentStatus?: string | undefined;
  fulfillmentStatus?: string | undefined;
  source?: string | undefined;
  tag?: string | undefined;
  cod?: boolean | undefined;
  placedFrom?: string | undefined;
  placedTo?: string | undefined;
  sort?: "placed_desc" | "placed_asc" | "total_desc" | "total_asc" | "number_desc" | "number_asc" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface OrderListItem {
  id: string;
  number: string;
  customerEmail: string;
  customerPhone: string;
  customerName?: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  grandTotal: number;
  placedAt: string;
  shipsOn?: string | null | undefined;
  itemsCount: number;
  firstItemTitle?: string | null | undefined;
}

export interface OrderStatsRecord {
  totalOrders: number;
  openOrders: number;
  paidOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
}

/** The name entered at checkout, if any (checkout stores it as fullName; older rows may use name). */
function nameFromAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const raw = typeof a["fullName"] === "string" ? a["fullName"] : typeof a["name"] === "string" ? a["name"] : "";
  return raw.trim() || null;
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
      // a cancelled or returned order has nothing left to fulfil
      conditions.push(sql`${schema.orders.status} not in ('cancelled', 'returned')`);
    } else if (input.view === "unpaid") {
      // Online payments awaiting capture, and COD orders whose cash has not been collected yet.
      conditions.push(inArray(schema.orders.paymentStatus, ["pending", "cod_pending"]));
    } else if (input.view === "cod_to_confirm") {
      // COD orders the customer has not confirmed yet (confirmed via the emailed/SMS link).
      conditions.push(eq(schema.orders.status, "pending"));
      conditions.push(eq(schema.orders.paymentStatus, "cod_pending"));
    } else if (input.view === "rto") {
      conditions.push(eq(schema.orders.fulfillmentStatus, "rto"));
    } else if (input.view === "open") {
      conditions.push(notInArray(schema.orders.status, ["delivered", "cancelled", "returned"]));
    } else if (input.view === "archived") {
      conditions.push(inArray(schema.orders.status, ["delivered", "cancelled", "returned"]));
    }

    if (input.source) conditions.push(eq(schema.orders.source, input.source));
    if (input.tag) conditions.push(sql`${input.tag} = ANY(${schema.orders.tags})`);
    if (input.status) conditions.push(eq(schema.orders.status, input.status));
    if (input.paymentStatus) conditions.push(eq(schema.orders.paymentStatus, input.paymentStatus));
    if (input.fulfillmentStatus) conditions.push(eq(schema.orders.fulfillmentStatus, input.fulfillmentStatus));
    if (input.cod) conditions.push(inArray(schema.orders.paymentStatus, ["cod_pending", "cod_collected", "cod_failed"]));
    const from = input.placedFrom ? new Date(input.placedFrom) : null;
    const to = input.placedTo ? new Date(input.placedTo) : null;
    if (from && !Number.isNaN(from.getTime())) conditions.push(gte(schema.orders.placedAt, from));
    if (to && !Number.isNaN(to.getTime())) conditions.push(lt(schema.orders.placedAt, to));
    if (input.search) {
      conditions.push(
        sql`(${schema.orders.number} ILIKE ${`%${input.search}%`} OR ${schema.orders.email} ILIKE ${`%${input.search}%`} OR ${schema.orders.phone} ILIKE ${`%${input.search}%`} OR ${schema.orders.shippingAddress}->>'fullName' ILIKE ${`%${input.search}%`})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Always tie-break on id so paging is stable when many orders share a timestamp/total.
    const orderBy = {
      placed_desc: [desc(schema.orders.placedAt), desc(schema.orders.id)],
      placed_asc: [asc(schema.orders.placedAt), asc(schema.orders.id)],
      total_desc: [desc(schema.orders.grandTotal), desc(schema.orders.id)],
      total_asc: [asc(schema.orders.grandTotal), asc(schema.orders.id)],
      number_desc: [desc(schema.orders.number), desc(schema.orders.id)],
      number_asc: [asc(schema.orders.number), asc(schema.orders.id)],
    }[input.sort ?? "placed_desc"];

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
      })
      .from(schema.orders)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    // Item counts for the whole page in one query (not one per row).
    const countRows =
      rows.length === 0
        ? []
        : await tx
            .select({
              orderId: schema.orderItems.orderId,
              count: sql<number>`coalesce(sum(${schema.orderItems.quantity}), 0)::int`,
            })
            .from(schema.orderItems)
            .where(inArray(schema.orderItems.orderId, rows.map((r) => r.id)))
            .groupBy(schema.orderItems.orderId);
    const itemCounts = new Map(countRows.map((c) => [c.orderId, c.count]));

    // First item title for the whole page in one query (not one per row).
    const firstItemRows: Array<{ order_id: string; product_title: string }> =
      rows.length === 0
        ? []
        : (
            await tx.execute<{ order_id: string; product_title: string }>(sql`
              SELECT DISTINCT ON (order_id) order_id, product_title
              FROM order_items
              WHERE tenant_id = ${ctx.tenantId}
                AND order_id IN ${rows.map((r) => r.id)}
              ORDER BY order_id, id ASC
            `)
          ).rows;
    const firstItemTitles = new Map<string, string>(firstItemRows.map((f) => [f.order_id, f.product_title]));

    const items: OrderListItem[] = [];
    for (const r of rows) {
      items.push({
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
        shipsOn: r.shipsOn ? String(r.shipsOn) : null,
        itemsCount: itemCounts.get(r.id) ?? 0,
        firstItemTitle: firstItemTitles.get(r.id) ?? null,
      });
    }

    return {
      items,
      total: countResult?.count ?? 0,
    };
  });
}

/**
 * Returns revenue and status statistics for all placed orders for the tenant (ORDERS-ALL-ORDERS-PLAN §4.1).
 * Computed in a single aggregate query; strictly tenant-scoped (RLS).
 */
export async function getAdminOrderStats(
  rt: Runtime,
  ctx: TenantContext,
): Promise<OrderStatsRecord> {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const result = await tx.execute<{
      total_orders: string | number;
      open_orders: string | number;
      paid_orders: string | number;
      total_revenue: string | number;
    }>(sql`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled', 'returned'))::int AS open_orders,
        COUNT(*) FILTER (WHERE payment_status IN ('paid', 'cod_collected'))::int AS paid_orders,
        COALESCE(SUM(grand_total) FILTER (WHERE payment_status IN ('paid', 'cod_collected')), 0)::bigint AS total_revenue
      FROM orders
      WHERE tenant_id = ${ctx.tenantId}
    `);

    const row = result.rows[0];
    const totalOrders = Number(row?.total_orders ?? 0);
    const openOrders = Number(row?.open_orders ?? 0);
    const paidOrders = Number(row?.paid_orders ?? 0);
    const totalRevenue = Number(row?.total_revenue ?? 0);
    const avgOrderValue = paidOrders > 0 ? Math.round(totalRevenue / paidOrders) : 0;

    return {
      totalOrders,
      openOrders,
      paidOrders,
      totalRevenue,
      avgOrderValue,
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
        shipsOn: order.shipsOn ? String(order.shipsOn) : null,
        preorderReleasedAt: order.preorderReleasedAt ? order.preorderReleasedAt.toISOString() : null,
        cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
        cancelReason: order.cancelReason,
        tags: order.tags ?? [],
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
        shipsOn: it.shipsOn ? String(it.shipsOn) : null,
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

export interface EstimateDraftOrderInput {
  items: Array<{
    variantId: string;
    quantity: number;
    unitPriceOverride?: number | undefined;
  }>;
  shippingAddress?: {
    state?: string | undefined;
    pincode?: string | undefined;
    city?: string | undefined;
  } | undefined;
  manualDiscount?: {
    type: "flat" | "percent";
    value: number;
  } | undefined;
  shippingOverride?: {
    amount: number;
  } | undefined;
  shippingMethod?: string | undefined;
}

export async function estimateAdminDraftOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: EstimateDraftOrderInput,
) {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    let subtotal = 0;
    const itemCalculations = [];

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

      const price = it.unitPriceOverride != null ? it.unitPriceOverride : Number(variant.price);
      const lineTotal = price * it.quantity;
      subtotal += lineTotal;

      itemCalculations.push({
        variantId: variant.id,
        productTitle: product?.title ?? "Product",
        sku: variant.sku,
        hsn: product?.hsn ?? null,
        quantity: it.quantity,
        unitPrice: price,
        lineTotal,
      });
    }

    let discountTotal = 0;
    if (input.manualDiscount) {
      if (input.manualDiscount.type === "percent") {
        const pct = Math.min(100, Math.max(0, input.manualDiscount.value));
        discountTotal = Math.round((subtotal * pct) / 100);
      } else {
        discountTotal = Math.min(subtotal, Math.max(0, Math.round(input.manualDiscount.value)));
      }
    }

    const netGoods = Math.max(0, subtotal - discountTotal);
    const resolvedRates = await getTenantShippingRates(tx, ctx.tenantId, netGoods);
    const availableShippingRates = resolvedRates
      .filter((r) => r.applicable)
      .map((r) => ({
        method: r.method,
        title: r.title,
        amount: r.amount,
        estimatedDays: r.estimatedDays,
      }));

    const shippingTotal = input.shippingOverride
      ? Math.min(1_000_000, Math.max(0, Math.round(input.shippingOverride.amount)))
      : input.shippingMethod
        ? (availableShippingRates.find((r) => r.method === input.shippingMethod)?.amount ??
            (availableShippingRates[0]?.amount ?? 0))
        : (availableShippingRates[0]?.amount ?? 0);

    const storeCfg = await readStoreConfig(tx);
    const [settingsRow] = await tx
      .select({ address: schema.storeSettings.address })
      .from(schema.storeSettings)
      .limit(1);
    const originState =
      storeCfg.tax.sellerState ??
      (settingsRow?.address as { state?: string } | null | undefined)?.state ??
      "Delhi";
    const destinationState = input.shippingAddress?.state ?? "Delhi";
    const pricesIncludeTax = storeCfg.tax.pricesIncludeTax;
    const isInterState = normalizeState(originState) !== normalizeState(destinationState);

    const lineTotals = itemCalculations.map((it) => it.lineTotal);
    const allocatedDiscounts = allocateDiscount(lineTotals, discountTotal);

    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    itemCalculations.forEach((it, idx) => {
      const calc = calculateGstLineItem({
        orderItemId: it.variantId,
        variantId: it.variantId,
        sku: it.sku,
        productTitle: it.productTitle,
        hsn: it.hsn,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountAmount: allocatedDiscounts[idx] ?? 0,
        taxRateBps: 1800,
        pricesIncludeTax,
        isInterState,
      });
      totalCgst += calc.cgst;
      totalSgst += calc.sgst;
      totalIgst += calc.igst;
    });

    const shippingTaxRate = 1800;
    let shippingCgst = 0;
    let shippingSgst = 0;
    let shippingIgst = 0;

    if (shippingTotal > 0) {
      const shippingTax = pricesIncludeTax
        ? shippingTotal - Math.round((shippingTotal * 10000) / (10000 + shippingTaxRate))
        : Math.round((shippingTotal * shippingTaxRate) / 10000);
      if (isInterState) {
        shippingIgst = shippingTax;
      } else {
        shippingCgst = Math.floor(shippingTax / 2);
        shippingSgst = shippingTax - shippingCgst;
      }
    }

    const grandCgst = totalCgst + shippingCgst;
    const grandSgst = totalSgst + shippingSgst;
    const grandIgst = totalIgst + shippingIgst;
    const grandTax = grandCgst + grandSgst + grandIgst;

    const grandTotal = pricesIncludeTax
      ? subtotal - discountTotal + shippingTotal
      : subtotal - discountTotal + shippingTotal + grandTax;

    return {
      subtotal,
      discountTotal,
      shippingTotal,
      availableShippingRates,
      tax: {
        isInterState,
        cgst: grandCgst,
        sgst: grandSgst,
        igst: grandIgst,
        totalTax: grandTax,
      },
      grandTotal,
    };
  });
}

export interface CreateAdminDraftOrderInput {
  customerId?: string | null | undefined;
  email: string;
  phone?: string | undefined;
  shippingAddress: Record<string, unknown>;
  billingAddress?: Record<string, unknown> | undefined;
  items: Array<{
    variantId: string;
    quantity: number;
    unitPriceOverride?: number | undefined;
    unitPriceOverrideReason?: string | undefined;
  }>;
  manualDiscount?: {
    type: "flat" | "percent";
    value: number;
    reason: string;
  } | undefined;
  shippingOverride?: {
    amount: number;
    reason: string;
  } | undefined;
  shippingMethod?: string | undefined;
  paymentOutcome?: "paid" | "pending" | "cod" | undefined;
  paymentReference?: string | undefined;
  notes?: string | undefined;
  tags?: string[] | undefined;
  quoteId?: string | undefined;
}

export async function createAdminDraftOrder(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateAdminDraftOrderInput,
) {
  assertPermission(ctx, "orders.write");

  if (input.items.length === 0) {
    throw new Error("Order must contain at least one item");
  }
  if (input.shippingOverride) {
    if (input.shippingOverride.amount > 1_000_000) {
      throw new Error("Shipping override cannot exceed ₹10,000");
    }
    if (!input.shippingOverride.reason?.trim()) {
      throw new Error("Shipping override requires a reason");
    }
  }
  if (input.manualDiscount) {
    if (!input.manualDiscount.reason?.trim()) {
      throw new Error("Manual discount requires a reason");
    }
  }
  for (const it of input.items) {
    if (it.unitPriceOverride !== undefined && !it.unitPriceOverrideReason?.trim()) {
      throw new Error("Unit price override requires a reason");
    }
  }

  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const storeCfg = await readStoreConfig(tx);
    const paymentOutcome = input.paymentOutcome ?? "pending";
    if (paymentOutcome === "cod" && !storeCfg.cod.enabled) {
      throw new Error("Cash on delivery is not available for this store");
    }

    let subtotal = 0;
    const itemCalculations = [];

    for (const it of input.items) {
      const [variant] = await tx
        .select({
          id: schema.variants.id,
          title: schema.variants.title,
          sku: schema.variants.sku,
          price: schema.variants.price,
          trackInventory: schema.variants.trackInventory,
          allowBackorder: schema.variants.allowBackorder,
          preorderEnabled: schema.variants.preorderEnabled,
          preorderShipsOn: schema.variants.preorderShipsOn,
          costPrice: schema.variants.costPrice,
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

      const unitPrice = it.unitPriceOverride != null ? it.unitPriceOverride : Number(variant.price);
      const lineTotal = unitPrice * it.quantity;
      subtotal += lineTotal;

      itemCalculations.push({
        variant,
        productTitle: product?.title ?? "Product",
        hsn: product?.hsn ?? null,
        quantity: it.quantity,
        unitPrice,
        unitPriceOverride: it.unitPriceOverride,
        unitPriceOverrideReason: it.unitPriceOverrideReason,
        lineTotal,
      });
    }

    let discountTotal = 0;
    if (input.manualDiscount) {
      if (input.manualDiscount.type === "percent") {
        const pct = Math.min(100, Math.max(0, input.manualDiscount.value));
        discountTotal = Math.round((subtotal * pct) / 100);
      } else {
        discountTotal = Math.min(subtotal, Math.max(0, Math.round(input.manualDiscount.value)));
      }
    }

    const netGoods = Math.max(0, subtotal - discountTotal);
    const resolvedRates = await getTenantShippingRates(tx, ctx.tenantId, netGoods);
    const availableShippingRates = resolvedRates
      .filter((r) => r.applicable)
      .map((r) => ({
        method: r.method,
        title: r.title,
        amount: r.amount,
        estimatedDays: r.estimatedDays,
      }));

    const shippingTotal = input.shippingOverride
      ? Math.min(1_000_000, Math.max(0, Math.round(input.shippingOverride.amount)))
      : input.shippingMethod
        ? (availableShippingRates.find((r) => r.method === input.shippingMethod)?.amount ??
            (availableShippingRates[0]?.amount ?? 0))
        : (availableShippingRates[0]?.amount ?? 0);

    const [settingsRow] = await tx
      .select({ address: schema.storeSettings.address })
      .from(schema.storeSettings)
      .limit(1);
    const originState =
      storeCfg.tax.sellerState ??
      (settingsRow?.address as { state?: string } | null | undefined)?.state ??
      "Delhi";
    const shippingAddrState = (input.shippingAddress as Record<string, unknown>)?.state;
    const destinationState = typeof shippingAddrState === "string" && shippingAddrState.trim() ? shippingAddrState.trim() : "Delhi";
    const pricesIncludeTax = storeCfg.tax.pricesIncludeTax;
    const isInterState = normalizeState(originState) !== normalizeState(destinationState);

    const lineTotals = itemCalculations.map((it) => it.lineTotal);
    const allocatedDiscounts = allocateDiscount(lineTotals, discountTotal);

    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    const lineTaxCalcs = itemCalculations.map((it, idx) => {
      const calc = calculateGstLineItem({
        orderItemId: it.variant.id,
        variantId: it.variant.id,
        sku: it.variant.sku,
        productTitle: it.productTitle,
        hsn: it.hsn,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountAmount: allocatedDiscounts[idx] ?? 0,
        taxRateBps: 1800,
        pricesIncludeTax,
        isInterState,
      });
      totalCgst += calc.cgst;
      totalSgst += calc.sgst;
      totalIgst += calc.igst;
      return calc;
    });

    const shippingTaxRate = 1800;
    let shippingCgst = 0;
    let shippingSgst = 0;
    let shippingIgst = 0;

    if (shippingTotal > 0) {
      const shippingTax = pricesIncludeTax
        ? shippingTotal - Math.round((shippingTotal * 10000) / (10000 + shippingTaxRate))
        : Math.round((shippingTotal * shippingTaxRate) / 10000);
      if (isInterState) {
        shippingIgst = shippingTax;
      } else {
        shippingCgst = Math.floor(shippingTax / 2);
        shippingSgst = shippingTax - shippingCgst;
      }
    }

    const grandCgst = totalCgst + shippingCgst;
    const grandSgst = totalSgst + shippingSgst;
    const grandIgst = totalIgst + shippingIgst;
    const grandTax = grandCgst + grandSgst + grandIgst;

    const codFee = paymentOutcome === "cod" ? storeCfg.cod.feePaise : 0;
    const baseTotal = pricesIncludeTax
      ? subtotal - discountTotal + shippingTotal
      : subtotal - discountTotal + shippingTotal + grandTax;
    const grandTotal = baseTotal + codFee;

    // Inventory Location & Stock Reservation (PLAN §11.3, D7)
    const [loc] = await tx
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, ctx.tenantId))
      .orderBy(sql`${schema.locations.isDefault} DESC, ${schema.locations.createdAt} ASC`)
      .limit(1);
    const locationId = loc?.id ?? "00000000-0000-0000-0000-000000000001";

    const reserveItems = [];
    for (const it of itemCalculations) {
      const v = it.variant;
      if (!v.preorderEnabled && !v.allowBackorder && v.trackInventory) {
        reserveItems.push({
          variantId: v.id,
          locationId,
          qty: it.quantity,
        });
      }
    }

    const orderId = randomUUID();
    if (reserveItems.length > 0) {
      try {
        await reserveInventory(tx, ctx.tenantId, reserveItems, { orderId });
      } catch (err) {
        if (err instanceof InsufficientInventoryError) {
          throw new Error("Some selected items do not have enough stock", { cause: err });
        }
        throw err;
      }
    }

    // Allocate sequential order number
    const seq = await allocateOrderNumber(tx, ctx.tenantId);
    const orderNumber = seq.formatted;

    // Preorder latest ships_on date
    let orderShipsOn: string | null = null;
    for (const it of itemCalculations) {
      if (it.variant.preorderEnabled && it.variant.preorderShipsOn) {
        const d =
          typeof it.variant.preorderShipsOn === "string"
            ? it.variant.preorderShipsOn
            : (it.variant.preorderShipsOn as Date).toISOString().slice(0, 10);
        if (!orderShipsOn || d > orderShipsOn) orderShipsOn = d;
      }
    }

    let status = "pending";
    let paymentStatus = "pending";
    if (paymentOutcome === "paid") {
      status = "confirmed";
      paymentStatus = "paid";
    } else if (paymentOutcome === "cod") {
      status = "pending";
      paymentStatus = "cod_pending";
    }

    const [order] = await tx
      .insert(schema.orders)
      .values({
        id: orderId,
        tenantId: ctx.tenantId,
        number: orderNumber,
        customerId: input.customerId ?? null,
        email: input.email,
        phone: input.phone || "",
        currency: "INR",
        status,
        paymentStatus,
        fulfillmentStatus: "unfulfilled",
        source: "admin",
        subtotal,
        discountTotal,
        shippingTotal,
        taxTotal: grandTax,
        codFee,
        grandTotal,
        shipsOn: orderShipsOn,
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress ?? input.shippingAddress,
        placeOfSupplyState: destinationState,
        tags: input.tags ?? [],
      })
      .returning();

    if (!order) {
      throw new Error("Failed to create draft order");
    }

    for (let idx = 0; idx < itemCalculations.length; idx++) {
      const it = itemCalculations[idx];
      const calc = lineTaxCalcs[idx];
      if (!it || !calc) continue;
      await tx.insert(schema.orderItems).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        variantId: it.variant.id,
        productTitle: it.productTitle,
        variantTitle: it.variant.title,
        sku: it.variant.sku,
        hsn: it.hsn,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountAmount: calc.discountAmount,
        taxRateBps: 1800,
        cgst: calc.cgst,
        sgst: calc.sgst,
        igst: calc.igst,
        total: it.lineTotal,
        shipsOn:
          it.variant.preorderEnabled && it.variant.preorderShipsOn
            ? typeof it.variant.preorderShipsOn === "string"
              ? it.variant.preorderShipsOn
              : (it.variant.preorderShipsOn as Date).toISOString().slice(0, 10)
            : null,
        costPrice: it.variant.costPrice != null ? Number(it.variant.costPrice) : null,
      });
    }

    if (paymentOutcome === "paid") {
      await tx.insert(schema.paymentIntents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        provider: "manual",
        amount: grandTotal,
        currency: "INR",
        status: "captured",
        providerOrderId: input.paymentReference ?? null,
      });
      await commitReservation(tx, ctx.tenantId, { orderId: order.id });
      if (rt._jobs) {
        await rt._jobs.send(QUEUE_NAMES.FINANCE_POST, {
          tenantId: ctx.tenantId,
          kind: "order",
          id: order.id,
        });
      }
      if (input.customerId && rt._jobs) {
        await rt._jobs.send(QUEUE_NAMES.CUSTOMERS_REFRESH_METRICS, {
          tenantId: ctx.tenantId,
          customerId: input.customerId,
        });
      }
    } else if (paymentOutcome === "cod") {
      await tx.insert(schema.paymentIntents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        provider: "cod",
        amount: grandTotal,
        currency: "INR",
        status: "cod_pending",
      });
    } else {
      await tx.insert(schema.paymentIntents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        provider: "manual",
        amount: grandTotal,
        currency: "INR",
        status: "created",
      });
    }

    if (input.notes) {
      const authorId =
        ctx.actor.type === "staff" ? ctx.actor.userId : "00000000-0000-0000-0000-000000000000";
      await tx.insert(schema.orderNotes).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        authorId,
        body: input.notes,
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

    if (paymentOutcome === "paid") {
      await tx.insert(schema.orderEvents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        type: "order.payment_received",
        message: `Payment marked as received by admin staff${input.paymentReference ? ` (Ref: ${input.paymentReference})` : ""}`,
        actorType: "staff",
        actorId: staffId,
      });
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "order.draft_created",
      targetType: "order",
      targetId: order.id,
      diff: {
        orderNumber,
        grandTotal,
        paymentOutcome,
        itemsCount: itemCalculations.length,
      },
    });

    if (input.manualDiscount) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "order.discount_applied",
        targetType: "order",
        targetId: order.id,
        diff: {
          discountTotal,
          type: input.manualDiscount.type,
          value: input.manualDiscount.value,
          reason: input.manualDiscount.reason,
        },
      });
    }

    if (input.shippingOverride) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "order.shipping_override",
        targetType: "order",
        targetId: order.id,
        diff: {
          shippingTotal,
          reason: input.shippingOverride.reason,
        },
      });
    }

    for (const it of itemCalculations) {
      if (it.unitPriceOverride != null) {
        await tx.insert(schema.auditLogs).values({
          tenantId: ctx.tenantId,
          actorType: ctx.actor.type,
          actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
          action: "order.item_price_override",
          targetType: "order",
          targetId: order.id,
          diff: {
            variantId: it.variant.id,
            originalPrice: Number(it.variant.price),
            overridePrice: Number(it.unitPrice),
            reason: it.unitPriceOverrideReason,
          },
        });
      }
    }

    if (input.quoteId) {
      await tx
        .update(schema.quoteRequests)
        .set({
          orderId: order.id,
          status: "quoted",
          quotedTotal: grandTotal,
          quotedAt: new Date(),
          validUntil: sql`now() + make_interval(days => 7)`,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.quoteRequests.tenantId, ctx.tenantId), eq(schema.quoteRequests.id, input.quoteId)));

      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "quote.order_linked",
        targetType: "quote",
        targetId: input.quoteId,
        diff: {
          orderId: order.id,
          orderNumber,
          grandTotal,
        },
      });
    }

    return {
      orderId: order.id,
      orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotal,
      discountTotal,
      shippingTotal,
      taxTotal: grandTax,
      grandTotal,
      payLink: `https://${ctx.tenantId}.bcom.si/checkout/pay/${order.id}`,
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
  await transitionOrder(
    rt,
    ctx,
    input.id,
    {
      type: "order.cancel",
      reason: input.reason,
    },
  );

  return { success: true };
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
      { ...rt, _db: { db: tx } } as unknown as Runtime,
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

    if (rt._jobs) {
      await rt._jobs.send(QUEUE_NAMES.FINANCE_POST, { tenantId: ctx.tenantId, kind: "refund", id: refund.id });
    }

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
    const [ord] = await tx
      .select({ shipsOn: schema.orders.shipsOn, preorderReleasedAt: schema.orders.preorderReleasedAt })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, input.id)))
      .limit(1);

    const today = new Date().toISOString().slice(0, 10);
    if (ord?.shipsOn && !ord.preorderReleasedAt && String(ord.shipsOn) > today) {
      throw new Error(`Precondition: Pre-order ships on ${ord.shipsOn}`);
    }

    let locationId = input.locationId;
    if (!locationId) {
      const [loc] = await tx
        .select({ id: schema.locations.id })
        .from(schema.locations)
        .where(and(eq(schema.locations.tenantId, ctx.tenantId), eq(schema.locations.isDefault, true)))
        .limit(1);
      locationId = loc?.id;
      if (!locationId) {
        const [anyLoc] = await tx
          .select({ id: schema.locations.id })
          .from(schema.locations)
          .where(eq(schema.locations.tenantId, ctx.tenantId))
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
      { ...rt, _db: { db: tx } } as unknown as Runtime,
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
  const inv = await generateInvoice(rt, ctx, { orderId: input.id });
  return {
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.number,
  };
}
