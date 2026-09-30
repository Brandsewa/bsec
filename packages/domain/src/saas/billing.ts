import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";

export interface SubscriptionBillingProvider {
  isConfigured?(): boolean;
  createSubscription(params: {
    planCode: string;
    interval: "monthly" | "yearly";
    customerEmail: string;
    customerName?: string;
    tenantId: string;
    planId?: string;
    notes?: Record<string, string>;
  }): Promise<{
    providerSubscriptionId: string;
    shortUrl?: string;
    status: string;
  }>;
  cancelSubscription(providerSubscriptionId: string): Promise<{ status: string }>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export class RazorpaySubscriptionProvider implements SubscriptionBillingProvider {
  private keyId: string | null;
  private keySecret: string | null;
  private webhookSecret: string | null;

  constructor(opts?: {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
  }) {
    this.keyId = opts?.keyId ?? process.env.RAZORPAY_PLATFORM_KEY_ID ?? null;
    this.keySecret = opts?.keySecret ?? process.env.RAZORPAY_PLATFORM_KEY_SECRET ?? null;
    this.webhookSecret = opts?.webhookSecret ?? process.env.RAZORPAY_PLATFORM_WEBHOOK_SECRET ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  async createSubscription(params: {
    planCode: string;
    interval: "monthly" | "yearly";
    customerEmail: string;
    customerName?: string;
    tenantId: string;
    planId?: string;
    notes?: Record<string, string>;
  }): Promise<{
    providerSubscriptionId: string;
    shortUrl?: string;
    status: string;
  }> {
    if (!this.isConfigured()) {
      throw new Error("Billing is not configured: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing");
    }

    if (!params.planId) {
      throw new Error(`Razorpay plan ID is required to create subscription for '${params.planCode}'`);
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        plan_id: params.planId,
        total_count: params.interval === "yearly" ? 5 : 60,
        customer_notify: 1,
        notes: {
          tenant_id: params.tenantId,
          plan_code: params.planCode,
          ...params.notes,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay subscription creation failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { id: string; short_url?: string; status: string };
    return {
      providerSubscriptionId: data.id,
      ...(data.short_url ? { shortUrl: data.short_url } : {}),
      status: data.status,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<{ status: string }> {
    if (!this.isConfigured()) {
      throw new Error("Billing is not configured: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing");
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${providerSubscriptionId}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ cancel_at_cycle_end: 0 }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay subscription cancellation failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { status: string };
    return { status: data.status };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = this.webhookSecret;
    if (!secret || typeof signature !== "string") {
      return false;
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  }
}

export interface PlatformBillingWebhookResult {
  received: boolean;
  eventId: string;
  duplicate?: boolean;
  actionTaken?: string;
}

/**
 * Handles incoming webhooks on /api/webhooks/platform-billing (ADR-014).
 * Fails closed on signature check, saves to webhook_inbox, and processes lifecycle events.
 */
export async function handlePlatformBillingWebhook(
  rt: Runtime,
  params: {
    rawBody: string;
    signature: string;
    provider?: SubscriptionBillingProvider;
    headers?: Record<string, string | string[] | undefined> | Headers;
    eventId?: string;
  },
): Promise<PlatformBillingWebhookResult> {
  const db = rt._db.db;
  const billingProvider = params.provider ?? new RazorpaySubscriptionProvider();

  // 1. Signature Verification (Fails closed per ADR-014)
  const isValid = billingProvider.verifyWebhookSignature(params.rawBody, params.signature);
  if (!isValid) {
    const err = Object.assign(new Error("Invalid platform billing webhook signature"), { statusCode: 400 });
    throw err;
  }

  interface RazorpayWebhookPayload {
    id?: string;
    event_id?: string;
    event?: string;
    payload?: {
      subscription?: {
        entity?: {
          id?: string;
          current_start?: number;
          current_end?: number;
          notes?: Record<string, string>;
        };
      };
      payment?: {
        entity?: {
          id?: string;
          amount?: number;
          notes?: Record<string, string>;
        };
      };
    };
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(params.rawBody) as RazorpayWebhookPayload;
  } catch {
    const err = Object.assign(new Error("Invalid JSON payload"), { statusCode: 400 });
    throw err;
  }

  const eventType = payload.event ?? "";

  // Take the idempotency key from the X-Razorpay-Event-Id header. If missing, use a hash of the raw body. Never use a random id.
  let eventId = params.eventId;
  if (!eventId && params.headers) {
    if (typeof (params.headers as Headers).get === "function") {
      eventId = (params.headers as Headers).get("x-razorpay-event-id") ?? undefined;
    } else {
      const h = params.headers as Record<string, string | string[] | undefined>;
      const val = h["x-razorpay-event-id"] ?? h["X-Razorpay-Event-Id"];
      eventId = Array.isArray(val) ? val[0] : val;
    }
  }
  if (!eventId && (payload.event_id || payload.id)) {
    eventId = (payload.event_id || payload.id) as string;
  }
  if (!eventId) {
    eventId = createHash("sha256").update(params.rawBody).digest("hex");
  }

  // 2. Idempotency Check in webhook_inbox
  const [existingInbox] = await db
    .select()
    .from(schema.webhookInbox)
    .where(
      and(
        eq(schema.webhookInbox.provider, "razorpay_platform"),
        eq(schema.webhookInbox.eventId, eventId),
      ),
    )
    .limit(1);

  if (existingInbox && existingInbox.status === "processed") {
    return { received: true, eventId, duplicate: true, actionTaken: "already_processed" };
  }

  // Record into webhook_inbox
  if (!existingInbox) {
    await db.insert(schema.webhookInbox).values({
      provider: "razorpay_platform",
      eventId,
      signatureValid: true,
      payloadSanitized: payload,
      status: "processing",
    });
  } else {
    await db
      .update(schema.webhookInbox)
      .set({ attempts: existingInbox.attempts + 1, status: "processing" })
      .where(eq(schema.webhookInbox.id, existingInbox.id));
  }

  try {
    let actionTaken = "ignored";

    // 3. Process Subscription Lifecycle Events
    if (eventType === "subscription.charged") {
      const subEntity = payload.payload?.subscription?.entity;
      const paymentEntity = payload.payload?.payment?.entity;
      if (!paymentEntity || typeof paymentEntity.amount !== "number") {
        const err = Object.assign(new Error("Payment entity missing or invalid in subscription.charged webhook"), { statusCode: 400 });
        throw err;
      }
      const amountPaise = paymentEntity.amount;
      const subId = subEntity?.id;
      const tenantIdNote = subEntity?.notes?.tenant_id ?? paymentEntity?.notes?.tenant_id;
      const planCodeNote = subEntity?.notes?.plan_code ?? paymentEntity?.notes?.plan_code;

      if (subId || tenantIdNote) {
        let sub: typeof schema.subscriptions.$inferSelect | null = null;
        if (subId) {
          const [byProviderId] = await db
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.providerSubscriptionId, subId))
            .limit(1);
          if (byProviderId) sub = byProviderId;
        }
        if (!sub && tenantIdNote) {
          const [byTenantId] = await db
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.tenantId, tenantIdNote))
            .orderBy(desc(schema.subscriptions.createdAt))
            .limit(1);
          if (byTenantId) sub = byTenantId;
        }

        if (sub) {
          const activeSub = sub;
          const currentStart = subEntity?.current_start
            ? new Date(subEntity.current_start * 1000)
            : new Date();
          const currentEnd = subEntity?.current_end
            ? new Date(subEntity.current_end * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          const taxPaise = Math.round((amountPaise * 18) / 118); // 18% inclusive GST
          const dateStr = new Date().toISOString().slice(0, 7).replace("-", "");
          const invoiceNumber = `INV-${dateStr}-${randomBytes(3).toString("hex").toUpperCase()}`;

          // Do the invoice, subscription and tier writes in ONE transaction
          await db.transaction(async (tx) => {
            // If planCodeNote is present, find plan by code and update planId
            let newPlanId = activeSub.planId;
            if (planCodeNote) {
              const [targetPlan] = await tx
                .select()
                .from(schema.plans)
                .where(eq(schema.plans.code, planCodeNote))
                .limit(1);
              if (targetPlan) {
                newPlanId = targetPlan.id;
              }
            }

            // Update subscription to active
            await tx
              .update(schema.subscriptions)
              .set({
                status: "active",
                ...(newPlanId ? { planId: newPlanId } : {}),
                providerSubscriptionId: subId ?? undefined,
                currentPeriodStart: currentStart,
                currentPeriodEnd: currentEnd,
                updatedAt: new Date(),
              })
              .where(eq(schema.subscriptions.id, activeSub.id));

            // Generate GST Invoice
            await tx.insert(schema.platformInvoices).values({
              tenantId: activeSub.tenantId,
              subscriptionId: activeSub.id,
              number: invoiceNumber,
              amountPaise,
              taxPaise,
              status: "paid",
              issuedAt: new Date(),
              paidAt: new Date(),
            });

            // Ensure tenant quota size tier reflects plan tier
            const effectivePlanId = newPlanId ?? activeSub.planId;
            if (effectivePlanId) {
              const planRow = await tx.execute<{ code: string }>(sql`
                SELECT code FROM plans WHERE id = ${effectivePlanId} LIMIT 1;
              `);
              const planCode = planRow.rows[0]?.code;
              const tierMap: Record<string, "XS" | "S" | "M" | "L"> = {
                starter: "S",
                growth: "M",
                pro: "L",
              };
              const tier = planCode ? tierMap[planCode] ?? "S" : "S";

              await tx
                .insert(schema.tenantSizeTiers)
                .values({ tenantId: activeSub.tenantId, tier })
                .onConflictDoUpdate({
                  target: schema.tenantSizeTiers.tenantId,
                  set: { tier, updatedAt: new Date() },
                });
            }
          });

          actionTaken = "subscription_activated_and_invoiced";
        }
      }

    } else if (eventType === "subscription.halted") {
      const subEntity = payload.payload?.subscription?.entity;
      const subId = subEntity?.id;
      if (subId) {
        await db
          .update(schema.subscriptions)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(schema.subscriptions.providerSubscriptionId, subId));
        actionTaken = "subscription_past_due";
      }
    } else if (eventType === "subscription.cancelled") {
      const subEntity = payload.payload?.subscription?.entity;
      const subId = subEntity?.id;
      if (subId) {
        await db
          .update(schema.subscriptions)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(schema.subscriptions.providerSubscriptionId, subId));
        actionTaken = "subscription_cancelled";
      }
    } else if (eventType === "subscription.resumed" || eventType === "subscription.activated") {
      const subEntity = payload.payload?.subscription?.entity;
      const subId = subEntity?.id;
      if (subId) {
        await db
          .update(schema.subscriptions)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(schema.subscriptions.providerSubscriptionId, subId));
        actionTaken = "subscription_resumed";
      }
    }

    // Mark processed
    await db
      .update(schema.webhookInbox)
      .set({
        status: "processed",
        processedAt: new Date(),
      })
      .where(
        and(
          eq(schema.webhookInbox.provider, "razorpay_platform"),
          eq(schema.webhookInbox.eventId, eventId),
        ),
      );

    return { received: true, eventId, actionTaken };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.webhookInbox)
      .set({
        status: "failed",
        error: errorMsg,
      })
      .where(
        and(
          eq(schema.webhookInbox.provider, "razorpay_platform"),
          eq(schema.webhookInbox.eventId, eventId),
        ),
      );
    throw err;
  }
}

