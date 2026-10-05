import { eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import {
  parseNotificationPreferences,
  type NotificationPreferencesV1,
} from "../system/email-classes.ts";

export { parseNotificationPreferences, type NotificationPreferencesV1 } from "../system/email-classes.ts";

export interface UpdateNotificationSettingsInput {
  sender?: {
    displayName?: string | undefined;
    replyToEmail?: string | undefined;
  } | undefined;
  customer?: {
    orderConfirmation?: boolean | undefined;
    shipment?: boolean | undefined;
    delivery?: boolean | undefined;
    cancellation?: boolean | undefined;
    refund?: boolean | undefined;
    returnUpdates?: boolean | undefined;
    preorderReminders?: boolean | undefined;
  } | undefined;
  staff?: {
    newOrder?: {
      enabled?: boolean | undefined;
      recipients?: string[] | undefined;
    } | undefined;
  } | undefined;
  footerNote?: string | undefined;
}

export interface EmailLogEntry {
  id: string;
  template: string;
  toEmailMasked: string;
  subject: string;
  status: string;
  channel: string;
  eventKey: string | null;
  suppressedReason: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface NotificationSettingsView {
  preferences: NotificationPreferencesV1;
  platformMailerConfigured: boolean;
  recentDeliveries: EmailLogEntry[];
}

function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***";
  const [local, domain] = parts;
  if (!local || !domain) return "***";
  const first = local[0] ?? "";
  return `${first}***@${domain}`;
}

/**
 * Reads notification preferences directly from tx inside withTenant.
 */
export async function readNotificationPreferences(tx: Db, tenantId: string): Promise<NotificationPreferencesV1> {
  const [row] = await tx
    .select({ notifications: schema.storeSettings.notifications })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.tenantId, tenantId))
    .limit(1);

  return parseNotificationPreferences(row?.notifications);
}

/**
 * Gets notification settings, platform mailer status, and recent delivery history.
 * Enforces notifications.manage in route and service (or settings.read for read-only view).
 */
export async function getNotificationSettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<NotificationSettingsView> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const preferences = await readNotificationPreferences(tx, ctx.tenantId);

    // Check platform mailer configured status
    const [platformRow] = await tx
      .select({
        enabled: schema.platformEmailSettings.enabled,
        host: schema.platformEmailSettings.host,
        passwordCiphertext: schema.platformEmailSettings.passwordCiphertext,
      })
      .from(schema.platformEmailSettings)
      .limit(1);

    const platformMailerConfigured = Boolean(
      platformRow?.enabled && platformRow?.host && platformRow?.passwordCiphertext,
    );

    // Fetch last 100 delivery history logs
    const logs = await tx
      .select()
      .from(schema.emailLog)
      .where(eq(schema.emailLog.tenantId, ctx.tenantId))
      .orderBy(schema.emailLog.createdAt)
      .limit(100);

    const recentDeliveries: EmailLogEntry[] = logs.map((l) => ({
      id: l.id,
      template: l.template,
      toEmailMasked: maskEmail(l.toEmail),
      subject: l.subject,
      status: l.status,
      channel: l.channel ?? "email",
      eventKey: l.eventKey ?? null,
      suppressedReason: l.suppressedReason ?? null,
      createdAt: l.createdAt.toISOString(),
      sentAt: l.sentAt ? l.sentAt.toISOString() : null,
    }));

    return {
      preferences,
      platformMailerConfigured,
      recentDeliveries,
    };
  });
}

/**
 * Updates notification preferences (v1).
 * Enforces notifications.manage permission and writes audit_logs.
 */
export async function updateNotificationSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateNotificationSettingsInput,
): Promise<NotificationPreferencesV1> {
  assertPermission(ctx, "notifications.manage");
  const db = rt._db.db;

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    const current = await readNotificationPreferences(tx, ctx.tenantId);

    // Merge updates
    const merged = {
      v: 1 as const,
      sender: {
        displayName: input.sender?.displayName !== undefined ? input.sender.displayName : current.sender.displayName,
        replyToEmail: input.sender?.replyToEmail !== undefined ? input.sender.replyToEmail : current.sender.replyToEmail,
      },
      customer: {
        orderConfirmation: input.customer?.orderConfirmation !== undefined ? input.customer.orderConfirmation : current.customer.orderConfirmation,
        shipment: input.customer?.shipment !== undefined ? input.customer.shipment : current.customer.shipment,
        delivery: input.customer?.delivery !== undefined ? input.customer.delivery : current.customer.delivery,
        cancellation: input.customer?.cancellation !== undefined ? input.customer.cancellation : current.customer.cancellation,
        refund: input.customer?.refund !== undefined ? input.customer.refund : current.customer.refund,
        returnUpdates: input.customer?.returnUpdates !== undefined ? input.customer.returnUpdates : current.customer.returnUpdates,
        preorderReminders: input.customer?.preorderReminders !== undefined ? input.customer.preorderReminders : current.customer.preorderReminders,
        accountSecurity: true as const, // locked on
      },
      staff: {
        newOrder: {
          enabled: input.staff?.newOrder?.enabled !== undefined ? input.staff.newOrder.enabled : current.staff.newOrder.enabled,
          recipients: input.staff?.newOrder?.recipients !== undefined ? input.staff.newOrder.recipients : current.staff.newOrder.recipients,
        },
      },
      footerNote: input.footerNote !== undefined ? input.footerNote : current.footerNote,
      channels: {
        email: true as const,
      },
    };

    const parsed = parseNotificationPreferences(merged);

    await tx
      .update(schema.storeSettings)
      .set({
        notifications: parsed as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId));

    // Audit log (Rule 6)
    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "settings.notifications_updated",
        targetType: "settings",
        targetId: ctx.tenantId,
        diff: {
          before: current,
          after: parsed,
        },
      });
    }

    return parsed;
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}
