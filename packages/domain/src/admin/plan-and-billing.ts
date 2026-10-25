import { and, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, QUEUE_NAMES } from "@bs/db";
import { SaasNotConfiguredError, saasDb, type Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { cancelTenantSubscription, changeTenantPlan, reconcileCashfreeSubscription } from "../saas/billing.ts";
import { loadPlatformBillingCredentials } from "../platform/billing-settings.ts";
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
  /** Paying by card or UPI through the platform's payment gateway, Razorpay or Cashfree (billing B3, ADR-037). */
  billing: {
    /** Which gateway a new subscription will use. */
    provider: "razorpay" | "cashfree";
    /** True once the platform owner has enabled billing with keys. */
    available: boolean;
    /** Billing runs in the gateway's test mode: no real money moves. */
    testMode: boolean;
    /** A gateway subscription exists (created, authorised or charging). */
    hasSubscription: boolean;
    /** The merchant finished authorising automatic payment, so the first charge will happen by itself. */
    authorized: boolean;
    /** The store has no paid plan and no trial left (created by Super Admin, or its trial ended unpaid): it should choose a plan and pay. */
    activationRequired: boolean;
    /** The owner's account already has a phone number, so the payment form need not ask for one. */
    phoneOnFile: boolean;
    /** While on a trial: when the trial (and so the first charge) ends. */
    firstChargeAt: string | null;
    /** When an active subscription will end because it was cancelled. */
    cancelAt: string | null;
  };
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
  const loadSub = async () => {
    const [row] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, ctx.tenantId))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1);
    return row;
  };
  let sub = await loadSub();
  // Cashfree is asked directly whether the merchant finished authorising and whether the first payment went through: the webhook
  // is the primary route, but the merchant is back on this page before it arrives (and a webhook can be missed).
  if (sub && (await reconcileCashfreeSubscription(rt, sub))) sub = await loadSub();

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
    // A limit of 0 (the restricted tier allows no custom domains) would divide by zero and make the whole page fail validation.
    const percentUsed = res.limit > 0 ? Math.min(100, Math.round((used / res.limit) * 100)) : used > 0 ? 100 : 0;
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
      downloadable: true, // rendered on demand (billing B6)
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

  // Online payment is simply "not available" where the self-service database role is not configured (local dev, tests).
  let creds: Awaited<ReturnType<typeof loadPlatformBillingCredentials>> = null;
  try {
    creds = await loadPlatformBillingCredentials(saasDb(rt));
  } catch (e) {
    // Never let the payment side break the page: without credentials the page just says online payment is not available.
    if (!(e instanceof SaasNotConfiguredError)) console.error("[billing] could not load the platform billing credentials", e);
  }
  const authorizedAt = sub?.authorizedAt ?? null;
  return {
    plan: planView,
    usage,
    invoices,
    billing: {
      provider: creds?.provider ?? "razorpay",
      available: Boolean(creds),
      testMode: creds?.mode !== "live",
      hasSubscription: Boolean(sub?.providerSubscriptionId),
      authorized: Boolean(authorizedAt),
      activationRequired: await needsActivation(rt, ctx.tenantId, sub),
      phoneOnFile: await ownerHasPhone(rt, ctx).catch(() => false),
      firstChargeAt: sub?.status === "trialing" ? (sub.currentPeriodEnd?.toISOString() ?? null) : null,
      cancelAt: sub?.cancelAt?.toISOString() ?? null,
    },
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
      throw new Error("Bad Request: Rate limit exceeded: You can only submit up to 3 plan change requests per day.");
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
      throw new Error("Not Found: Plan change request not found");
    }
    if (row.status !== "open") {
      throw new Error(`Conflict: Cannot cancel request with status '${row.status}'`);
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

function storeOwnerId(ctx: TenantContext, what: string): string {
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error(`Forbidden: Only the store owner can ${what}.`);
  }
  return ctx.actor.userId;
}

/**
 * A store with no paid plan and no trial left: it was created by Super Admin (or its trial ended) and has never paid. A store that
 * paid once and is late now is a dunning case, not this one.
 */
async function needsActivation(rt: Runtime, tenantId: string, sub: typeof schema.subscriptions.$inferSelect | undefined): Promise<boolean> {
  if (!sub || (sub.status !== "trialing" && sub.status !== "past_due")) return false;
  const trialOver = sub.status === "past_due" || (sub.currentPeriodEnd !== null && sub.currentPeriodEnd.getTime() <= Date.now());
  if (!trialOver) return false;
  try {
    const [paid] = await rt._db.db
      .select({ id: schema.platformInvoices.id })
      .from(schema.platformInvoices)
      .where(eq(schema.platformInvoices.tenantId, tenantId))
      .limit(1);
    return !paid;
  } catch {
    return false;
  }
}

async function ownerHasPhone(rt: Runtime, ctx: TenantContext): Promise<boolean> {
  if (ctx.actor.type !== "staff") return false;
  const [u] = await rt._db.db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, ctx.actor.userId)).limit(1);
  return Boolean(u?.phone && u.phone.replace(/\D/g, "").length >= 10);
}

/** Where Cashfree sends the merchant back after authorising. Only the platform's own domains and localhost are accepted. */
function safeReturnUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const root = (process.env.PLATFORM_DOMAIN?.trim() || "bcom.si").split(":")[0] ?? "bcom.si";
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    const own = u.hostname === root || u.hostname.endsWith(`.${root}`);
    if (!(own && u.protocol === "https:") && !(local && u.protocol === "http:")) return undefined;
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

