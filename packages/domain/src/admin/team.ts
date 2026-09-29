import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { hashPassword } from "@bs/auth";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

export interface MembershipRecord {
  id: string;
  userId: string;
  roleId: string;
  status: string;
  createdAt?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  roleName?: string | undefined;
}

export interface StaffInvitationRecord {
  id: string;
  email: string;
  roleId: string;
  expiresAt?: string | undefined;
  /** Raw token, returned exactly once when the invitation is created. Only its hash is stored. */
  token?: string | undefined;
  acceptedAt?: string | null | undefined;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Members of the current store with their name, email and role (PLAN §4, §5.3). */
export async function listMemberships(rt: Runtime, ctx: TenantContext): Promise<MembershipRecord[]> {
  assertPermission(ctx, "staff.manage");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.memberships.id,
        userId: schema.memberships.userId,
        roleId: schema.memberships.roleId,
        status: schema.memberships.status,
        createdAt: schema.memberships.createdAt,
        email: schema.users.email,
        name: schema.users.name,
        roleName: schema.roles.name,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(
        schema.roles,
        and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, schema.memberships.tenantId)),
      );
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      roleId: r.roleId,
      status: r.status,
      createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
      email: r.email,
      name: r.name,
      roleName: r.roleName,
    }));
  });
}

export async function listStoreRoles(rt: Runtime, ctx: TenantContext): Promise<Array<{ id: string; name: string }>> {
  assertPermission(ctx, "staff.manage");
  return withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles).orderBy(schema.roles.name),
  );
}

async function activeOwnerCount(tx: Parameters<Parameters<typeof withTenant>[2]>[0]): Promise<number> {
  const rows = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(
      schema.roles,
      and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, schema.memberships.tenantId)),
    )
    .where(and(eq(schema.roles.name, "store_owner"), eq(schema.memberships.status, "active")));
  return rows.length;
}

export async function setMemberRole(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; roleId: string },
): Promise<MembershipRecord> {
  assertPermission(ctx, "staff.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [target] = await tx
      .select({ id: schema.memberships.id, roleName: schema.roles.name })
      .from(schema.memberships)
      .innerJoin(
        schema.roles,
        and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, schema.memberships.tenantId)),
      )
      .where(eq(schema.memberships.id, input.id))
      .limit(1);
    if (!target) throw new Error("Not Found: member not found");
    const [newRole] = await tx.select({ name: schema.roles.name }).from(schema.roles).where(eq(schema.roles.id, input.roleId)).limit(1);
    if (!newRole) throw new Error("Bad Request: role not found");
    if (target.roleName === "store_owner" && newRole.name !== "store_owner" && (await activeOwnerCount(tx)) <= 1) {
      throw new Error("Conflict: a store must keep at least one owner");
    }
    await tx
      .update(schema.memberships)
      .set({ roleId: input.roleId, updatedAt: sql`now()` })
      .where(eq(schema.memberships.id, input.id));
  });
  const all = await listMemberships(rt, ctx);
  const updated = all.find((m) => m.id === input.id);
  if (!updated) throw new Error("Not Found: member not found");
  return updated;
}

export async function removeMember(rt: Runtime, ctx: TenantContext, input: { id: string }): Promise<{ ok: true }> {
  assertPermission(ctx, "staff.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [target] = await tx
      .select({ id: schema.memberships.id, userId: schema.memberships.userId, roleName: schema.roles.name })
      .from(schema.memberships)
      .innerJoin(
        schema.roles,
        and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, schema.memberships.tenantId)),
      )
      .where(eq(schema.memberships.id, input.id))
      .limit(1);
    if (!target) throw new Error("Not Found: member not found");
    if (ctx.actor.type === "staff" && ctx.actor.userId === target.userId) {
      throw new Error("Conflict: you cannot remove yourself from the store");
    }
    if (target.roleName === "store_owner" && (await activeOwnerCount(tx)) <= 1) {
      throw new Error("Conflict: a store must keep at least one owner");
    }
    await tx.delete(schema.memberships).where(eq(schema.memberships.id, input.id));
  });
  return { ok: true };
}

