import { and, asc, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { loadPlatformBillingCredentials, type BillingMode } from "./billing-settings.ts";

/**
 * Razorpay plans for the platform's own plans (billing B2). Razorpay plans are immutable and separate per mode, so each
 * (plan, interval, mode, amount) is recorded; the newest row for the active mode is what a new subscription uses.
 */

export type BillingInterval = "monthly" | "yearly";

export interface BillingPlanIntervalView {
  pricePaise: number;
  /** Razorpay plan id for the active mode and the current price, null until synced. */
  razorpayPlanId: string | null;
  /** True when the newest synced plan for the active mode matches the current price. */
  inSync: boolean;
}

export interface BillingPlanView {
  planId: string;
  code: string;
  name: string;
  monthly: BillingPlanIntervalView;
  yearly: BillingPlanIntervalView;
}

export interface BillingPlansView {
  mode: BillingMode;
  /** False until billing is enabled with keys (or env keys exist): sync needs them. */
  canSync: boolean;
  plans: BillingPlanView[];
}

export interface SyncBillingPlansResult {
  mode: BillingMode;
  created: number;
  unchanged: number;
  failed: Array<{ plan: string; interval: BillingInterval; error: string }>;
}

const PERIOD: Record<BillingInterval, string> = { monthly: "monthly", yearly: "yearly" };

function priceOf(p: { priceMonthlyPaise: number; priceYearlyPaise: number }, interval: BillingInterval): number {
  return interval === "monthly" ? p.priceMonthlyPaise : p.priceYearlyPaise;
}

/**
 * The Razorpay plan id for this plan, interval and mode. With `amountPaise` only a plan created at exactly that price
 * counts (a price that went back to an older value reuses the older plan); without it the newest plan is returned.
 */
export async function findRazorpayPlanId(
  db: Db,
  planId: string,
  interval: BillingInterval,
  mode: BillingMode,
  amountPaise?: number,
): Promise<{ razorpayPlanId: string; amountPaise: number } | null> {
  const [row] = await db
    .select({ razorpayPlanId: schema.platformRazorpayPlans.razorpayPlanId, amountPaise: schema.platformRazorpayPlans.amountPaise })
    .from(schema.platformRazorpayPlans)
    .where(
      and(
        eq(schema.platformRazorpayPlans.planId, planId),
        eq(schema.platformRazorpayPlans.interval, interval),
        eq(schema.platformRazorpayPlans.mode, mode),
        ...(amountPaise !== undefined ? [eq(schema.platformRazorpayPlans.amountPaise, amountPaise)] : []),
      ),
    )
    .orderBy(desc(schema.platformRazorpayPlans.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listBillingPlans(rt: Runtime, staffUserId: string): Promise<BillingPlansView> {
  await assertPlatformStaff(rt, staffUserId);
  const db = rt._db.db;
  const creds = await loadPlatformBillingCredentials(db, "razorpay");
  const mode: BillingMode = creds?.mode ?? "test";
  const plans = await db.select().from(schema.plans).orderBy(asc(schema.plans.sort));
  const out: BillingPlanView[] = [];
  for (const p of plans) {
    const view = (interval: BillingInterval): Promise<BillingPlanIntervalView> =>
      findRazorpayPlanId(db, p.id, interval, mode, priceOf(p, interval)).then(async (match) => {
        const r = match ?? (await findRazorpayPlanId(db, p.id, interval, mode));
        return { pricePaise: priceOf(p, interval), razorpayPlanId: r?.razorpayPlanId ?? null, inSync: Boolean(match) };
      });
    out.push({ planId: p.id, code: p.code, name: p.name, monthly: await view("monthly"), yearly: await view("yearly") });
  }
  return { mode, canSync: Boolean(creds), plans: out };
}

/**
 * Creates the missing Razorpay plans for the active mode (and new ones where a price changed). Owner only. Existing plans
 * are never edited or deleted, so current subscribers are untouched. The fetch is injectable for tests.
 */
export async function syncBillingPlans(
  rt: Runtime,
  staffUserId: string,
  meta?: AuditMeta,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncBillingPlansResult> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_owner", "sync billing plans");
  const db = rt._db.db;
  const creds = await loadPlatformBillingCredentials(db, "razorpay");
  if (!creds) throw new Error("Bad Request: billing is not configured. Save and enable the Razorpay keys first");

  const auth = `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;
  const plans = await db.select().from(schema.plans).orderBy(asc(schema.plans.sort));
  const result: SyncBillingPlansResult = { mode: creds.mode, created: 0, unchanged: 0, failed: [] };

  for (const p of plans) {
    for (const interval of ["monthly", "yearly"] as const) {
      const amount = priceOf(p, interval);
      if (amount <= 0) continue;
      const existing = await findRazorpayPlanId(db, p.id, interval, creds.mode, amount);
      if (existing) {
        result.unchanged++;
        continue;
      }
      try {
        const res = await fetchImpl("https://api.razorpay.com/v1/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({
            period: PERIOD[interval],
            interval: 1,
            item: { name: `${p.name} (${interval})`, amount, currency: "INR", description: `Brand Sewa ${p.name} plan, billed ${interval}` },
            notes: { plan_code: p.code, plan_id: p.id },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300);
          result.failed.push({ plan: p.code, interval, error: `Razorpay answered ${res.status}: ${text}` });
          continue;
        }
        const data = (await res.json()) as { id?: string };
        if (!data.id) {
          result.failed.push({ plan: p.code, interval, error: "Razorpay did not return a plan id" });
          continue;
        }
        await db
          .insert(schema.platformRazorpayPlans)
          .values({ planId: p.id, interval, mode: creds.mode, razorpayPlanId: data.id, amountPaise: amount })
          .onConflictDoNothing();
        result.created++;
      } catch (err) {
        result.failed.push({ plan: p.code, interval, error: err instanceof Error ? err.message : "Could not reach Razorpay" });
      }
    }
  }

  await db.transaction((tx) =>
    writePlatformAudit(tx, staffUserId, "platform_billing.plans_synced", "platform_billing", "default", null, { mode: creds.mode, created: result.created, unchanged: result.unchanged, failed: result.failed.length }, meta),
  );
  return result;
}
