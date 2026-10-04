import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  customers,
  orders,
  products,
  quoteRequests,
  schema,
  variants,
  withTenant,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { allocateSequenceNumber } from "../orders/sequences.ts";
import { checkRateLimit, RateLimitExceededError } from "../system/rate-limit.ts";
import { transitionOrder } from "../orders/state-machine.ts";

export interface SubmitQuoteRequestInput {
  productId?: string | undefined;
  variantId?: string | undefined;
  quantity?: number | undefined;
  name: string;
  email: string;
  phone?: string | undefined;
  company?: string | undefined;
  message?: string | undefined;
  ip?: string | undefined;
}

export type SubmitQuoteRequestResult = QuoteRecord & {
  success: boolean;
  quoteNumber: string;
  message: string;
};

export interface ListQuotesInput {
  tab?: "all" | "needs_reply" | "quote_sent" | "expired" | "accepted" | "closed" | undefined;
  search?: string | undefined;
  dateRange?: "any" | "7d" | "30d" | "90d" | undefined;
  customerType?: "all" | "account" | "guest" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface QuoteStatsRecord {
  needsReply: number;
  quoteSent: number;
  expired: number;
  accepted: number;
  totalQuotesValue: number;
}

export interface QuoteRecord {
  id: string;
  number: string;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  name: string;
  email: string;
  phone: string;
  company: string | null;
  message: string | null;
  status: "new" | "quoted" | "accepted" | "lost" | "expired";
  derivedStage: "needs_reply" | "quote_sent" | "accepted" | "expired" | "closed";
  adminNote: string | null;
  quotedTotal: number | null;
  quoteNote: string | null;
  validUntil: string | null;
  quotedAt: string | null;
  orderId: string | null;
  orderNumber?: string | null;
  orderStatus?: string | null;
  orderPaymentStatus?: string | null;
  orderConfirmUrl?: string | null;
  orderViewUrl?: string | null;
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
}

function deriveStage(
  status: string,
  validUntil: Date | null | undefined,
  orderPaymentStatus?: string | null,
): "needs_reply" | "quote_sent" | "accepted" | "expired" | "closed" {
  if (status === "lost") return "closed";
  if (status === "accepted" || orderPaymentStatus === "paid") return "accepted";
  if (status === "expired") return "expired";
  if (status === "quoted") {
    if (validUntil && validUntil.getTime() <= Date.now()) {
      return "expired";
    }
    return "quote_sent";
  }
  return "needs_reply";
}

/**
 * Submits an inbound quote request from the storefront (PLAN §5.7 / ORDERS-QUOTES-PLAN §3.2).
 * Refuses price overrides from client; enforces rate limiting; allocates sequential QT- number;
 * does NOT reserve inventory and does NOT count as revenue.
 */
export async function submitQuoteRequest(
  rt: Runtime,
  ctx: TenantContext,
  input: SubmitQuoteRequestInput,
): Promise<SubmitQuoteRequestResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || "";
  const quantity = Math.max(1, Math.min(100_000, input.quantity || 1));
  const message = input.message?.trim().slice(0, 2000) ?? null;
  const company = input.company?.trim().slice(0, 100) ?? null;

  if (!name) throw new Error("Name is required");
  if (!email || !email.includes("@")) throw new Error("Valid email is required");

  const db = rt._db.db;

  // Rate limiting (10 per hour per IP, 5 per hour per email)
  const clientIp = input.ip || "unknown";
  if (clientIp !== "unknown") {
    const ipKey = `quote_req:ip:${ctx.tenantId}:${clientIp}`;
    const ipRes = await checkRateLimit(db, { key: ipKey, limit: 10, windowSeconds: 3600 });
    if (!ipRes.allowed) {
      throw new RateLimitExceededError("Too many quote requests from this IP. Please try again later.", ipRes.retryAfter, 10, ipKey);
    }
  }
  const emailKey = `quote_req:email:${ctx.tenantId}:${email}`;
  const emailRes = await checkRateLimit(db, { key: emailKey, limit: 5, windowSeconds: 3600 });
  if (!emailRes.allowed) {
    throw new RateLimitExceededError("Too many quote requests from this email. Please try again later.", emailRes.retryAfter, 5, emailKey);
  }

