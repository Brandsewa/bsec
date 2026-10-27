import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { renderEmail, type EmailBrand, type EmailOrder } from "../system/email-templates.ts";
import {
  DEFAULT_EMAIL_BRANDING,
  parseEmailBranding,
  type BrandingIssue,
  type EmailBrandingTokens,
} from "../system/email-branding.ts";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  getNotificationEvent,
  type NotificationAudience,
  type NotificationChannel,
} from "./catalog.ts";
import { channelEnabled } from "./rules.ts";
import { loadPlatformBranding } from "./branding-loader.ts";

/**
 * Notification manager services (docs/NOTIFICATION-MANAGER-PLAN.md sections 6 to 8): the Super Admin matrix and branding,
 * the store's switches, extra recipients and email branding, and both in-app inboxes. Permissions are checked here, not in
 * the routes (AGENTS.md rule 4).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EXTRA_EMAILS = 5;
export const NOTIFICATION_RETENTION_DAYS = 30;

function cleanEmails(list: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const e = raw.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error(`"${raw}" is not a valid email address`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_EXTRA_EMAILS) throw new Error(`At most ${MAX_EXTRA_EMAILS} extra email addresses per notification`);
  return out;
}

// ---- Super Admin: matrix ---------------------------------------------------------------------------------------------

export interface MatrixChannelCell {
  offered: boolean;
  enabled: boolean;
  /** SMS and WhatsApp stay "not connected" until a provider is configured. */
  connected: boolean;
}

export interface MatrixEvent {
  key: string;
  audience: NotificationAudience;
  category: string;
  label: string;
  description: string;
  locked: boolean;
  channels: Record<NotificationChannel, MatrixChannelCell>;
  roleRecipients: string[];
  extraEmails: string[];
}

export const PLATFORM_ROLE_OPTIONS = ["platform_owner", "platform_admin", "platform_support"] as const;

export async function getNotificationMatrix(rt: Runtime, staffUserId: string): Promise<{ events: MatrixEvent[]; roles: string[]; retentionDays: number }> {
  await assertPlatformStaff(rt, staffUserId);
  const rules = await rt._db.db.select().from(schema.notificationRules);
  const events = NOTIFICATION_EVENTS.map((def): MatrixEvent => {
    const channels = {} as Record<NotificationChannel, MatrixChannelCell>;
    for (const ch of NOTIFICATION_CHANNELS) {
      const rule = rules.find((r) => r.eventKey === def.key && r.channel === ch);
      const offered = ch in def.channels;
      channels[ch] = { offered, enabled: offered && (rule ? rule.enabled : def.channels[ch] === true), connected: ch === "in_app" || ch === "email" };
    }
    const emailRule = rules.find((r) => r.eventKey === def.key && r.channel === "email");
    const inAppRule = rules.find((r) => r.eventKey === def.key && r.channel === "in_app");
    const roles = [...new Set([...(emailRule?.roleRecipients ?? []), ...(inAppRule?.roleRecipients ?? [])])];
    return {
      key: def.key,
      audience: def.audience,
      category: def.category,
      label: def.label,
      description: def.description,
      locked: def.locked,
      channels,
      roleRecipients: roles.length > 0 ? roles : [...(def.defaultRoles ?? [])],
      extraEmails: emailRule?.extraEmails ?? [],
    };
  });
  return { events, roles: [...PLATFORM_ROLE_OPTIONS], retentionDays: NOTIFICATION_RETENTION_DAYS };
}

export interface UpdateRuleInput {
  eventKey: string;
  channel: NotificationChannel;
  enabled?: boolean | undefined;
  roleRecipients?: string[] | undefined;
  extraEmails?: string[] | undefined;
}

