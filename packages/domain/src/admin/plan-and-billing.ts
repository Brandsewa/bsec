import { and, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, QUEUE_NAMES } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { resolveEffectiveQuota, DEFAULT_TIER_TABLE, type PlanQuotaKey } from "../system/quotas.ts";

export interface PlanAndBillingUsageItem {
  key: "products" | "staff_seats" | "storage_mb" | "orders_month" | "emails_month" | "custom_domains";
  description: string;
  used: number;
  limit: number | null;
  unit: string;
  enforcement: "hard" | "soft" | "notify";
  percentUsed: number;
}

export interface PlanAndBillingInvoiceItem {
  id: string;
  number: string;
  issuedAt: string;
  paidAt: string | null;
  amountPaise: number;
  taxPaise: number;
  status: "issued" | "paid" | "void";
  downloadable: boolean;
}

export interface PlanAndBillingView {
  plan: {
    code: string;
    name: string;
    interval: "monthly" | "yearly";
    status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
    currentPeriodEnd: string | null;
    features: Record<string, unknown>;
    limits: Record<string, unknown>;
    daysLeftInTrial?: number;
  } | null;
  usage: PlanAndBillingUsageItem[];
  invoices: PlanAndBillingInvoiceItem[];
  openPlanChangeRequest: {
    id: string;
    requestedBy: string;
    fromPlanId?: string | null;
    toPlanId: string;
    toPlanCode: string;
    toPlanName: string;
    interval: "monthly" | "yearly";
    note?: string | null;
    status: "open" | "approved" | "declined" | "cancelled";
    createdAt: string;
  } | null;
}

export interface AvailablePlanSummary {
  id: string;
  code: string;
  name: string;
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  isCurrent: boolean;
}

export interface RequestPlanChangeInput {
  toPlanId: string;
  interval: "monthly" | "yearly";
  note?: string | undefined;
}

/**
 * Retrieves the Plan and Billing view for the store admin.
 * Filters strictly by ctx.tenantId on platform-scoped tables.
 * Returns redacted projection (no provider ids, no secrets).
 * Redacted summary visible to members with settings.read; invoices only visible to store_owner.
 */
