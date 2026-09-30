import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { hashPassword } from "@bs/auth";

export interface CreatePlatformStaffInput {
  email: string;
  name: string;
  /** Only needed for a brand-new account (or an existing one without a password); never replaces an existing password. */
  password?: string | undefined;
  role?: "platform_owner" | "platform_admin" | "platform_support";
}

export interface CreatePlatformStaffResult {
  userId: string;
  email: string;
  role: string;
  createdUser: boolean;
  mfaRequired: boolean;
}

/**
 * Operator bootstrap: creates a platform staff member.
 * - A brand-new person gets the password given.
 * - An EXISTING account (e.g. someone who also owns a store) keeps its current password: the operator tool never
 *   resets a password (use the store's own reset flow). It only adds the platform_staff role.
 * - `resetMfa` (lost authenticator) removes the person's TOTP enrolment and every session so they enrol again.
 * MFA enrolment is required at first login. Never logs or prints the password. Idempotent.
 */
export async function createPlatformStaffMember(
  db: Db,
  input: CreatePlatformStaffInput & { resetMfa?: boolean | undefined },
): Promise<CreatePlatformStaffResult & { passwordUnchanged: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Invalid staff email");
  }

  const role = input.role ?? "platform_owner";

  const [existingUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let userId: string;
  let createdUser = false;
  let passwordUnchanged = false;

  if (existingUser) {
    userId = existingUser.id;
    passwordUnchanged = true;
    const [cred] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")))
      .limit(1);
    if (!cred) {
      if (!input.password) throw new Error("Password required: this account has no password yet");
      if (input.password.length < 10) throw new Error("Password must be at least 10 characters");
      await db.insert(schema.accounts).values({
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: await hashPassword(input.password),
      });
      passwordUnchanged = false;
    }
  } else {
    if (!input.password) throw new Error("Password required: this is a new account");
    if (input.password.length < 10) throw new Error("Password must be at least 10 characters");
    userId = randomUUID();
    createdUser = true;
    await db.insert(schema.users).values({
      id: userId,
      email,
      name: input.name.trim(),
      emailVerified: true,
      twoFactorEnabled: false, // Enforce MFA enrolment at first login
    });
    await db.insert(schema.accounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: await hashPassword(input.password),
    });
  }

  await db
    .insert(schema.platformStaff)
    .values({ userId, role, isActive: true, mfaRequired: true })
    .onConflictDoUpdate({
      target: [schema.platformStaff.userId],
      set: { role, isActive: true, mfaRequired: true, updatedAt: sql`now()` },
    });

  if (input.resetMfa) {
    await db.transaction(async (tx) => {
      await tx.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, userId));
      await tx.update(schema.users).set({ twoFactorEnabled: false, updatedAt: sql`now()` }).where(eq(schema.users.id, userId));
      await tx.update(schema.platformStaff).set({ mfaVerifiedAt: null, updatedAt: sql`now()` }).where(eq(schema.platformStaff.userId, userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await tx.insert(schema.platformAuditLogs).values({
        actorType: "system",
        action: "platform_staff.mfa_reset",
        targetType: "platform_staff",
        targetId: userId,
        diff: { via: "operator_cli" },
      });
    });
  }

  return { userId, email, role, createdUser, mfaRequired: true, passwordUnchanged };
}
