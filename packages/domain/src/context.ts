import { and, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { evaluateStorefrontAccess } from "./storefront/lifecycle.ts";
import type { Runtime } from "./runtime.ts";

/**
 * Every domain service takes ctx first (PLAN §3). The tenant is never taken from the client:
 * it comes from the host (storefront) or session membership + X-Store-Id (admin). Built in M1.
 */
import { hasPermission, STORE_PERMISSIONS, type StorePermission } from "@bs/auth";

import { validateSupportSessionToken } from "./platform/support-sessions.ts";
import { isAdminAccessAllowed, isAdminReadOnly } from "./system/tenant-lifecycle.ts";

export { hasPermission, type StorePermission };

/**
 * What a platform support session may do in a store (PLAN §6.3), expressed in the real store permission names.
 * Read-only sessions get the *.read permissions. Write sessions (second confirmation) add everyday store work, but
 * never team management, payment/settings credentials, data exports or refunds: those stay with the store's owner.
 */
export const SUPPORT_READ_PERMISSIONS: readonly StorePermission[] = STORE_PERMISSIONS.filter((p) => p.endsWith(".read"));
const SUPPORT_WRITE_DENIED: readonly StorePermission[] = ["staff.manage", "settings.write", "exports.run", "orders.refund"];
export const SUPPORT_WRITE_PERMISSIONS: readonly StorePermission[] = STORE_PERMISSIONS.filter((p) => !SUPPORT_WRITE_DENIED.includes(p));

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
  /** Method and path of the request, recorded in the audit trail when a support token is used. */
  request?: { method?: string | undefined; path?: string | undefined } | undefined;
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
 * - Admin path: tenant resolved from X-Store-Id header + session membership cross-check,
 *   or verified X-Support-Token for platform support impersonation.
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
    const storeId = getHeader(opts.headers, "x-store-id");
    if (!storeId) {
      throw new Error("Bad Request: missing X-Store-Id header for admin context");
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(storeId)) {
      throw new Error("Forbidden: user has no active membership for the requested store");
    }

    // 1. Support session check (PLAN §6.3)
    const supportToken = getHeader(opts.headers, "x-support-token");
    if (supportToken) {
      const supportSession = await validateSupportSessionToken(db, supportToken, storeId, opts.request);
      const [t] = await db
        .select({ status: schema.tenants.status })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, storeId))
        .limit(1);

      const tenantStatus = t?.status ?? "active";
      if (!isAdminAccessAllowed(tenantStatus)) {
        throw new Error("Forbidden: tenant is not accessible in admin");
      }

      let permissions = [...(supportSession.scope === "write" ? SUPPORT_WRITE_PERMISSIONS : SUPPORT_READ_PERMISSIONS)] as string[];
      if (isAdminReadOnly(tenantStatus)) permissions = permissions.filter((p) => p.endsWith(".read"));

      const storeStatus: StoreStatus =
        tenantStatus === "active" ? "live" : (tenantStatus as StoreStatus);

      return {
        tenantId: storeId,
        storeStatus,
        actor: {
          type: "platform_support",
          userId: supportSession.platformUserId,
          supportSessionId: supportSession.sessionId,
        },
        roles: ["support"],
        permissions,
        requestId,
      };
    }

    if (!opts.session) {
      throw new Error("Unauthorized: admin access requires an authenticated session");
    }

    if (opts.session.type === "customer") {
      throw new Error("Forbidden: customer session cannot access admin context");
    }

    const session = opts.session;

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

    if (!isAdminAccessAllowed(row.tenantStatus)) {
      throw new Error("Forbidden: tenant is not accessible in admin");
    }

    const storeStatus: StoreStatus =
      row.tenantStatus === "active" ? "live" : (row.tenantStatus as StoreStatus);

    let permissions = row.permissions ?? [];
    if (isAdminReadOnly(row.tenantStatus)) {
      permissions = permissions.filter((p) => p.endsWith(".read"));
    }

    return {
      tenantId: storeId,
      storeStatus,
      actor: { type: "staff", userId: opts.session.user.id },
      roles: [row.roleName],
      permissions,
      requestId,
    };
  }

  // Storefront entry path (default)
  const host =
    getHeader(opts.headers, "x-forwarded-host") ?? getHeader(opts.headers, "host");
  if (!host) {
    return null;
  }

  const access = await evaluateStorefrontAccess(db, host, opts);
  if (!access.tenantId || access.reason === "not_found") {
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

  const storeStatus: StoreStatus =
    access.mode ?? (access.tenantStatus === "suspended" ? "maintenance" : "live");

  return {
    tenantId: access.tenantId,
    storeStatus,
    actor,
    roles: [],
    permissions: [],
    requestId,
  };
}
