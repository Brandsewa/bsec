import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { hashPassword } from "@bs/auth";

export interface CreatePlatformStaffInput {
  email: string;
  name: string;
  password: string;
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
 * Operator bootstrap: creates (or resets password of) a platform staff member.
 * Sets mfa_required = true, ensuring MFA enrolment at first login.
 * Never logs or prints the password. Idempotent.
 */
export async function createPlatformStaffMember(
  db: Db,
  input: CreatePlatformStaffInput,
): Promise<CreatePlatformStaffResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Invalid staff email");
  }
  if (input.password.length < 10) {
    throw new Error("Password must be at least 10 characters");
  }

  const role = input.role ?? "platform_owner";
  const passwordHash = await hashPassword(input.password);

  const [existingUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let userId: string;
  let createdUser = false;

  if (existingUser) {
    userId = existingUser.id;
    const [cred] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")))
      .limit(1);

    if (cred) {
      await db
        .update(schema.accounts)
        .set({ password: passwordHash, updatedAt: sql`now()` })
        .where(eq(schema.accounts.id, cred.id));
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
      password: passwordHash,
    });
  }

  // Create or update platform_staff record
  await db
    .insert(schema.platformStaff)
    .values({
      userId,
      role,
      isActive: true,
      mfaRequired: true,
    })
    .onConflictDoUpdate({
      target: [schema.platformStaff.userId],
      set: {
        role,
        isActive: true,
        mfaRequired: true,
        updatedAt: sql`now()`,
      },
    });

  return {
    userId,
    email,
    role,
    createdUser,
    mfaRequired: true,
  };
}