export async function getPlanAndBilling(
  rt: Runtime,
  ctx: TenantContext,
): Promise<PlanAndBillingView> {
  assertPermission(ctx, "settings.read");
  const isOwner = ctx.roles.includes("store_owner");

  const db = rt._db.db;

  // 1. Subscription & Plan (strictly filtered by ctx.tenantId)
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, ctx.tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  let currentPlan: typeof schema.plans.$inferSelect | null = null;
  if (sub?.planId) {
    const [p] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, sub.planId))
      .limit(1);
    currentPlan = p ?? null;
  }

  let daysLeftInTrial = 0;
  if (sub?.status === "trialing" && sub.currentPeriodEnd) {
    const msLeft = sub.currentPeriodEnd.getTime() - Date.now();
    daysLeftInTrial = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  }

  // 2. Quota Usage items
  const [prodRes, staffRes, domRes, orderRes, mediaRes] = await withTenant(
    db,
    ctx.tenantId,
    async (tx) => {
      return Promise.all([
        tx.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text as count FROM products WHERE tenant_id = ${ctx.tenantId} AND status != 'archived';`,
        ),
        tx.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text as count FROM memberships WHERE tenant_id = ${ctx.tenantId};`,
        ),
        tx.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text as count FROM domains WHERE tenant_id = ${ctx.tenantId} AND type = 'custom' AND status != 'removed';`,
        ),
        tx.execute<{ count: string }>(
          sql`SELECT COUNT(*)::text as count FROM orders WHERE tenant_id = ${ctx.tenantId} AND created_at >= date_trunc('month', now());`,
        ),
        tx.execute<{ total: string }>(
          sql`SELECT COALESCE(SUM(bytes), 0)::text as total FROM media WHERE tenant_id = ${ctx.tenantId};`,
        ),
      ]);
    },
  );

  const counts: Record<string, number> = {
    products: parseInt(prodRes.rows[0]?.count ?? "0", 10),
    staff_seats: parseInt(staffRes.rows[0]?.count ?? "0", 10),
    custom_domains: parseInt(domRes.rows[0]?.count ?? "0", 10),
    orders_month: parseInt(orderRes.rows[0]?.count ?? "0", 10),
    storage_mb: Math.round(parseInt(mediaRes.rows[0]?.total ?? "0", 10) / (1024 * 1024)),
    emails_month: 0,
  };

  const usageKeys: Array<"products" | "staff_seats" | "storage_mb" | "orders_month" | "emails_month" | "custom_domains"> = [
    "products",
    "staff_seats",
    "storage_mb",
    "orders_month",
    "emails_month",
    "custom_domains",
  ];

  const usage: PlanAndBillingUsageItem[] = [];
  for (const key of usageKeys) {
    const res = await resolveEffectiveQuota(db, ctx.tenantId, key as PlanQuotaKey);
    const used = counts[key] ?? 0;
    const percentUsed = Math.min(100, Math.round((used / res.limit) * 100));
    usage.push({
      key,
      description: DEFAULT_TIER_TABLE[key as PlanQuotaKey]?.desc ?? key,
      used,
      limit: res.limit,
      unit: res.unit,
      enforcement: res.enforcement,
      percentUsed,
    });
  }

  // 3. Invoices (strictly owner-only, filtered by ctx.tenantId)
  let invoices: PlanAndBillingInvoiceItem[] = [];
  if (isOwner) {
    const invRows = await db
      .select()
      .from(schema.platformInvoices)
      .where(eq(schema.platformInvoices.tenantId, ctx.tenantId))
      .orderBy(desc(schema.platformInvoices.issuedAt))
      .limit(20);

    invoices = invRows.map((inv) => ({
      id: inv.id,
      number: inv.number,
      issuedAt: inv.issuedAt.toISOString(),
      paidAt: inv.paidAt?.toISOString() ?? null,
      amountPaise: inv.amountPaise,
      taxPaise: inv.taxPaise,
      status: inv.status as "issued" | "paid" | "void",
      downloadable: Boolean(inv.pdfKey),
    }));
  }

  // 4. Open Plan Change Request
  let openPlanChangeRequest = null;
  const [openReq] = await withTenant(db, ctx.tenantId, (tx) =>
    tx
      .select()
      .from(schema.planChangeRequests)
      .where(
        and(
          eq(schema.planChangeRequests.tenantId, ctx.tenantId),
          eq(schema.planChangeRequests.status, "open"),
        ),
      )
      .limit(1),
  );

  if (openReq) {
    const [targetPlan] = await db
      .select({ code: schema.plans.code, name: schema.plans.name })
      .from(schema.plans)
      .where(eq(schema.plans.id, openReq.toPlanId))
      .limit(1);

    openPlanChangeRequest = {
      id: openReq.id,
      requestedBy: openReq.requestedBy,
      fromPlanId: openReq.fromPlanId,
      toPlanId: openReq.toPlanId,
      toPlanCode: targetPlan?.code ?? "unknown",
      toPlanName: targetPlan?.name ?? "Unknown Plan",
      interval: openReq.interval as "monthly" | "yearly",
      note: openReq.note,
      status: openReq.status as "open" | "approved" | "declined" | "cancelled",
      createdAt: openReq.createdAt.toISOString(),
    };
  }

  const planView = currentPlan
    ? {
        code: currentPlan.code,
        name: currentPlan.name,
        interval: (sub?.interval as "monthly" | "yearly") ?? "monthly",
        status: (sub?.status as "trialing" | "active" | "past_due" | "suspended" | "cancelled") ?? "trialing",
        currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
        features: (currentPlan.features as Record<string, unknown>) ?? {},
        limits: (currentPlan.limits as Record<string, unknown>) ?? {},
        ...(daysLeftInTrial > 0 ? { daysLeftInTrial } : {}),
      }
    : null;

  return {
    plan: planView,
    usage,
    invoices,
    openPlanChangeRequest,
  };
}

/**
 * Lists available public plans for the merchant plan request dialog.
 */
export async function listAvailablePlans(
  rt: Runtime,
  ctx: TenantContext,
): Promise<AvailablePlanSummary[]> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  const [sub] = await db
    .select({ planId: schema.subscriptions.planId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, ctx.tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  const planRows = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.isPublic, true))
    .orderBy(schema.plans.sort);

  return planRows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    priceMonthlyPaise: p.priceMonthlyPaise,
    priceYearlyPaise: p.priceYearlyPaise,
    isCurrent: p.id === sub?.planId,
  }));
}

/**
 * Creates a plan-change request. Owner-only, rate-limited to 3 per day.
 * Enqueues a notification to platform staff after commit.
 */
export async function requestPlanChange(
  rt: Runtime,
  ctx: TenantContext,
  input: RequestPlanChangeInput,
): Promise<{ id: string; status: "open"; message: string }> {
  // Owner only (Slice 5D & Acceptance Criteria §10)
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error("Forbidden: Only the store owner can request a plan change.");
  }

  const db = rt._db.db;

  // Verify target plan is public
  const [targetPlan] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, input.toPlanId), eq(schema.plans.isPublic, true)))
    .limit(1);

  if (!targetPlan) {
    throw new Error("Bad Request: The selected plan does not exist or is not available for request.");
  }

  // Get current plan
  const [sub] = await db
    .select({ planId: schema.subscriptions.planId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, ctx.tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  if (sub?.planId === targetPlan.id) {
    throw new Error("Bad Request: You are already on this plan.");
  }

  // Rate limiting (3 per day per tenant) & single open request enforcement
  const userId = ctx.actor.userId;

  const createdId = await withTenant(db, ctx.tenantId, async (tx) => {
    // Check open requests
    const [existingOpen] = await tx
      .select({ id: schema.planChangeRequests.id })
      .from(schema.planChangeRequests)
      .where(
        and(
          eq(schema.planChangeRequests.tenantId, ctx.tenantId),
          eq(schema.planChangeRequests.status, "open"),
        ),
      )
      .limit(1);

    if (existingOpen) {
      throw new Error(
        "Bad Request: You already have an open plan change request. Please wait for platform staff or cancel your existing request.",
      );
    }

    // Rate limit check: max 3 per day
    const recent = await tx.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text as count FROM plan_change_requests WHERE tenant_id = ${ctx.tenantId} AND created_at >= now() - interval '1 day';`,
    );
    if (parseInt(recent.rows[0]?.count ?? "0", 10) >= 3) {
      throw new Error("Rate limit exceeded: You can only submit up to 3 plan change requests per day.");
    }

    const [inserted] = await tx
      .insert(schema.planChangeRequests)
      .values({
        tenantId: ctx.tenantId,
        requestedBy: userId,
        fromPlanId: sub?.planId ?? null,
        toPlanId: targetPlan.id,
        interval: input.interval,
        note: input.note ? input.note.trim() : null,
        status: "open",
      })
      .returning({ id: schema.planChangeRequests.id });

    if (!inserted) {
      throw new Error("Failed to create plan change request");
    }

    // Write audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: userId,
      action: "plan_change.requested",
      targetType: "plan_change_requests",
      targetId: inserted.id,
      diff: {
        fromPlanId: { before: null, after: sub?.planId ?? null },
        toPlanId: { before: null, after: targetPlan.id },
        interval: { before: null, after: input.interval },
        note: { before: null, after: input.note ?? null },
      },
    });

    return inserted.id;
  });

  // Enqueue notification via pg-boss after commit (ADR-006)
  if (rt._jobs) {
    await rt._jobs.send(QUEUE_NAMES.PLAN_CHANGE_REQUESTED, {
      requestId: createdId,
      tenantId: ctx.tenantId,
      requestedBy: userId,
      toPlanCode: targetPlan.code,
    });
  }

  return {
    id: createdId,
    status: "open",
    message: "Plan change request submitted. Platform staff have been notified.",
  };
}

/**
 * Cancels an open plan-change request.
 */
export async function cancelPlanChangeRequest(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string } | string,
): Promise<{ ok: boolean }> {
  const requestId = typeof input === "string" ? input : input.id;
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error("Forbidden: Only the store owner can cancel a plan change request.");
  }
  const staffUserId = ctx.actor.userId;

  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.planChangeRequests)
      .where(
        and(
          eq(schema.planChangeRequests.tenantId, ctx.tenantId),
          eq(schema.planChangeRequests.id, requestId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error("Plan change request not found");
    }
    if (row.status !== "open") {
      throw new Error(`Cannot cancel request with status '${row.status}'`);
    }

    await tx
      .update(schema.planChangeRequests)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(schema.planChangeRequests.tenantId, ctx.tenantId),
          eq(schema.planChangeRequests.id, requestId),
        ),
      );

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: staffUserId,
      action: "plan_change.cancelled",
      targetType: "plan_change_requests",
      targetId: requestId,
      diff: { status: { before: "open", after: "cancelled" } },
    });
  });

  return { ok: true };
}