export async function updateNotificationRule(rt: Runtime, staffUserId: string, input: UpdateRuleInput, meta?: AuditMeta): Promise<void> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "changing notification rules");
  const def = getNotificationEvent(input.eventKey);
  if (!def) throw new Error("Unknown notification event");
  if (!(input.channel in def.channels)) throw new Error(`${def.label} is not offered on ${input.channel}`);
  if (def.locked && input.enabled === false && def.audience === "customer" && def.channels[input.channel] !== undefined) {
    // Security emails can be changed only by the platform owner and never switched off for email.
    if (input.channel === "email") throw new Error("Security emails cannot be switched off");
  }
  const roles = input.roleRecipients?.filter((r) => (PLATFORM_ROLE_OPTIONS as readonly string[]).includes(r));
  const extra = input.extraEmails !== undefined ? cleanEmails(input.extraEmails) : undefined;
  const db = rt._db.db;
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.notificationRules)
      .where(and(eq(schema.notificationRules.eventKey, def.key), eq(schema.notificationRules.channel, input.channel)))
      .limit(1);
    const next = {
      enabled: input.enabled ?? current?.enabled ?? def.channels[input.channel] === true,
      roleRecipients: roles ?? current?.roleRecipients ?? [],
      extraEmails: extra ?? current?.extraEmails ?? [],
    };
    await tx
      .insert(schema.notificationRules)
      .values({ eventKey: def.key, channel: input.channel, ...next, updatedBy: staffUserId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [schema.notificationRules.eventKey, schema.notificationRules.channel], set: { ...next, updatedBy: staffUserId, updatedAt: new Date() } });
    await writePlatformAudit(tx, staffUserId, "notification_rule.update", "notification_rule", `${def.key}:${input.channel}`, null, { before: current ?? null, after: next }, meta);
  });
}

// ---- Branding --------------------------------------------------------------------------------------------------------

export interface BrandingView {
  tokens: EmailBrandingTokens;
  issues: BrandingIssue[];
}

export async function getPlatformEmailBranding(rt: Runtime, staffUserId: string): Promise<BrandingView> {
  await assertPlatformStaff(rt, staffUserId);
  return { tokens: await loadPlatformBranding(rt._db.db), issues: [] };
}

export async function updatePlatformEmailBranding(rt: Runtime, staffUserId: string, raw: unknown, meta?: AuditMeta): Promise<BrandingView> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "changing platform email branding");
  const parsed = parseEmailBranding(raw, DEFAULT_EMAIL_BRANDING, { layer: "platform" });
  await rt._db.db.transaction(async (tx) => {
    const [before] = await tx.select({ tokens: schema.platformEmailBranding.tokens }).from(schema.platformEmailBranding).where(eq(schema.platformEmailBranding.id, "default")).limit(1);
    await tx
      .insert(schema.platformEmailBranding)
      .values({ id: "default", tokens: parsed.tokens as unknown as Record<string, unknown>, updatedBy: staffUserId })
      .onConflictDoUpdate({ target: schema.platformEmailBranding.id, set: { tokens: parsed.tokens as unknown as Record<string, unknown>, updatedBy: staffUserId, updatedAt: new Date() } });
    await writePlatformAudit(tx, staffUserId, "email_branding.update", "platform_email_branding", "default", null, { before: before?.tokens ?? null, after: parsed.tokens }, meta);
  });
  return parsed;
}

const SAMPLE_ORDER: EmailOrder = {
  number: "ORD-1042",
  items: [
    { title: "Hand-poured soy candle", variant: "Lavender", quantity: 2, total: 119800 },
    { title: "Linen tote bag", variant: null, quantity: 1, total: 69900 },
  ],
  subtotal: 189700,
  discountTotal: 10000,
  shippingTotal: 0,
  codFee: 0,
  grandTotal: 179700,
  paymentStatus: "paid",
  shippingAddress: { fullName: "Asha Rana", addressLine1: "12 Hill Road", city: "Dehradun", state: "Uttarakhand", pincode: "248001" },
  orderUrl: "https://example.com/orders/preview",
};