  return await withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Verify product & variant belong to tenant and exist
    let prodId = input.productId;
    let variantRow: { id: string; title: string; productId: string } | undefined;

    if (input.variantId) {
      const [foundV] = await tx
        .select({
          id: variants.id,
          title: variants.title,
          productId: variants.productId,
        })
        .from(variants)
        .where(and(eq(variants.tenantId, ctx.tenantId), eq(variants.id, input.variantId)))
        .limit(1);
      variantRow = foundV;
      if (variantRow && !prodId) {
        prodId = variantRow.productId;
      }
    }

    if (!prodId) {
      throw new Error("Product not available for quote request");
    }

    const [prod] = await tx
      .select({
        id: products.id,
        title: products.title,
        priceOnRequest: products.priceOnRequest,
        status: products.status,
        deletedAt: products.deletedAt,
      })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, prodId)))
      .limit(1);

    if (!prod || prod.deletedAt || prod.status !== "active") {
      throw new Error("Product not available for quote request");
    }

    let finalVariantId = variantRow?.id ?? input.variantId;
    let variantTitle = variantRow?.title ?? "Default";

    if (!finalVariantId) {
      const [defaultV] = await tx
        .select({ id: variants.id, title: variants.title })
        .from(variants)
        .where(and(eq(variants.tenantId, ctx.tenantId), eq(variants.productId, prod.id)))
        .orderBy(asc(variants.position), asc(variants.createdAt))
        .limit(1);
      if (!defaultV) throw new Error("Product variant not found");
      finalVariantId = defaultV.id;
      variantTitle = defaultV.title;
    }

    // 2. Allocate gapless quote number (QT-00001)
    const seq = await allocateSequenceNumber(tx, ctx.tenantId, "quote", "", {
      defaultPrefix: "QT-",
      defaultPadding: 5,
      initialValue: 1,
    });

    // 3. Link customer if exists by email
    const [existingCust] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.email, email)))
      .limit(1);

    // 4. Insert quote request
    const [inserted] = await tx
      .insert(quoteRequests)
      .values({
        tenantId: ctx.tenantId,
        number: seq.formatted,
        productId: prod.id,
        variantId: finalVariantId,
        productTitle: prod.title,
        variantTitle: variantTitle,
        quantity,
        name,
        email,
        phone,
        company,
        message,
        status: "new",
        customerId: existingCust?.id ?? null,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert quote request");
    }

    const derived = deriveStage(inserted.status, inserted.validUntil);

    return {
      id: inserted.id,
      number: inserted.number,
      productId: inserted.productId,
      variantId: inserted.variantId,
      productTitle: inserted.productTitle,
      variantTitle: inserted.variantTitle,
      quantity: inserted.quantity,
      name: inserted.name,
      email: inserted.email,
      phone: inserted.phone,
      company: inserted.company,
      message: inserted.message ?? "Quote request submitted successfully",
      status: inserted.status as QuoteRecord["status"],
      derivedStage: derived,
      adminNote: inserted.adminNote,
      quotedTotal: inserted.quotedTotal ? Number(inserted.quotedTotal) : null,
      quoteNote: inserted.quoteNote,
      validUntil: inserted.validUntil ? inserted.validUntil.toISOString() : null,
      quotedAt: inserted.quotedAt ? inserted.quotedAt.toISOString() : null,
      orderId: inserted.orderId,
      orderNumber: null,
      orderStatus: null,
      orderPaymentStatus: null,
      orderConfirmUrl: null,
      orderViewUrl: null,
      customerId: inserted.customerId,
      createdAt: inserted.createdAt.toISOString(),
      updatedAt: inserted.updatedAt.toISOString(),
      success: true,
      quoteNumber: seq.formatted,
    };
  });
}

/**
 * Returns KPI stats for the Quotes Workbench.
 */
