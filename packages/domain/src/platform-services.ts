import { and, eq } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "./runtime.ts";

export interface PlatformTenantRecord {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt?: string | undefined;
}

/**
 * Asserts that the authenticated user is an active platform staff member (PLAN §6).
 * Throws Forbidden error if not found or inactive.
 */
export async function assertPlatformStaff(
  rt: Runtime,
  userId: string,
): Promise<{ role: string }> {
  // TODO(M9): enforce MFA
  const db = rt._db.db;
  const rows = await db
    .select({
      role: schema.platformStaff.role,
      isActive: schema.platformStaff.isActive,
    })
    .from(schema.platformStaff)
    .where(
      and(
        eq(schema.platformStaff.userId, userId),
        eq(schema.platformStaff.isActive, true),
      ),
    )
    .limit(1);

  const staff = rows[0];
  if (!staff) {
    throw new Error("Forbidden: user is not an active platform staff member");
  }

  return { role: staff.role };
}

/**
 * Lists all tenants across the platform (PLAN §5.1).
 * Executes with BYPASSRLS platform credentials; no tenant filter.
 */
export async function listPlatformTenants(rt: Runtime): Promise<PlatformTenantRecord[]> {
  const db = rt._db.db;
  const rows = await db
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      status: schema.tenants.status,
      createdAt: schema.tenants.createdAt,
    })
    .from(schema.tenants);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
  }));
}

/**
 * Gets a single tenant by id (PLAN §5.1).
 * Executes with BYPASSRLS platform credentials.
 */
export async function getPlatformTenant(
  rt: Runtime,
  id: string,
): Promise<PlatformTenantRecord> {
  const db = rt._db.db;
  const rows = await db
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      status: schema.tenants.status,
      createdAt: schema.tenants.createdAt,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(`Tenant not found: ${id}`);
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
  };
}
