import { and, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { resolveHostToTenant } from "./host-resolver.ts";
import type { Runtime } from "./runtime.ts";

/**
 * Every domain service takes ctx first (PLAN §3). The tenant is never taken from the client:
 * it comes from the host (storefront) or session membership + X-Store-Id (admin). Built in M1.
 */
import { hasPermission, type StorePermission } from "@bs/auth";

export { hasPermission, type StorePermission };

export type Actor =
  | { type: "anonymous" }
  | { type: "customer"; customerId: string }
  | { type: "staff"; userId: string }
  | { type: "platform_support"; userId: string; supportSessionId: string }
  | { type: "system" };

export type StoreStatus = "live" | "coming_soon" | "maintenance" | "password";

export interface TenantContext {
  tenantId: string;
  storeStatus: StoreStatus;
  actor: Actor;
  roles: readonly string[];
  permissions: readonly string[];
  requestId: string;
}

/**
 * Asserts that the TenantContext possesses a required store permission (PLAN §4).
 * Throws a Forbidden error if the permission is not granted.
 */
export function assertPermission(ctx: TenantContext, needed: StorePermission): void {
  if (!hasPermission(ctx.permissions, needed)) {
    throw new Error(`Forbidden: missing required permission '${needed}'`);
  }
}

export type HeaderValues = Headers | Record<string, string | string[] | undefined>;

export interface BuildTenantContextOptions {
  entryPath?: "storefront" | "admin" | undefined;
  headers: HeaderValues;
  session?: {
    user: { id: string; email?: string | undefined };
    session?: { id: string; userId: string; [key: string]: unknown } | undefined;
    type?: "staff" | "customer" | undefined;
  } | null | undefined;
}

function getHeader(headers: HeaderValues, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lowerName = name.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lowerName) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}

/**
 * Builds the TenantContext for incoming requests (PLAN §3, §4).
 * Enforces:
 * - Storefront path: tenant strictly resolved from Host header via resolveHostToTenant.
 * - Admin path: tenant resolved from X-Store-Id header + session membership cross-check.
 *   Customer sessions cannot resolve admin context.
 */
export async function buildTenantContext(
  dbOrRt: Db | Runtime,
  opts: BuildTenantContextOptions,
): Promise<TenantContext | null> {
  const db = "_db" in dbOrRt ? dbOrRt._db.db : dbOrRt;
  const requestId =
    getHeader(opts.headers, "x-request-id") ?? crypto.randomUUID();

  if (opts.entryPath === "admin") {
    if (!opts.session) {
      throw new Error("Unauthorized: admin access requires an authenticated session");
    }

    if (opts.session.type === "customer") {
      throw new Error("Forbidden: customer session cannot access admin context");
    }

    const session = opts.session;
    const storeId = getHeader(opts.headers, "x-store-id");
    if (!storeId) {
      throw new Error("Bad Request: missing X-Store-Id header for admin context");
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(storeId)) {
      throw new Error("Forbidden: user has no active membership for the requested store");
    }

    // Cross-check active membership and load assigned role and tenant status.
    // Executed within withTenant(db, storeId, ...) because memberships table has FORCE ROW LEVEL SECURITY.
    const queryMembership = async (d: Db) => {
      return await d
        .select({
          membershipStatus: schema.memberships.status,
          roleName: schema.roles.name,
          permissions: schema.roles.permissions,
          tenantStatus: schema.tenants.status,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.roles,
          and(
            eq(schema.roles.id, schema.memberships.roleId),
            eq(schema.roles.tenantId, schema.memberships.tenantId),
          ),
        )
        .innerJoin(
          schema.tenants,
          eq(schema.tenants.id, schema.memberships.tenantId),
        )
        .where(
          and(
            eq(schema.memberships.tenantId, storeId),
            eq(schema.memberships.userId, session.user.id),
            eq(schema.memberships.status, "active"),
          ),
        )
        .limit(1);
    };

    const membershipRows =
      typeof db.transaction === "function"
        ? await withTenant(db, storeId, queryMembership)
        : await queryMembership(db);

    const row = membershipRows[0];
    if (!row) {
      throw new Error("Forbidden: user has no active membership for the requested store");
    }
    const storeStatus: StoreStatus =
      row.tenantStatus === "active" ? "live" : (row.tenantStatus as StoreStatus);

    return {
      tenantId: storeId,
      storeStatus,
      actor: { type: "staff", userId: opts.session.user.id },
      roles: [row.roleName],
      permissions: row.permissions ?? [],
      requestId,
    };
  }

  // Storefront entry path (default)
  const host =
    getHeader(opts.headers, "x-forwarded-host") ?? getHeader(opts.headers, "host");
  if (!host) {
    return null;
  }

  const resolved = await resolveHostToTenant(db, host);
  if (!resolved) {
    return null;
  }

  let actor: Actor = { type: "anonymous" };
  if (opts.session) {
    if (opts.session.type === "customer" || !opts.session.type) {
      actor = { type: "customer", customerId: opts.session.user.id };
    } else {
      actor = { type: "staff", userId: opts.session.user.id };
    }
  }

  return {
    tenantId: resolved.tenantId,
    storeStatus: resolved.storeStatus,
    actor,
    roles: [],
    permissions: [],
    requestId,
  };
}