export async function getAdminQuoteStats(
  rt: Runtime,
  ctx: TenantContext,
): Promise<QuoteStatsRecord> {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        status: quoteRequests.status,
        validUntil: quoteRequests.validUntil,
        quotedTotal: quoteRequests.quotedTotal,
      })
      .from(quoteRequests)
      .where(eq(quoteRequests.tenantId, ctx.tenantId));

    let needsReply = 0;
    let quoteSent = 0;
    let expired = 0;
    let accepted = 0;
    let totalQuotesValue = 0;

    const now = Date.now();
    for (const r of rows) {
      const isExp = r.status === "expired" || (r.status === "quoted" && r.validUntil && r.validUntil.getTime() <= now);
      if (r.status === "new") {
        needsReply++;
      } else if (r.status === "accepted") {
        accepted++;
        if (r.quotedTotal) totalQuotesValue += Number(r.quotedTotal);
      } else if (isExp) {
        expired++;
      } else if (r.status === "quoted") {
        quoteSent++;
        if (r.quotedTotal) totalQuotesValue += Number(r.quotedTotal);
      }
    }

    return {
      needsReply,
      quoteSent,
      expired,
      accepted,
      totalQuotesValue,
    };
  });
}

/**
 * Lists quote requests with filtering, tab views, and search.
 */
export async function listAdminQuotes(
  rt: Runtime,
  ctx: TenantContext,
  query?: ListQuotesInput,
): Promise<{ items: QuoteRecord[]; total: number }> {
  assertPermission(ctx, "orders.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(quoteRequests.tenantId, ctx.tenantId)];

    if (query?.dateRange && query.dateRange !== "any") {
      const days = query.dateRange === "7d" ? 7 : query.dateRange === "30d" ? 30 : 90;
      conditions.push(sql`${quoteRequests.createdAt} >= now() - make_interval(days => ${days})`);
    }

    if (query?.customerType === "account") {
      conditions.push(isNotNull(quoteRequests.customerId));
    } else if (query?.customerType === "guest") {
      conditions.push(isNull(quoteRequests.customerId));
    }

    if (query?.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      const searchCond = or(
        ilike(quoteRequests.number, term),
        ilike(quoteRequests.name, term),
        ilike(quoteRequests.email, term),
        ilike(quoteRequests.productTitle, term),
      );
      if (searchCond) conditions.push(searchCond);
    }

    if (query?.tab && query.tab !== "all") {
      if (query.tab === "needs_reply") {
        conditions.push(eq(quoteRequests.status, "new"));
      } else if (query.tab === "quote_sent") {
        const sentCond = and(
          eq(quoteRequests.status, "quoted"),
          or(isNull(quoteRequests.validUntil), sql`${quoteRequests.validUntil} > now()`),
        );
        if (sentCond) conditions.push(sentCond);
      } else if (query.tab === "expired") {
        const expCond = or(
          eq(quoteRequests.status, "expired"),
          and(eq(quoteRequests.status, "quoted"), sql`${quoteRequests.validUntil} <= now()`),
        );
        if (expCond) conditions.push(expCond);
      } else if (query.tab === "accepted") {
        conditions.push(eq(quoteRequests.status, "accepted"));
      } else if (query.tab === "closed") {
        conditions.push(eq(quoteRequests.status, "lost"));
      }
    }

    const whereClause = and(...conditions);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(quoteRequests)
      .where(whereClause);
    const total = totalRow?.count ?? 0;

    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    const rawRows = await tx
      .select({
        quote: quoteRequests,
        orderNumber: orders.number,
        orderStatus: orders.status,
        orderPaymentStatus: orders.paymentStatus,
      })
      .from(quoteRequests)
      .leftJoin(orders, and(eq(orders.tenantId, quoteRequests.tenantId), eq(orders.id, quoteRequests.orderId)))
      .where(whereClause)
      .orderBy(desc(quoteRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const items: QuoteRecord[] = rawRows.map(({ quote, orderNumber, orderStatus, orderPaymentStatus }) => {
      const derived = deriveStage(quote.status, quote.validUntil, orderPaymentStatus);
      return {
        id: quote.id,
        number: quote.number,
        productId: quote.productId,
        variantId: quote.variantId,
        productTitle: quote.productTitle,
        variantTitle: quote.variantTitle,
        quantity: quote.quantity,
        name: quote.name,
        email: quote.email,
        phone: quote.phone,
        company: quote.company,
        message: quote.message,
        status: quote.status as QuoteRecord["status"],
        derivedStage: derived,
        adminNote: quote.adminNote,
        quotedTotal: quote.quotedTotal ? Number(quote.quotedTotal) : null,
        quoteNote: quote.quoteNote,
        validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
        quotedAt: quote.quotedAt ? quote.quotedAt.toISOString() : null,
        orderId: quote.orderId,
        orderNumber: orderNumber ?? null,
        orderStatus: orderStatus ?? null,
        orderPaymentStatus: orderPaymentStatus ?? null,
        orderConfirmUrl: quote.orderId ? `https://${ctx.tenantId}.bcom.si/cod/${quote.orderId}` : null,
        orderViewUrl: quote.orderId ? `https://${ctx.tenantId}.bcom.si/o/${quote.orderId}` : null,
        customerId: quote.customerId,
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
      };
    });

    return { items, total };
  });
}

/**
 * Gets detail for a single quote request.
 */
export async function getAdminQuoteDetail(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
  txOrDb?: Parameters<Parameters<typeof withTenant>[2]>[0],
): Promise<QuoteRecord> {
  assertPermission(ctx, "orders.read");
  const runWithTx = async (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
    const [row] = await tx
      .select({
        quote: quoteRequests,
        orderNumber: orders.number,
        orderStatus: orders.status,
        orderPaymentStatus: orders.paymentStatus,
      })
      .from(quoteRequests)
      .leftJoin(orders, and(eq(orders.tenantId, quoteRequests.tenantId), eq(orders.id, quoteRequests.orderId)))
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)))
      .limit(1);

    if (!row) {
      throw new Error(`Quote request not found: "${input.id}"`);
    }

    const { quote, orderNumber, orderStatus, orderPaymentStatus } = row;
    const derived = deriveStage(quote.status, quote.validUntil, orderPaymentStatus);

    return {
      id: quote.id,
      number: quote.number,
      productId: quote.productId,
      variantId: quote.variantId,
      productTitle: quote.productTitle,
      variantTitle: quote.variantTitle,
      quantity: quote.quantity,
      name: quote.name,
      email: quote.email,
      phone: quote.phone,
      company: quote.company,
      message: quote.message,
      status: quote.status as QuoteRecord["status"],
      derivedStage: derived,
      adminNote: quote.adminNote,
      quotedTotal: quote.quotedTotal ? Number(quote.quotedTotal) : null,
      quoteNote: quote.quoteNote,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      quotedAt: quote.quotedAt ? quote.quotedAt.toISOString() : null,
      orderId: quote.orderId,
      orderNumber: orderNumber ?? null,
      orderStatus: orderStatus ?? null,
      orderPaymentStatus: orderPaymentStatus ?? null,
      orderConfirmUrl: quote.orderId ? `https://${ctx.tenantId}.bcom.si/cod/${quote.orderId}` : null,
      orderViewUrl: quote.orderId ? `https://${ctx.tenantId}.bcom.si/o/${quote.orderId}` : null,
      customerId: quote.customerId,
      createdAt: quote.createdAt.toISOString(),
      updatedAt: quote.updatedAt.toISOString(),
    };
  };

  if (txOrDb) {
    return await runWithTx(txOrDb);
  }
  return await withTenant(rt._db.db, ctx.tenantId, runWithTx);
}