/** HTML for the live preview in both branding editors. Never sends anything. */
export function renderBrandingPreview(tokens: EmailBrandingTokens, storeName: string, kind: "customer" | "platform"): { html: string } {
  const brand: EmailBrand = { storeName, baseUrl: "https://example.com", supportEmail: "help@example.com", branding: tokens };
  if (kind === "customer") return { html: renderEmail("order_confirmation", brand, { order: SAMPLE_ORDER }, "Order ORD-1042 confirmed").html };
  return {
    html: renderEmail("notice", brand, { heading: "Payment failed for Taste of Hills", lines: ["We could not charge your plan payment. Update your payment method to keep every feature.", "Your store keeps working during the grace period."], ctaUrl: "https://example.com/billing", ctaLabel: "Open plan and billing" }, "Payment failed").html,
  };
}

export async function previewPlatformBranding(rt: Runtime, staffUserId: string, raw: unknown): Promise<{ html: string; issues: BrandingIssue[] }> {
  await assertPlatformStaff(rt, staffUserId);
  const parsed = parseEmailBranding(raw, DEFAULT_EMAIL_BRANDING, { layer: "platform" });
  return { html: renderBrandingPreview(parsed.tokens, "Brand Sewa", "platform").html, issues: parsed.issues };
}

// ---- Store admin: rules and branding ---------------------------------------------------------------------------------

export interface StoreRuleEvent {
  key: string;
  audience: "store" | "customer";
  category: string;
  label: string;
  description: string;
  locked: boolean;
  channels: Record<"in_app" | "email", { offered: boolean; enabled: boolean }>;
  extraEmails: string[];
}

export async function getStoreNotificationRules(rt: Runtime, ctx: TenantContext): Promise<{ events: StoreRuleEvent[] }> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;
  const [platformRules, tenantRules] = await Promise.all([
    db.select().from(schema.notificationRules),
    withTenant(db, ctx.tenantId, (tx) => tx.select().from(schema.notificationTenantRules).where(eq(schema.notificationTenantRules.tenantId, ctx.tenantId))),
  ]);
  const events = NOTIFICATION_EVENTS.filter((e) => e.audience !== "platform").map((def): StoreRuleEvent => {
    const cell = (ch: "in_app" | "email") => {
      const pr = platformRules.find((r) => r.eventKey === def.key && r.channel === ch);
      const tr = tenantRules.find((r) => r.eventKey === def.key && r.channel === ch);
      return { offered: ch in def.channels, enabled: channelEnabled(def, ch, pr, tr) };
    };
    const emailRule = tenantRules.find((r) => r.eventKey === def.key && r.channel === "email");
    return {
      key: def.key,
      audience: def.audience as "store" | "customer",
      category: def.category,
      label: def.label,
      description: def.description,
      locked: def.locked,
      channels: { in_app: cell("in_app"), email: cell("email") },
      extraEmails: emailRule?.extraEmails ?? [],
    };
  });
  return { events };
}

export async function updateStoreNotificationRule(
  rt: Runtime,
  ctx: TenantContext,
  input: { eventKey: string; channel: "in_app" | "email"; enabled?: boolean | undefined; extraEmails?: string[] | undefined },
): Promise<{ ok: true }> {
  assertPermission(ctx, "notifications.manage");
  const def = getNotificationEvent(input.eventKey);
  if (!def || def.audience === "platform") throw new Error("Unknown notification event");
  if (!(input.channel in def.channels)) throw new Error(`${def.label} is not offered on ${input.channel}`);
  if (def.locked && input.enabled === false) throw new Error(`${def.label} is required and cannot be switched off`);
  if (input.extraEmails !== undefined && def.audience !== "store") throw new Error("Extra recipients apply to notifications for your team, not to customer emails");
  const extra = input.extraEmails !== undefined ? cleanEmails(input.extraEmails) : undefined;
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.notificationTenantRules)
      .where(and(eq(schema.notificationTenantRules.tenantId, ctx.tenantId), eq(schema.notificationTenantRules.eventKey, def.key), eq(schema.notificationTenantRules.channel, input.channel)))
      .limit(1);
    const next = { enabled: input.enabled ?? current?.enabled ?? true, extraEmails: extra ?? current?.extraEmails ?? [] };
    await tx
      .insert(schema.notificationTenantRules)
      .values({ tenantId: ctx.tenantId, eventKey: def.key, channel: input.channel, ...next })
      .onConflictDoUpdate({ target: [schema.notificationTenantRules.tenantId, schema.notificationTenantRules.eventKey, schema.notificationTenantRules.channel], set: { ...next, updatedAt: new Date() } });
    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({ tenantId: ctx.tenantId, actorType: "staff", actorId: ctx.actor.userId, action: "settings.notification_rule_updated", targetType: "notification_rule", targetId: `${def.key}:${input.channel}`, diff: { before: current ?? null, after: next } });
    }
  });
  return { ok: true };
}

