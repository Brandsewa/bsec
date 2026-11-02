import { and, eq, inArray, ne } from "drizzle-orm";
import { schema, type Db } from "@bs/db";

/**
 * bcom.si's own content (pages, blog, menus) lives under one internal `platform_site` tenant, so the existing content
 * services and tables work unchanged (ADR-042). It is not a store: it has no owner, plan, trial or domain row, it is
 * hidden from Super Admin's store screens, and store actions refuse it.
 */
export const PLATFORM_SITE_SLUG = "bcom-platform-site";

/** The internal record's id, or null before it has been created. */
export async function getPlatformSiteId(db: Db): Promise<string | null> {
  const [row] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.kind, "platform_site")).limit(1);
  return row?.id ?? null;
}

/** Store actions (suspend, delete, plan changes, support sessions...) must never reach the internal record. */
export async function assertStoreTenants(db: Db, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const [row] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(inArray(schema.tenants.id, tenantIds), ne(schema.tenants.kind, "store")))
    .limit(1);
  if (row) throw new Error("Conflict: this is the platform's own website, not a store");
}