/**
 * Updates internal note on a quote request.
 */
export async function updateAdminQuoteNote(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; adminNote: string },
): Promise<QuoteRecord> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .update(quoteRequests)
      .set({
        adminNote: input.adminNote,
        updatedAt: new Date(),
      })
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)))
      .returning();

    if (!row) throw new Error("Quote request not found");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "quote.note_updated",
      targetType: "quote",
      targetId: input.id,
      diff: { adminNote: input.adminNote },
    });

    return await getAdminQuoteDetail(rt, ctx, { id: input.id }, tx);
  });
}

/**
 * Marks a quote request as lost (closed). Refuses if already accepted.
 */
export async function markAdminQuoteLost(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; reason?: string | undefined },
): Promise<QuoteRecord> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [quote] = await tx
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)))
      .limit(1);

    if (!quote) throw new Error("Quote request not found");
    if (quote.status === "accepted") {
      throw new Error("Cannot mark an accepted quote as lost");
    }

    await tx
      .update(quoteRequests)
      .set({
        status: "lost",
        updatedAt: new Date(),
      })
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "quote.lost",
      targetType: "quote",
      targetId: input.id,
      diff: { reason: input.reason ?? "Marked lost by staff" },
    });

    return await getAdminQuoteDetail(rt, ctx, { id: input.id }, tx);
  });
}