export async function getStoreEmailBranding(rt: Runtime, ctx: TenantContext): Promise<BrandingView & { platform: EmailBrandingTokens }> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;
  const platform = await loadPlatformBranding(db);
  const [row] = await withTenant(db, ctx.tenantId, (tx) => tx.select({ tokens: schema.storeEmailBranding.tokens }).from(schema.storeEmailBranding).where(eq(schema.storeEmailBranding.tenantId, ctx.tenantId)).limit(1));
  return { tokens: parseEmailBranding(row?.tokens, platform, { layer: "store", platform }).tokens, issues: [], platform };
}

export async function updateStoreEmailBranding(rt: Runtime, ctx: TenantContext, raw: unknown): Promise<BrandingView> {
  assertPermission(ctx, "notifications.manage");
  const db = rt._db.db;
  const platform = await loadPlatformBranding(db);
  const parsed = parseEmailBranding(raw, platform, { layer: "store", platform });
  await withTenant(db, ctx.tenantId, async (tx) => {
    const [before] = await tx.select({ tokens: schema.storeEmailBranding.tokens }).from(schema.storeEmailBranding).where(eq(schema.storeEmailBranding.tenantId, ctx.tenantId)).limit(1);
    // Only the store's own tokens are saved: fonts always come from the platform.
    await tx
      .insert(schema.storeEmailBranding)
      .values({ tenantId: ctx.tenantId, tokens: parsed.tokens as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: schema.storeEmailBranding.tenantId, set: { tokens: parsed.tokens as unknown as Record<string, unknown>, updatedAt: new Date() } });
    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({ tenantId: ctx.tenantId, actorType: "staff", actorId: ctx.actor.userId, action: "settings.email_branding_updated", targetType: "email_branding", targetId: ctx.tenantId, diff: { before: before?.tokens ?? null, after: parsed.tokens } });
    }
  });
  return parsed;
}

export async function previewStoreEmailBranding(rt: Runtime, ctx: TenantContext, raw: unknown): Promise<{ html: string; issues: BrandingIssue[] }> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;
  const platform = await loadPlatformBranding(db);
  const parsed = parseEmailBranding(raw, platform, { layer: "store", platform });
  const [s] = await withTenant(db, ctx.tenantId, (tx) => tx.select({ storeName: schema.storeSettings.storeName }).from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, ctx.tenantId)).limit(1));
  return { html: renderBrandingPreview(parsed.tokens, s?.storeName || "Your store", "customer").html, issues: parsed.issues };
}

// ---- In-app inbox ----------------------------------------------------------------------------------------------------

export interface InboxItem {
  id: string;
  eventKey: string;
  tab: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface InboxView {
  items: InboxItem[];
  /** Unread rows per tab, and in total. */
  unread: Record<string, number>;
  unreadTotal: number;
}

function inboxView(rows: Array<{ id: string; eventKey: string; tab: string; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date }>): InboxView {
  const unread: Record<string, number> = {};
  for (const r of rows) if (!r.readAt) unread[r.tab] = (unread[r.tab] ?? 0) + 1;
  return {
    items: rows.map((r) => ({ id: r.id, eventKey: r.eventKey, tab: r.tab, title: r.title, body: r.body, link: r.link, read: Boolean(r.readAt), createdAt: r.createdAt.toISOString() })),
    unread,
    unreadTotal: Object.values(unread).reduce((a, b) => a + b, 0),
  };
}

function staffUserId(ctx: TenantContext): string {
  if (ctx.actor?.type !== "staff") throw new Error("Notifications belong to signed-in store users");
  return ctx.actor.userId;
}

// The drawer is the store team's order and billing feed, so it needs the order-read permission (a limited role with
// no order access gets no bell). Own-row filtering below keeps one user from ever seeing another's cards.
export async function listStoreInbox(rt: Runtime, ctx: TenantContext, limit = 50): Promise<InboxView> {
  assertPermission(ctx, "orders.read");
  const userId = staffUserId(ctx);
  const rows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, ctx.tenantId), eq(schema.notifications.userId, userId), isNull(schema.notifications.archivedAt)))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100)),
  );
  return inboxView(rows);
}

