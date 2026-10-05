import { schema, withTenant } from "@bs/db";
import type { SettingsUpdateView } from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { FeatureDisabledError, isFeatureEnabled } from "../features.ts";

/** The flag that opens the offer for a store. Off by default (migration 0041). */
export const SETTINGS_UPDATE_OFFER_FLAG = "settings.update_offer";

/** What "Update now" turns on, in the words a merchant sees. One bundle, all or nothing. */
export const SETTINGS_UPDATE_FEATURES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "settings.gst_v2", label: "GST breakdown on orders and credit notes for refunds" },
  { key: "settings.policies", label: "Your own published policies on the storefront" },
  { key: "settings.customer_accounts", label: "Sign-in method controls for customer accounts" },
  { key: "settings.notifications", label: "Email notification preferences and marketing consent rules" },
  { key: "settings.storage", label: "Storage usage page" },
  { key: "settings.maintenance", label: "Scheduled maintenance windows" },
];

async function view(rt: Runtime, ctx: TenantContext): Promise<SettingsUpdateView> {
  const db = rt._db.db;
  const offered = await isFeatureEnabled(db, ctx.tenantId, SETTINGS_UPDATE_OFFER_FLAG);
  const pending: Array<{ key: string; label: string }> = [];
  for (const f of SETTINGS_UPDATE_FEATURES) {
    if (!(await isFeatureEnabled(db, ctx.tenantId, f.key))) pending.push({ key: f.key, label: f.label });
  }
  const isOwner = ctx.roles.includes("store_owner") && ctx.actor.type === "staff";
  const available = offered && pending.length > 0;
  // Everyone may ask (settings.read) but only the owner is told there is something to apply.
  return { available: available && isOwner, canApply: available && isOwner, features: available && isOwner ? pending : [] };
}

/** Whether the store owner is being offered the Settings update, and what it would turn on. */
export async function getSettingsUpdate(rt: Runtime, ctx: TenantContext): Promise<SettingsUpdateView> {
  assertPermission(ctx, "settings.read");
  return view(rt, ctx);
}

/**
 * Owner-only: turns the new Settings features on for this store only (tenant overrides), and audits it.
 * Refused while the platform has not opened the offer, so the call cannot be used to pre-empt the rollout.
 */
export async function applySettingsUpdate(rt: Runtime, ctx: TenantContext): Promise<SettingsUpdateView> {
  assertPermission(ctx, "settings.manage");
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error("Forbidden: only the store owner can apply a settings update");
  }
  const db = rt._db.db;
  if (!(await isFeatureEnabled(db, ctx.tenantId, SETTINGS_UPDATE_OFFER_FLAG))) {
    throw new FeatureDisabledError(SETTINGS_UPDATE_OFFER_FLAG, "No settings update is available for this store yet");
  }
  const pending: string[] = [];
  for (const f of SETTINGS_UPDATE_FEATURES) {
    if (!(await isFeatureEnabled(db, ctx.tenantId, f.key))) pending.push(f.key);
  }
  if (pending.length > 0) {
    await withTenant(db, ctx.tenantId, async (tx) => {
      for (const key of pending) {
        await tx
          .insert(schema.tenantFeatureOverrides)
          .values({ tenantId: ctx.tenantId, key, enabled: true, setBy: ctx.actor.type === "staff" ? ctx.actor.userId : null, reason: "Store owner applied the settings update" })
          .onConflictDoUpdate({
            target: [schema.tenantFeatureOverrides.tenantId, schema.tenantFeatureOverrides.key],
            set: { enabled: true, setBy: ctx.actor.type === "staff" ? ctx.actor.userId : null, updatedAt: new Date() },
          });
      }
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "settings.update_applied",
        targetType: "store_settings",
        targetId: ctx.tenantId,
        diff: { features: { before: [], after: pending } },
      });
    });
  }
  return view(rt, ctx);
}
