import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { sendPlatformEmail } from "../system/platform-mailer.ts";
import { renderEmail, type EmailBrand } from "../system/email-templates.ts";
import { loadPlatformBranding } from "./branding-loader.ts";
import { loadSmsAdapter } from "./sms.ts";
import { getNotificationEvent, type NotificationChannel, type NotificationEventDef } from "./catalog.ts";
import { channelEnabled, loadPlatformRule, loadTenantRule } from "./rules.ts";

/**
 * The notification dispatcher (docs/NOTIFICATION-MANAGER-PLAN.md section 5, ADR-039). Callers enqueue a
 * `notification.dispatch` job from their business transaction (ADR-006); the worker calls dispatchNotification, which
 * resolves the rules and recipients and fans out to the in-app, email and SMS adapters. Customer-facing emails keep
 * their own sender (sendTransactionalEmail, which consults the same rules); this handles store and platform events.
 */

export interface NotifyInput {
  eventKey: string;
  /** Required for store events; also the store a platform event is about (shown to staff, never used for access). */
  tenantId?: string | undefined;
  /** Stable id of the thing that happened (for example order_<id>); makes a retried job a no-op. */
  eventRef: string;
  title: string;
  body?: string | undefined;
  /** App-relative path the in-app card opens, such as /orders/<id>. */
  link?: string | undefined;
  /** Extra addresses that were already configured outside the catalog (the older per-store staff list). */
  legacyExtraEmails?: string[] | undefined;
  /** Email wording; defaults to title and body. */
  emailSubject?: string | undefined;
  emailLines?: string[] | undefined;
  ctaLabel?: string | undefined;
}

export interface DispatchResult {
  inApp: number;
  emailed: number;
  skipped: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminBase(): string {
  const root = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
  const local = root.includes("localhost") || root.includes("127.0.0.1");
  const host = process.env.ADMIN_HOST?.trim() || (local ? "localhost:5173" : `admin.${root}`);
  return `${local ? "http" : "https"}://${host}`;
}

function superadminBase(): string {
  const root = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
  const local = root.includes("localhost") || root.includes("127.0.0.1");
  const first = process.env.SUPERADMIN_ORIGINS?.split(",")[0]?.trim();
  return first || (local ? "http://localhost:5174" : `https://superadmin.${root}`);
}

async function platformBrand(db: Db, baseUrl: string): Promise<EmailBrand> {
  const [settings] = await db.select({ fromName: schema.platformEmailSettings.fromName }).from(schema.platformEmailSettings).limit(1);
  return { storeName: settings?.fromName || "Brand Sewa", baseUrl, branding: await loadPlatformBranding(db) };
}

function unique(list: string[]): string[] {
  return [...new Set(list.map((a) => a.trim().toLowerCase()).filter((a) => EMAIL.test(a)))];
}

interface Recipient {
  userId?: string | undefined;
  email?: string | undefined;
}

async function storeRecipients(db: Db, tenantId: string, def: NotificationEventDef): Promise<Recipient[]> {
  const roles = [...(def.storeRoles ?? ["store_owner"])];
  return await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({ userId: schema.memberships.userId, email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.roles, and(eq(schema.roles.tenantId, schema.memberships.tenantId), eq(schema.roles.id, schema.memberships.roleId)))
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, "active"), inArray(schema.roles.name, roles)));
    return rows.map((r) => ({ userId: r.userId, email: String(r.email) }));
  });
}

async function platformRecipients(db: Db, roles: readonly string[]): Promise<Recipient[]> {
  const res = await db.execute<{ user_id: string; email: string }>(sql`select user_id, email from notification_platform_recipients(${sql.raw(`ARRAY[${roles.map((r) => `'${r.replaceAll("'", "''")}'`).join(",")}]::text[]`)})`);
  return res.rows.map((r) => ({ userId: r.user_id, email: r.email }));
}