/**
 * Reopens a lost or expired quote back to new/quoted.
 */
export async function reopenAdminQuote(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<QuoteRecord> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [quote] = await tx
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)))
      .limit(1);

    if (!quote) throw new Error("Quote request not found");

    const newStatus = quote.orderId ? "quoted" : "new";

    await tx
      .update(quoteRequests)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "quote.reopened",
      targetType: "quote",
      targetId: input.id,
      diff: { status: newStatus },
    });

    return await getAdminQuoteDetail(rt, ctx, { id: input.id }, tx);
  });
}

/**
 * Deletes a quote request.
 * Per spec: Delete is allowed only for lost or never-answered (new) leads and is audited.
 * Refused on a quoted or accepted request.
 */
export async function deleteAdminQuote(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [quote] = await tx
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)))
      .limit(1);

    if (!quote) throw new Error("Quote request not found");

    if (quote.status === "quoted" || quote.status === "accepted") {
      throw new Error("Only new or lost quote leads can be deleted");
    }

    await tx
      .delete(quoteRequests)
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "quote.deleted",
      targetType: "quote",
      targetId: input.id,
      diff: {
        number: quote.number,
        productTitle: quote.productTitle,
        customerEmail: quote.email,
      },
    });

    return { success: true };
  });
}

/**
 * Links an order created for this quote.
 */
export async function linkOrderToQuote(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; orderId: string; validDays?: number; quoteNote?: string | null | undefined },
): Promise<QuoteRecord> {
  assertPermission(ctx, "orders.write");
  const db = rt._db.db;
  const validDays = Math.max(1, Math.min(90, input.validDays ?? 7));

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.id, input.orderId)))
      .limit(1);

    if (!order) throw new Error("Order not found");

    const validUntil = new Date(Date.now() + validDays * 86400 * 1000);

    await tx
      .update(quoteRequests)
      .set({
        orderId: order.id,
        status: "quoted",
        quotedTotal: order.grandTotal,
        quotedAt: new Date(),
        validUntil,
        quoteNote: input.quoteNote ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(quoteRequests.tenantId, ctx.tenantId), eq(quoteRequests.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "quote.order_linked",
      targetType: "quote",
      targetId: input.id,
      diff: {
        orderId: order.id,
        orderNumber: order.number,
        quotedTotal: order.grandTotal,
        validDays,
      },
    });

    return await getAdminQuoteDetail(rt, ctx, { id: input.id }, tx);
  });
}

/**
 * Daily sweep / job to cancel unaccepted quote orders after valid_until date has passed
 * and mark quote requests as expired. Releases stock via order.cancel.
 */
export async function runQuoteExpirySweep(
  rt: Runtime,
  tenantId: string,
): Promise<{ expiredCount: number }> {
  const db = rt._db.db;

  return await withTenant(db, tenantId, async (tx) => {
    const expiredQuotes = await tx
      .select({
        id: quoteRequests.id,
        orderId: quoteRequests.orderId,
      })
      .from(quoteRequests)
      .where(
        and(
          eq(quoteRequests.tenantId, tenantId),
          eq(quoteRequests.status, "quoted"),
          isNotNull(quoteRequests.validUntil),
          sql`${quoteRequests.validUntil} <= now()`,
        ),
      );

    let expiredCount = 0;
    const systemCtx: TenantContext = {
      tenantId,
      storeStatus: "live",
      actor: { type: "system" },
      roles: ["store_owner"],
      permissions: ["orders.write"],
      requestId: `sweep-quote-exp-${Date.now()}`,
    };

    for (const q of expiredQuotes) {
      if (q.orderId) {
        const [ord] = await tx
          .select({ id: orders.id, status: orders.status })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.id, q.orderId)))
          .limit(1);

        if (ord && ord.status === "pending") {
          await transitionOrder(
            rt,
            systemCtx,
            ord.id,
            { type: "order.cancel", reason: "Quote offer expired" },
            tx,
          );
        }
      }

      await tx
        .update(quoteRequests)
        .set({
          status: "expired",
          updatedAt: new Date(),
        })
        .where(and(eq(quoteRequests.tenantId, tenantId), eq(quoteRequests.id, q.id)));

      expiredCount++;
    }

    return { expiredCount };
  });
}
