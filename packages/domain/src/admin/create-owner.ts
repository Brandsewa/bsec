import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { hashPassword, STORE_PERMISSIONS, SYSTEM_STORE_ROLES } from "@bs/auth";

export interface CreateOwnerInput {
  email: string;
  name: string;
  password: string;
  /** Slug of the store to attach the owner to. */
  tenantSlug: string;
}

export interface CreateOwnerResult {
  userId: string;
  tenantId: string;
  createdUser: boolean;
}

const SYSTEM_ROLES: Array<{ name: string; permissions: readonly string[] }> = [
  { name: "store_owner", permissions: STORE_PERMISSIONS },
  { name: "store_admin", permissions: STORE_PERMISSIONS },
  { name: "store_finance", permissions: SYSTEM_STORE_ROLES.store_finance },
];

/** Makes sure the store has its system roles and gives the user an active owner membership. Idempotent. */
export async function grantStoreOwner(db: Db, tenantId: string, userId: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    for (const role of SYSTEM_ROLES) {
      await tx
        .insert(schema.roles)
        .values({ tenantId, name: role.name, isSystem: true, permissions: [...role.permissions] })
        .onConflictDoUpdate({
          target: [schema.roles.tenantId, schema.roles.name],
          set: { permissions: [...role.permissions], isSystem: true, updatedAt: sql`now()` },
        });
    }
    const [ownerRole] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_owner")))
      .limit(1);
    if (!ownerRole) throw new Error("store_owner role missing");
    await tx
      .insert(schema.memberships)
      .values({ tenantId, userId, roleId: ownerRole.id, status: "active" })
      .onConflictDoUpdate({
        target: [schema.memberships.tenantId, schema.memberships.userId],
        set: { roleId: ownerRole.id, status: "active", updatedAt: sql`now()` },
      });
  });
}

/**
 * Operator bootstrap: creates (or updates the password of) a staff user, makes sure the store has its
 * system roles, and grants the owner membership. Never logs or returns the password. Idempotent.
 */
export async function createStoreOwner(db: Db, input: CreateOwnerInput): Promise<CreateOwnerResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Invalid owner email");
  if (input.password.length < 10) throw new Error("Password must be at least 10 characters");

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, input.tenantSlug))
    .limit(1);
  if (!tenant) throw new Error(`No store with slug '${input.tenantSlug}'`);

  const passwordHash = await hashPassword(input.password);

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let userId: string;
  let createdUser = false;
  if (existing) {
    userId = existing.id;
    const [credential] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")))
      .limit(1);
    if (credential) {
      await db
        .update(schema.accounts)
        .set({ password: passwordHash, updatedAt: sql`now()` })
        .where(eq(schema.accounts.id, credential.id));
    } else {
      await db.insert(schema.accounts).values({
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: passwordHash,
      });
    }
  } else {
    const [user] = await db
      .insert(schema.users)
      .values({ email, name: input.name.trim() || email, emailVerified: true })
      .returning({ id: schema.users.id });
    if (!user) throw new Error("Failed to create user");
    userId = user.id;
    createdUser = true;
    await db.insert(schema.accounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: passwordHash,
    });
  }

  await grantStoreOwner(db, tenant.id, userId);

  return { userId, tenantId: tenant.id, createdUser };
}
