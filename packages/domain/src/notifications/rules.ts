import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { getNotificationEvent, type NotificationChannel, type NotificationEventDef } from "./catalog.ts";

/**
 * Which channels are on for an event (docs/NOTIFICATION-MANAGER-PLAN.md section 5). Order of precedence:
 * the catalog default, then Super Admin's rule, then the store's own switch. Locked events ignore the store switch, and
 * a channel the catalog does not offer is never on.
 */

export interface PlatformRuleRow {
  enabled: boolean;
  roleRecipients: string[];
  extraEmails: string[];
}

export interface TenantRuleRow {
  enabled: boolean;
  extraEmails: string[];
}

export function channelEnabled(
  def: NotificationEventDef,
  channel: NotificationChannel,
  platformRule?: Pick<PlatformRuleRow, "enabled"> | undefined,
  tenantRule?: Pick<TenantRuleRow, "enabled"> | undefined,
): boolean {
  if (!(channel in def.channels)) return false;
  const base = platformRule ? platformRule.enabled : def.channels[channel] === true;
  if (!base) return false;
  if (def.locked || def.audience === "platform") return true;
  return tenantRule ? tenantRule.enabled : true;
}

export async function loadPlatformRule(db: Db, eventKey: string, channel: NotificationChannel): Promise<PlatformRuleRow | undefined> {
  const [row] = await db
    .select({ enabled: schema.notificationRules.enabled, roleRecipients: schema.notificationRules.roleRecipients, extraEmails: schema.notificationRules.extraEmails })
    .from(schema.notificationRules)
    .where(and(eq(schema.notificationRules.eventKey, eventKey), eq(schema.notificationRules.channel, channel)))
    .limit(1);
  return row;
}

export async function loadTenantRule(tx: Db, tenantId: string, eventKey: string, channel: NotificationChannel): Promise<TenantRuleRow | undefined> {
  const [row] = await tx
    .select({ enabled: schema.notificationTenantRules.enabled, extraEmails: schema.notificationTenantRules.extraEmails })
    .from(schema.notificationTenantRules)
    .where(and(eq(schema.notificationTenantRules.tenantId, tenantId), eq(schema.notificationTenantRules.eventKey, eventKey), eq(schema.notificationTenantRules.channel, channel)))
    .limit(1);
  return row;
}

/**
 * The gate the transactional sender calls for customer emails. Runs inside the tenant transaction. Events not in the
 * catalog are left alone (returns true) so unknown templates keep working.
 */
export async function isEmailEventEnabled(tx: Db, tenantId: string, template: string): Promise<boolean> {
  const def = getNotificationEvent(template);
  if (!def) return true;
  const platformRule = await loadPlatformRule(tx, def.key, "email");
  const tenantRule = await loadTenantRule(tx, tenantId, def.key, "email");
  return channelEnabled(def, "email", platformRule, tenantRule);
}