export async function markStoreInbox(rt: Runtime, ctx: TenantContext, input: { ids?: string[] | undefined; all?: boolean | undefined; clear?: boolean | undefined }): Promise<{ ok: true }> {
  assertPermission(ctx, "orders.read");
  const userId = staffUserId(ctx);
  const now = new Date();
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const scope = and(eq(schema.notifications.tenantId, ctx.tenantId), eq(schema.notifications.userId, userId), isNull(schema.notifications.archivedAt), input.all ? undefined : inArray(schema.notifications.id, input.ids ?? []));
    await tx.update(schema.notifications).set(input.clear ? { archivedAt: now, readAt: now } : { readAt: now }).where(scope);
  });
  return { ok: true };
}

/** The Activity tab: what the store's staff changed, from the audit log. Read-only. */
export async function listStoreActivity(rt: Runtime, ctx: TenantContext, limit = 50): Promise<Array<{ id: string; action: string; target: string; actorId: string | null; createdAt: string }>> {
  assertPermission(ctx, "settings.read");
  const rows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx.select({ id: schema.auditLogs.id, action: schema.auditLogs.action, targetType: schema.auditLogs.targetType, targetId: schema.auditLogs.targetId, actorId: schema.auditLogs.actorId, createdAt: schema.auditLogs.createdAt }).from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, ctx.tenantId)).orderBy(desc(schema.auditLogs.createdAt)).limit(Math.min(Math.max(limit, 1), 100)),
  );
  return rows.map((r) => ({ id: r.id, action: r.action, target: `${r.targetType} ${r.targetId}`.slice(0, 120), actorId: r.actorId, createdAt: r.createdAt.toISOString() }));
}

export async function listPlatformInbox(rt: Runtime, staffUserId_: string, limit = 50): Promise<InboxView> {
  await assertPlatformStaff(rt, staffUserId_);
  const rows = await rt._db.db
    .select()
    .from(schema.platformNotifications)
    .where(and(eq(schema.platformNotifications.userId, staffUserId_), isNull(schema.platformNotifications.archivedAt)))
    .orderBy(desc(schema.platformNotifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return inboxView(rows);
}

export async function markPlatformInbox(rt: Runtime, staffUserId_: string, input: { ids?: string[] | undefined; all?: boolean | undefined; clear?: boolean | undefined }): Promise<void> {
  await assertPlatformStaff(rt, staffUserId_);
  const now = new Date();
  const scope = and(eq(schema.platformNotifications.userId, staffUserId_), isNull(schema.platformNotifications.archivedAt), input.all ? undefined : inArray(schema.platformNotifications.id, input.ids ?? []));
  await rt._db.db.update(schema.platformNotifications).set(input.clear ? { archivedAt: now, readAt: now } : { readAt: now }).where(scope);
}

/** Deletes inbox rows older than the retention window (30 days by default). Run daily by notification.retention_sweep. */
export async function pruneNotifications(db: Db, days: number = NOTIFICATION_RETENTION_DAYS): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.floor(days)) * 86_400_000);
  const platform = await db.delete(schema.platformNotifications).where(lt(schema.platformNotifications.createdAt, cutoff)).returning({ id: schema.platformNotifications.id });
  let deleted = platform.length;
  const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  for (const t of tenants) {
    const rows = await withTenant(db, t.id, (tx) => tx.delete(schema.notifications).where(and(eq(schema.notifications.tenantId, t.id), lt(schema.notifications.createdAt, cutoff))).returning({ id: schema.notifications.id }));
    deleted += rows.length;
  }
  return { deletedCount: deleted };
}
