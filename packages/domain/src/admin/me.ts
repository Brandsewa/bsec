import { and, eq } from "drizzle-orm";
import { schema, withTenant, withUser } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export interface AdminMeStore {
  tenantId: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  permissions: string[];
}

export interface AdminMeSupport {
  sessionId: string;
  scope: "read_only" | "write";
  consent: "owner_approved" | "standing_consent" | "emergency";
  reason: string;
  ticketRef: string;
  expiresAt: string;
}

export interface AdminMe {
  user: { id: string; email: string; name: string };
  stores: AdminMeStore[];
  support?: AdminMeSupport | undefined;
}

/**
 * The signed-in staff user and every store they hold an active membership in. Identity comes from the
 * session only; each membership is proven through the memberships_self_read policy (app.user_id) and the
 * role is then read inside that store's own tenant scope.
 */
export async function getAdminMe(rt: Runtime, userId: string): Promise<AdminMe> {
  const db = rt._db.db;
  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error("Unauthorized: user not found");

  const memberships = await withUser(db, userId, (tx) =>
    tx
      .select({ tenantId: schema.memberships.tenantId, roleId: schema.memberships.roleId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active"))),
  );

  const stores: AdminMeStore[] = [];
  for (const m of memberships) {
    const tenantId = m.tenantId;
    if (!tenantId) continue;
    const [role] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ name: schema.roles.name, permissions: schema.roles.permissions })
        .from(schema.roles)
        .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.id, m.roleId)))
        .limit(1),
    );
    const [tenant] = await db
      .select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, status: schema.tenants.status })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);
    if (!role || !tenant) continue;
    stores.push({
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      role: role.name,
      permissions: role.permissions ?? [],
    });
  }

  return { user: { id: user.id, email: user.email, name: user.name }, stores };
}

/**
 * The "me" of a platform support session: who is looking, which store, and what they may do. Built from the already
 * validated tenant context (the token was checked, counted and audited by buildTenantContext), so it never depends on
 * a store login.
 */
export async function getSupportAdminMe(rt: Runtime, ctx: TenantContext): Promise<AdminMe> {
  if (ctx.actor.type !== "platform_support") throw new Error("Unauthorized: not a support session");
  const db = rt._db.db;
  const [session] = await db
    .select({
      id: schema.supportSessions.id,
      scope: schema.supportSessions.scope,
      consent: schema.supportSessions.consent,
      reason: schema.supportSessions.reason,
      ticketRef: schema.supportSessions.ticketRef,
      expiresAt: schema.supportSessions.expiresAt,
    })
    .from(schema.supportSessions)
    .where(and(eq(schema.supportSessions.id, ctx.actor.supportSessionId), eq(schema.supportSessions.tenantId, ctx.tenantId)))
    .limit(1);
  if (!session) throw new Error("Unauthorized: invalid or expired support session token");

  const [staff] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.actor.userId))
    .limit(1);
  const [tenant] = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, status: schema.tenants.status })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, ctx.tenantId))
    .limit(1);
  if (!staff || !tenant) throw new Error("Unauthorized: invalid or expired support session token");

  return {
    user: { id: staff.id, email: staff.email, name: staff.name ?? staff.email },
    stores: [
      {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        role: "support",
        permissions: [...ctx.permissions],
      },
    ],
    support: {
      sessionId: session.id,
      scope: session.scope as "read_only" | "write",
      consent: session.consent as "owner_approved" | "standing_consent" | "emergency",
      reason: session.reason,
      ticketRef: session.ticketRef,
      expiresAt: session.expiresAt.toISOString(),
    },
  };
}