/** The first charge must be later than this many seconds from now (Razorpay rejects a start_at that is too close). */
const MIN_START_AHEAD_MS = 15 * 60 * 1000;

/**
 * Starts a paid subscription for the store owner (billing B3). Razorpay returns a hosted page where the owner authorises
 * a card or UPI AutoPay; Cashfree returns a checkout session the admin app opens with Cashfree's script (ADR-037). The first charge waits until the trial or a free-months promotion ends, so nobody pays early.
 * The plan only changes after the payment webhook confirms the first charge.
 */
export async function subscribeToPlan(
  rt: Runtime,
  ctx: TenantContext,
  input: { planCode: string; interval: "monthly" | "yearly"; phone?: string | undefined; returnUrl?: string | undefined },
): Promise<{
  checkoutUrl: string | null;
  checkoutSession: { gateway: "cashfree"; sessionId: string; mode: "test" | "live" } | null;
  firstChargeAt: string | null;
  testMode: boolean;
}> {
  assertPermission(ctx, "settings.read");
  const userId = storeOwnerId(ctx, "subscribe to a plan");
  const db = rt._db.db;
  const creds = await loadPlatformBillingCredentials(saasDb(rt));
  if (!creds) throw new Error("Bad Request: online plan payment is not available yet. Request a plan change instead.");

  const [owner] = await db.select({ email: schema.users.email, name: schema.users.name, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!owner) throw new Error("Not Found: owner account");
  // Cashfree needs a phone number for the mandate. A number given here is used for this payment only, not saved to the account.
  const phone = (input.phone ?? owner.phone ?? "").replace(/[\s()-]/g, "");
  if (creds.provider === "cashfree" && !/^\+?[0-9]{10,13}$/.test(phone)) {
    throw new Error("Bad Request: a phone number is required to set up automatic payment (10 digits).");
  }

  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, ctx.tenantId)).orderBy(desc(schema.subscriptions.createdAt)).limit(1);
  if (sub?.status === "active" && sub.providerSubscriptionId) {
    throw new Error("Bad Request: this store already has an active subscription. Cancel it before choosing another plan.");
  }

  // Never charge before the trial or a free-months promotion ends.
  const candidates: number[] = [];
  if (sub?.status === "trialing" && sub.currentPeriodEnd) candidates.push(sub.currentPeriodEnd.getTime());
  const [promo] = await saasDb(rt)
    .select({ endsAt: schema.tenantPromotions.endsAt })
    .from(schema.tenantPromotions)
    .where(and(eq(schema.tenantPromotions.tenantId, ctx.tenantId), eq(schema.tenantPromotions.status, "active"), eq(schema.tenantPromotions.kind, "free_months")))
    .limit(1);
  if (promo) candidates.push(promo.endsAt.getTime());
  const target = candidates.length > 0 ? Math.max(...candidates) : 0;
  const startAtMs = target > Date.now() + MIN_START_AHEAD_MS ? target : 0;

  const res = await changeTenantPlan(rt, {
    tenantId: ctx.tenantId,
    planCode: input.planCode,
    interval: input.interval,
    customerEmail: owner.email,
    ...(owner.name ? { customerName: owner.name } : {}),
    ...(creds.provider === "cashfree" ? { customerPhone: phone.replace(/^\+?91(?=[0-9]{10}$)/, "").replace(/^\+/, "") } : {}),
    ...(safeReturnUrl(input.returnUrl) ? { returnUrl: safeReturnUrl(input.returnUrl) as string } : {}),
    ...(startAtMs ? { startAt: Math.floor(startAtMs / 1000) } : {}),
    // Nothing to wait for (no trial or free period left): the first cycle is paid now, when the mandate is authorised.
    ...(startAtMs ? {} : { chargeFirstCycleNow: true }),
  });

  await withTenant(db, ctx.tenantId, async (tx) => {
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: userId,
      action: "subscription.started",
      targetType: "subscription",
      targetId: res.providerSubscriptionId,
      diff: { planCode: { before: null, after: input.planCode }, interval: { before: null, after: input.interval }, firstChargeAt: { before: null, after: startAtMs ? new Date(startAtMs).toISOString() : null } },
    });
  });

  return {
    checkoutUrl: res.shortUrl ?? null,
    checkoutSession: res.checkoutSession ? { gateway: "cashfree", ...res.checkoutSession } : null,
    firstChargeAt: startAtMs ? new Date(startAtMs).toISOString() : null, testMode: creds.mode !== "live",
  };
}

/** Cancels the store's paid subscription at the end of the paid period (billing B3). Owner only. */
export async function cancelPlanSubscription(rt: Runtime, ctx: TenantContext): Promise<{ cancelAt: string | null }> {
  assertPermission(ctx, "settings.read");
  const userId = storeOwnerId(ctx, "cancel the subscription");
  const res = await cancelTenantSubscription(rt, ctx.tenantId);
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: userId,
      action: "subscription.cancel_requested",
      targetType: "subscription",
      targetId: ctx.tenantId,
      diff: { cancelAt: { before: null, after: res.cancelAt?.toISOString() ?? null } },
    });
  });
  return { cancelAt: res.cancelAt?.toISOString() ?? null };
}