/** Creates (or replaces) a pending invitation. The raw token is returned once; only its hash is stored. */
export async function inviteStaff(
  rt: Runtime,
  ctx: TenantContext,
  input: { email: string; roleId: string },
): Promise<StaffInvitationRecord> {
  assertPermission(ctx, "staff.manage");
  const email = input.email.trim().toLowerCase();
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [role] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.id, input.roleId)).limit(1);
    if (!role) throw new Error("Bad Request: role not found");

    const [alreadyMember] = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.users.email, email))
      .limit(1);
    if (alreadyMember) throw new Error("Conflict: this person is already a member of the store");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const [row] = await tx
      .insert(schema.staffInvitations)
      .values({ tenantId: ctx.tenantId, email, roleId: input.roleId, tokenHash: hashToken(token), expiresAt })
      .onConflictDoUpdate({
        target: [schema.staffInvitations.tenantId, schema.staffInvitations.email],
        set: { roleId: input.roleId, tokenHash: hashToken(token), expiresAt, acceptedAt: null, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error("Failed to create staff invitation");
    return { id: row.id, email: row.email, roleId: row.roleId, expiresAt: row.expiresAt.toISOString(), token, acceptedAt: null };
  });
}

export async function listInvitations(rt: Runtime, ctx: TenantContext): Promise<StaffInvitationRecord[]> {
  assertPermission(ctx, "staff.manage");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.staffInvitations)
      .where(and(isNull(schema.staffInvitations.acceptedAt), gt(schema.staffInvitations.expiresAt, new Date())));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      roleId: r.roleId,
      expiresAt: r.expiresAt.toISOString(),
      acceptedAt: null,
    }));
  });
}

export async function revokeInvitation(rt: Runtime, ctx: TenantContext, input: { id: string }): Promise<{ ok: true }> {
  assertPermission(ctx, "staff.manage");
  await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx.delete(schema.staffInvitations).where(eq(schema.staffInvitations.id, input.id)),
  );
  return { ok: true };
}

/**
 * Accepts an invitation (public endpoint). The invite link carries the store id and the raw token;
 * only the token's hash is stored. New people choose a name and password here; existing accounts just gain
 * the membership.
 */
export async function acceptInvitation(
  rt: Runtime,
  input: { storeId: string; token: string; name?: string | undefined; password?: string | undefined },
): Promise<{ ok: true; email: string }> {
  const db = rt._db.db;
  const invalid = () => new Error("Bad Request: this invitation link is invalid or has expired");
  return withTenant(db, input.storeId, async (tx) => {
    const [inv] = await tx
      .select()
      .from(schema.staffInvitations)
      .where(
        and(
          eq(schema.staffInvitations.tokenHash, hashToken(input.token)),
          isNull(schema.staffInvitations.acceptedAt),
          gt(schema.staffInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!inv) throw invalid();

    const email = inv.email.toLowerCase();
    const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      if (!input.password || input.password.length < 10) {
        throw new Error("Bad Request: choose a password of at least 10 characters");
      }
      const [user] = await tx
        .insert(schema.users)
        .values({ email, name: input.name?.trim() || email, emailVerified: true })
        .returning({ id: schema.users.id });
      if (!user) throw new Error("Failed to create user");
      userId = user.id;
      await tx.insert(schema.accounts).values({
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: await hashPassword(input.password),
      });
    }

    await tx
      .insert(schema.memberships)
      .values({ tenantId: input.storeId, userId, roleId: inv.roleId, status: "active", invitedBy: null })
      .onConflictDoUpdate({
        target: [schema.memberships.tenantId, schema.memberships.userId],
        set: { roleId: inv.roleId, status: "active", updatedAt: sql`now()` },
      });
    await tx
      .update(schema.staffInvitations)
      .set({ acceptedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(schema.staffInvitations.id, inv.id));

    return { ok: true as const, email };
  });
}
