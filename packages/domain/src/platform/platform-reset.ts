import { eq, notInArray, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta, type PlatformRole } from "../platform-services.ts";
import { purgeTenantData } from "../admin/tenant-purge.ts";
import { CloudflareCustomDomainProvider, type CustomDomainProvider } from "../domains/provider.ts";
import { resolveBillingProvider, type SubscriptionBillingProvider } from "../saas/billing.ts";
import { getR2Config } from "../media/storage.ts";
import { deleteFromR2 } from "./deletion-steps.ts";

export const PLATFORM_RESET_PHRASE = "RESET ALL STORES";

export interface PlatformResetDeps {
  billing?: SubscriptionBillingProvider | undefined;
  domains?: CustomDomainProvider | undefined;
  deleteMediaObjects?: ((keys: string[]) => Promise<number>) | undefined;
}

export interface PlatformResetPreview {
  /** False unless the operator set PLATFORM_RESET_ENABLED=true on the platform service. */
  enabled: boolean;
  phrase: string;
  stores: { id: string; name: string; slug: string; status: string }[];
  /** Accounts that will be deleted: every user who is not platform staff. */
  usersToDelete: number;
  staffKept: number;
  signupLeads: number;
}

export function isPlatformResetEnabled(): boolean {
  return process.env.PLATFORM_RESET_ENABLED?.trim() === "true";
}

export async function previewPlatformReset(rt: Runtime, platformStaffUserId: string): Promise<PlatformResetPreview> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_owner", "resetting the platform");
  const db = rt._db.db;
  const stores = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, status: schema.tenants.status })
    .from(schema.tenants)
    .orderBy(schema.tenants.createdAt);
  const staffIds = (await db.select({ id: schema.platformStaff.userId }).from(schema.platformStaff)).map((r) => r.id);
  const [users] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(staffIds.length ? notInArray(schema.users.id, staffIds) : sql`true`);
  const [leads] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.signupLeads);
  return {
    enabled: isPlatformResetEnabled(),
    phrase: PLATFORM_RESET_PHRASE,
    stores,
    usersToDelete: users?.n ?? 0,
    staffKept: staffIds.length,
    signupLeads: leads?.n ?? 0,
  };
}

/**
 * Wipes every store and every non-staff account so the platform can start fresh (owner request 2026-10-22). Platform
 * owner only, only while PLATFORM_RESET_ENABLED=true, only with the typed phrase and the store count the operator saw.
 * Kept: platform staff and their logins, plans, templates, flags, settings, reserved slugs and the platform audit trail
 * (which records this reset). Deleted: all stores with their data, media, custom domains, provider subscriptions and
 * invoices, store owners and customers' accounts, signup leads and slug reservations.
 *
 * Outside systems go first and fail closed: if billing, Cloudflare or storage cleanup fails for any store, nothing is
 * deleted from the database and the error is returned; the outside calls are idempotent, so a retry is safe. All
 * database deletes then run in a single transaction together with the audit row.
 */
export async function resetPlatformData(
  rt: Runtime,
  platformStaffUserId: string,
  input: { confirmation: string; expectedStores: number },
  meta?: AuditMeta,
  deps: PlatformResetDeps = {},
): Promise<{ ok: true; storesDeleted: number; usersDeleted: number }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_owner", "resetting the platform");
  if (!isPlatformResetEnabled()) {
    throw new Error("Forbidden: platform reset is switched off. Set PLATFORM_RESET_ENABLED=true on the platform service, then turn it off again afterwards");
  }
  if (input.confirmation !== PLATFORM_RESET_PHRASE) throw new Error(`Bad Request: type "${PLATFORM_RESET_PHRASE}" to confirm`);

  const db = rt._db.db;
  const tenants = await db.select({ id: schema.tenants.id, slug: schema.tenants.slug }).from(schema.tenants);
  if (tenants.length !== input.expectedStores) {
    throw new Error(`Conflict: there are now ${tenants.length} stores, not ${input.expectedStores}. Review the list and try again`);
  }

  // 1. Outside systems, before anything is deleted.
  const billing = deps.billing ?? (await resolveBillingProvider(db));
  const domainsProvider = deps.domains ?? new CloudflareCustomDomainProvider();
  const r2 = getR2Config();
  const mediaConfigured = Boolean(deps.deleteMediaObjects) || Boolean(r2.accessKeyId && r2.secretAccessKey);
  for (const t of tenants) {
    if (billing.isConfigured?.() ?? true) {
      const subs = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, t.id));
      for (const s of subs) {
        if (!s.providerSubscriptionId || s.status === "cancelled") continue;
        // A subscription the provider no longer knows (404) is already gone, which is what a reset wants.
        await billing.cancelSubscription(s.providerSubscriptionId).catch((err: unknown) => {
          if (!/404|not found/i.test(err instanceof Error ? err.message : String(err))) throw err;
        });
      }
    }
    if (domainsProvider.isConfigured?.() ?? true) {
      const doms = await db.select().from(schema.domains).where(eq(schema.domains.tenantId, t.id));
      for (const d of doms) if (d.type === "custom" && d.cfCustomHostnameId) await domainsProvider.deleteCustomHostname(d.cfCustomHostnameId);
    }
    if (mediaConfigured) {
      const keys = (await db.select({ key: schema.media.storageKey }).from(schema.media).where(eq(schema.media.tenantId, t.id))).map((m) => m.key);
      if (keys.length > 0) await (deps.deleteMediaObjects ?? deleteFromR2)(keys);
    }
  }

  // 2. Everything in the database in ONE transaction: a failure (or a failed audit write) leaves the data untouched.
  return db.transaction(async (tx) => {
    for (const t of tenants) await purgeTenantData(tx, t.id);
    const staffIds = (await tx.select({ id: schema.platformStaff.userId }).from(schema.platformStaff)).map((r) => r.id);
    await tx.delete(schema.tenantPromotions); // references tenants with ON DELETE RESTRICT
    await tx.delete(schema.tenants);
    await tx.delete(schema.organizations);
    const gone = await tx
      .delete(schema.users)
      .where(staffIds.length ? notInArray(schema.users.id, staffIds) : sql`true`)
      .returning({ id: schema.users.id });
    await tx.delete(schema.slugReservations);
    await tx.delete(schema.signupLeads);
    await writePlatformAudit(tx, platformStaffUserId, "platform.reset", "platform", "platform", undefined, {
      storesDeleted: tenants.length,
      slugs: tenants.map((t) => t.slug),
      usersDeleted: gone.length,
    }, meta);
    return { ok: true as const, storesDeleted: tenants.length, usersDeleted: gone.length };
  });
}
