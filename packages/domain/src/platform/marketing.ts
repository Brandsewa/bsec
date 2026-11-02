import { schema } from "@bs/db";
import type { TenantContext } from "../context.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta, type PlatformRole } from "../platform-services.ts";
import type { Runtime } from "../runtime.ts";
import { getPlatformSiteId, PLATFORM_SITE_SLUG } from "./platform-site.ts";

/** Creates the website record on first use, with its audit row. Calling it again changes nothing. */
export async function enablePlatformSite(rt: Runtime, staffUserId: string, meta?: AuditMeta): Promise<{ siteId: string }> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_admin", "setting up the website");
  const db = rt._db.db;
  const existing = await getPlatformSiteId(db);
  if (existing) return { siteId: existing };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.tenants)
      .values({ slug: PLATFORM_SITE_SLUG, name: "BCOM website", kind: "platform_site", status: "active" })
      .onConflictDoNothing()
      .returning({ id: schema.tenants.id });
    const siteId = row?.id ?? (await getPlatformSiteId(tx));
    if (!siteId) throw new Error(`Conflict: the slug ${PLATFORM_SITE_SLUG} is taken by a store`);
    if (row) await writePlatformAudit(tx, staffUserId, "platform_site.create", "tenant", siteId, siteId, {}, meta);
    return { siteId };
  });
}

/**
 * The context Marketing procedures pass to the content services. Built only on the server, for the website record and
 * only `content.write`. Use it solely with the `app_rw` runtime: the services rely on RLS (ADR-042).
 */
export function platformSiteContext(siteId: string, staffUserId: string, requestId?: string): TenantContext {
  return {
    tenantId: siteId,
    storeStatus: "live",
    actor: { type: "staff", userId: staffUserId },
    roles: ["platform_site_editor"],
    permissions: ["content.write"],
    requestId: requestId ?? crypto.randomUUID(),
  };
}
