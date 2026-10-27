import { and, eq, isNotNull, lt } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { escapeHtml } from "../system/email-templates.ts";
import { dispatchNotification } from "../notifications/dispatcher.ts";
import { LAPSED_TRIAL_TIER } from "./plan-tiers.ts";

/**
 * Dunning for paid subscriptions (billing B5). When a charge fails the webhook marks the subscription past due and stamps
 * `past_due_since`. This sweep then, once per store: sends a failure notice, a reminder in the last two days of the grace
 * period, and finally limits the store (restricted tier; the storefront and checkout keep working, as for a lapsed trial).
 * The next successful charge clears the state and restores the plan's tier (webhook). The grace length is Super Admin,
 * Platform billing, "Grace period".
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = 2;

export type DunningKind = "failed" | "reminder" | "limited";

export interface DunningSweepResult {
  notified: number;
  reminded: number;
  limited: number;
}

export interface DunningEmailInput {
  storeName: string;
  limitDate: Date;
  billingUrl: string;
}

export function renderDunningEmail(kind: DunningKind, d: DunningEmailInput): { subject: string; lines: string[]; html: string; text: string } {
  const date = d.limitDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const copy: Record<DunningKind, { subject: string; lines: string[] }> = {
    failed: {
      subject: `Payment failed for ${d.storeName}`,
      lines: [
        `We could not charge your plan payment for ${d.storeName}. Razorpay will retry automatically.`,
        `To keep every feature, make sure your card or UPI AutoPay mandate is valid and has funds. If it is still unpaid on ${date}, your store moves to the restricted plan (the storefront and checkout keep working).`,
      ],
    },
    reminder: {
      subject: `Action needed: ${d.storeName} will be limited on ${date}`,
      lines: [
        `Your plan payment for ${d.storeName} is still unpaid.`,
        `On ${date} the store moves to the restricted plan. Update your payment method now to avoid it.`,
      ],
    },
    limited: {
      subject: `${d.storeName} has moved to the restricted plan`,
      lines: [
        `Your plan payment for ${d.storeName} was not received, so the store now has restricted limits. Your storefront and checkout keep working and your data is safe.`,
        `Pay from your billing page and your plan is restored right away.`,
      ],
    },
  };
  const c = copy[kind];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;line-height:1.5;color:#16201b">${c.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(d.billingUrl)}" style="display:inline-block;background:#0b6b42;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open plan and billing</a></p><p style="color:#667;font-size:12px">Brand Sewa</p></div>`;
  const text = `${c.lines.join("\n\n")}\n\nPlan and billing: ${d.billingUrl}`;
  return { subject: c.subject, lines: c.lines, html, text };
}

function billingUrl(): string {
  const root = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
  const local = root.includes("localhost") || root.includes("127.0.0.1");
  const host = process.env.ADMIN_HOST?.trim() || (local ? "localhost:5173" : `admin.${root}`);
  return `${local ? "http" : "https"}://${host}/settings/plan-and-billing`;
}

async function notify(db: Db, tenantId: string, kind: DunningKind, limitDate: Date): Promise<"sent" | "skipped" | "failed"> {
  const [settings] = await db.select({ storeName: schema.storeSettings.storeName }).from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, tenantId)).limit(1);
  const mail = renderDunningEmail(kind, { storeName: settings?.storeName ?? "your store", limitDate, billingUrl: billingUrl() });
  try {
    // Through the notification manager: in-app card for the owner plus the email in the BCom brand. One notice per kind
    // and limit date, so a re-run of the sweep sends nothing twice.
    const res = await dispatchNotification(db, {
      eventKey: `billing_${kind}`,
      tenantId,
      eventRef: `billing_${kind}_${tenantId}_${limitDate.toISOString().slice(0, 10)}`,
      title: mail.subject,
      body: mail.lines[0] ?? "",
      emailSubject: mail.subject,
      emailLines: mail.lines,
      link: "/settings/plan-and-billing",
      ctaLabel: "Open plan and billing",
    });
    if (kind === "failed") {
      await dispatchNotification(db, { eventKey: "platform_billing_failed", tenantId, eventRef: `platform_billing_failed_${tenantId}_${limitDate.toISOString().slice(0, 10)}`, title: `Plan payment failed: ${settings?.storeName ?? tenantId}`, body: mail.lines[0] ?? "", link: `/tenants/${tenantId}` }).catch(() => undefined);
    }
    return res.emailed + res.inApp > 0 ? "sent" : "skipped";
  } catch {
    return "failed";
  }
}

export async function runBillingDunningSweep(rt: Runtime, now: Date = new Date(), limit = 200): Promise<DunningSweepResult> {
  const db = rt._db.db;
  const [settings] = await db.select({ graceDays: schema.platformBillingSettings.graceDays }).from(schema.platformBillingSettings).where(eq(schema.platformBillingSettings.id, "default")).limit(1);
  const graceDays = settings?.graceDays ?? 7;

  const subs = await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.status, "past_due"), isNotNull(schema.subscriptions.pastDueSince), isNotNull(schema.subscriptions.providerSubscriptionId), lt(schema.subscriptions.dunningStage, 3)))
    .limit(limit);

  const result: DunningSweepResult = { notified: 0, reminded: 0, limited: 0 };
  for (const sub of subs) {
    const since = sub.pastDueSince;
    if (!since) continue; // the query only returns stamped rows; this narrows the type
    const limitAt = new Date(since.getTime() + graceDays * DAY_MS);

    if (now >= limitAt) {
      // Limit first; the email afterwards is best effort and never blocks the limit.
      const moved = await db.transaction(async (tx) => {
        const upd = await tx
          .update(schema.subscriptions)
          .set({ dunningStage: 3, updatedAt: now })
          .where(and(eq(schema.subscriptions.id, sub.id), lt(schema.subscriptions.dunningStage, 3), eq(schema.subscriptions.status, "past_due")))
          .returning({ id: schema.subscriptions.id });
        if (upd.length === 0) return false;
        await tx
          .insert(schema.tenantSizeTiers)
          .values({ tenantId: sub.tenantId, tier: LAPSED_TRIAL_TIER })
          .onConflictDoUpdate({ target: schema.tenantSizeTiers.tenantId, set: { tier: LAPSED_TRIAL_TIER, updatedAt: now } });
        await tx.insert(schema.platformAuditLogs).values({
          actorType: "system",
          action: "billing.store_limited",
          targetType: "tenant",
          targetId: sub.tenantId,
          tenantId: sub.tenantId,
          diff: { subscriptionId: sub.id, pastDueSince: since.toISOString(), graceDays },
        });
        return true;
      });
      if (moved) {
        result.limited += 1;
        await notify(db, sub.tenantId, "limited", limitAt).catch(() => undefined);
      }
      continue;
    }

    const reminderDue = graceDays >= 3 && now.getTime() >= limitAt.getTime() - REMINDER_DAYS_BEFORE * DAY_MS;
    const nextStage = reminderDue && sub.dunningStage < 2 ? 2 : sub.dunningStage < 1 ? 1 : 0;
    if (nextStage === 0) continue;

    const status = await notify(db, sub.tenantId, nextStage === 2 ? "reminder" : "failed", limitAt).catch(() => "failed" as const);
    if (status === "failed") continue; // try again on the next sweep
    const upd = await db
      .update(schema.subscriptions)
      .set({ dunningStage: nextStage, updatedAt: now })
      .where(and(eq(schema.subscriptions.id, sub.id), lt(schema.subscriptions.dunningStage, nextStage)))
      .returning({ id: schema.subscriptions.id });
    if (upd.length > 0) {
      if (nextStage === 2) result.reminded += 1;
      else result.notified += 1;
    }
  }
  return result;
}