export async function dispatchNotification(db: Db, input: NotifyInput): Promise<DispatchResult> {
  const result: DispatchResult = { inApp: 0, emailed: 0, skipped: [] };
  const def = getNotificationEvent(input.eventKey);
  if (!def || def.audience === "customer") {
    result.skipped.push("unknown_or_customer_event");
    return result;
  }
  const tenantId = input.tenantId;
  if (def.audience === "store" && !tenantId) throw new Error(`${def.key} needs a tenantId`);
  const storeTenantId = tenantId as string; // set for store events (checked above)

  const enabled = async (channel: NotificationChannel): Promise<boolean> => {
    const platformRule = await loadPlatformRule(db, def.key, channel);
    const tenantRule = def.audience === "store" && tenantId ? await withTenant(db, tenantId, (tx) => loadTenantRule(tx, tenantId, def.key, channel)) : undefined;
    return channelEnabled(def, channel, platformRule, tenantRule);
  };
  const [inAppOn, emailOn, smsOn] = [await enabled("in_app"), await enabled("email"), await enabled("sms")];

  // Recipients: the people the catalog or the Super Admin rule names, plus the extra addresses that were configured.
  let people: Recipient[];
  let extra: string[] = [...(input.legacyExtraEmails ?? [])];
  if (def.audience === "store") {
    people = await storeRecipients(db, storeTenantId, def);
    const rule = emailOn ? await withTenant(db, storeTenantId, (tx) => loadTenantRule(tx, storeTenantId, def.key, "email")) : undefined;
    extra = [...extra, ...(rule?.extraEmails ?? [])];
  } else {
    const rule = await loadPlatformRule(db, def.key, "email");
    const inAppRule = await loadPlatformRule(db, def.key, "in_app");
    const roles = [...new Set([...(rule?.roleRecipients ?? []), ...(inAppRule?.roleRecipients ?? [])])];
    people = await platformRecipients(db, roles.length > 0 ? roles : (def.defaultRoles ?? ["platform_owner"]));
    extra = [...extra, ...(rule?.extraEmails ?? [])];
  }

  // In-app inbox rows. The unique (user, event_ref) key makes a retried job add nothing.
  if (inAppOn && def.tab) {
    for (const p of people) {
      const userId = p.userId;
      if (!userId) continue;
      if (def.audience === "store") {
        const inserted = await withTenant(db, storeTenantId, (tx) =>
          tx
            .insert(schema.notifications)
            .values({ tenantId: storeTenantId, userId, eventKey: def.key, tab: def.tab as "orders" | "system", title: input.title, body: input.body ?? "", link: input.link ?? null, eventRef: input.eventRef })
            .onConflictDoNothing()
            .returning({ id: schema.notifications.id }),
        );
        result.inApp += inserted.length;
      } else {
        const inserted = await db
          .insert(schema.platformNotifications)
          .values({ userId, eventKey: def.key, tab: def.tab as "stores" | "billing" | "system", title: input.title, body: input.body ?? "", link: input.link ?? null, eventRef: input.eventRef })
          .onConflictDoNothing()
          .returning({ id: schema.platformNotifications.id });
        result.inApp += inserted.length;
      }
    }
  } else if (!inAppOn) result.skipped.push("in_app_off");

  // Email through the platform mailer, in the BCom brand.
  if (emailOn) {
    const addresses = unique([...people.map((p) => p.email ?? ""), ...extra]);
    const base = def.audience === "store" ? adminBase() : superadminBase();
    const brand = await platformBrand(db, base);
    const subject = input.emailSubject ?? input.title;
    const lines = input.emailLines ?? (input.body ? [input.body] : []);
    const ctaUrl = input.link ? `${base}${input.link}` : "";
    for (const to of addresses) {
      const ref = `${input.eventRef}:${to}`;
      if (tenantId) {
        const [done] = await withTenant(db, tenantId, (tx) =>
          tx.select({ id: schema.emailLog.id }).from(schema.emailLog).where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.eventRef, ref), eq(schema.emailLog.status, "sent"))).limit(1),
        );
        if (done) continue;
      }
      const rendered = renderEmail("notice", brand, { heading: input.title, lines, ctaUrl, ctaLabel: input.ctaLabel ?? "Open" }, subject);
      const sent = await sendPlatformEmail(db, { tenantId, to, template: def.key, subject, html: rendered.html, text: rendered.text }, { bypassRateLimit: true });
      if (tenantId) {
        await withTenant(db, tenantId, (tx) =>
          tx.insert(schema.emailLog).values({
            tenantId,
            template: def.key,
            toEmail: to,
            subject,
            status: sent.status === "sent" ? "sent" : sent.status === "skipped" ? "skipped" : "failed",
            eventRef: ref,
            eventKey: def.key,
            channel: "email",
            error: sent.error ?? null,
            sentAt: sent.status === "sent" ? new Date() : null,
          }),
        );
      }
      if (sent.status === "sent") result.emailed += 1;
      else if (sent.status === "failed" && !String(sent.error ?? "").includes("not configured") && !String(sent.error ?? "").includes("disabled")) {
        throw new Error(`Notification email [${def.key}] failed: ${sent.error}`);
      }
    }
  }

  // SMS and WhatsApp: the adapter refuses until a provider is connected and the event has an approved template.
  if (smsOn) {
    const adapter = await loadSmsAdapter(db);
    const out = await adapter.send({ eventKey: def.key, tenantId: tenantId ?? null, to: [], variables: { title: input.title } });
    if (out.status !== "sent") result.skipped.push(`sms_${out.status}`);
  }
  return result;
}