/**
 * Retrieves the current subscription, plan, and invoice history for a tenant.
 */
export async function getTenantSubscription(
  rt: Runtime,
  tenantId: string,
) {
  const db = rt._db.db;

  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  let currentPlan = null;
  if (sub?.planId) {
    const [p] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, sub.planId))
      .limit(1);
    currentPlan = p ?? null;
  }

  const invoices = await db
    .select()
    .from(schema.platformInvoices)
    .where(eq(schema.platformInvoices.tenantId, tenantId))
    .orderBy(desc(schema.platformInvoices.issuedAt))
    .limit(20);

  const isTrial = sub?.status === "trialing";
  let daysLeftInTrial = 0;
  if (isTrial && sub?.currentPeriodEnd) {
    const msLeft = sub.currentPeriodEnd.getTime() - Date.now();
    daysLeftInTrial = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  }

  return {
    subscription: sub ?? null,
    plan: currentPlan,
    invoices,
    isTrial,
    daysLeftInTrial,
  };
}

/**
 * Initiates an upgrade or plan change for a tenant.
 */
export async function changeTenantPlan(
  rt: Runtime,
  params: {
    tenantId: string;
    planCode: string;
    interval: "monthly" | "yearly";
    customerEmail: string;
    customerName?: string;
    provider?: SubscriptionBillingProvider;
  },
) {
  const db = rt._db.db;
  const billingProvider = params.provider ?? new RazorpaySubscriptionProvider();

  if (typeof billingProvider.isConfigured === "function" && !billingProvider.isConfigured()) {
    throw new Error("Billing is not configured: missing Razorpay credentials");
  }

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.code, params.planCode))
    .limit(1);

  if (!plan) {
    throw new Error(`Plan '${params.planCode}' not found`);
  }

  const features = plan.features as Record<string, unknown> | null;
  const planIds = features?.razorpay_plan_ids as Record<string, string> | undefined;
  const razorpayPlanId =
    params.interval === "yearly"
      ? plan.razorpayPlanIdYearly ?? planIds?.yearly
      : plan.razorpayPlanIdMonthly ?? planIds?.monthly;

  if (!razorpayPlanId) {
    throw new Error(
      `Plan '${plan.code}' has no Razorpay plan ID configured for interval '${params.interval}'. Please configure real Razorpay plan IDs.`,
    );
  }

  // Create provider subscription
  const result = await billingProvider.createSubscription({
    planCode: params.planCode,
    interval: params.interval,
    customerEmail: params.customerEmail,
    ...(params.customerName ? { customerName: params.customerName } : {}),
    tenantId: params.tenantId,
    planId: razorpayPlanId,
  });

  // Update or insert subscription record
  // NOTE: Plan changes and activation take effect only after payment webhook confirms it.
  const [existingSub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, params.tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  if (existingSub) {
    await db
      .update(schema.subscriptions)
      .set({
        interval: params.interval,
        providerSubscriptionId: result.providerSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptions.id, existingSub.id));
  } else {
    // The no-subscription branch must not insert an active subscription without payment.
    await db.insert(schema.subscriptions).values({
      tenantId: params.tenantId,
      planId: plan.id,
      interval: params.interval,
      status: "pending",
      provider: "razorpay",
      providerSubscriptionId: result.providerSubscriptionId,
    });
  }

  return {
    providerSubscriptionId: result.providerSubscriptionId,
    shortUrl: result.shortUrl,
    status: result.status,
    plan,
  };
}

/**
 * Cancels a tenant's subscription.
 */
export async function cancelTenantSubscription(
  rt: Runtime,
  tenantId: string,
  provider?: SubscriptionBillingProvider,
) {
  const db = rt._db.db;
  const billingProvider = provider ?? new RazorpaySubscriptionProvider();

  if (typeof billingProvider.isConfigured === "function" && !billingProvider.isConfigured()) {
    throw new Error("Billing is not configured: missing Razorpay credentials");
  }

  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  if (!sub || !sub.providerSubscriptionId) {
    throw new Error("No active subscription found to cancel");
  }

  const res = await billingProvider.cancelSubscription(sub.providerSubscriptionId);
  return res;
}

