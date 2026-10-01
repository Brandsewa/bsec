import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/index.ts";
import { schema } from "../src/index.ts";

export type PlatformMfaState =
  /** TOTP enabled, verified, enrolment completed 1 hour ago: the normal state of a working staff account. */
  | "complete"
  /** No authenticator set up at all (a fresh bootstrap account). */
  | "none"
  /** TOTP enabled but the first code was never verified. */
  | "unverified"
  /** TOTP verified but the completion step (which kills password-only sessions) never ran. */
  | "enrolled_not_completed";

export interface SeededStaff {
  userId: string;
  email: string;
  /** A session-created-at value that is valid for this account (after MFA completion). */
  freshSessionAt: Date;
  /** A session-created-at value from before MFA completion. */
  staleSessionAt: Date;
}

/** Inserts a user + platform_staff row in the requested MFA state. Requires a role that can write those tables. */
export async function seedPlatformStaff(
  db: Db,
  opts: { email: string; role?: "platform_owner" | "platform_admin" | "platform_support"; mfa?: PlatformMfaState; active?: boolean },
): Promise<SeededStaff> {
  const userId = randomUUID();
  const mfa = opts.mfa ?? "complete";
  const now = Date.now();
  const completedAt = new Date(now - 60 * 60 * 1000);

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(schema.users.email ? eq(schema.users.email, opts.email) : undefined)
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.users)
      .set({
        twoFactorEnabled: mfa === "complete" || mfa === "unverified" || mfa === "enrolled_not_completed",
      })
      .where(eq(schema.users.id, existing[0].id));

    if (mfa !== "none") {
      await db.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, existing[0].id));
      await db.insert(schema.twoFactors).values({
        id: randomUUID(),
        userId: existing[0].id,
        secret: "encrypted-test-secret",
        backupCodes: "encrypted-test-backup-codes",
        verified: mfa !== "unverified",
      });
    } else {
      await db.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, existing[0].id));
    }

    await db
      .insert(schema.platformStaff)
      .values({
        userId: existing[0].id,
        role: opts.role ?? "platform_owner",
        isActive: opts.active ?? true,
        mfaRequired: true,
        mfaVerifiedAt: mfa === "complete" ? completedAt : null,
      })
      .onConflictDoUpdate({
        target: schema.platformStaff.userId,
        set: {
          role: opts.role ?? "platform_owner",
          isActive: opts.active ?? true,
          mfaVerifiedAt: mfa === "complete" ? completedAt : null,
        },
      });

    return {
      userId: existing[0].id,
      email: opts.email,
      freshSessionAt: new Date(now - 5 * 60 * 1000),
      staleSessionAt: new Date(completedAt.getTime() - 60 * 60 * 1000),
    };
  }

  await db.insert(schema.users).values({
    id: userId,
    email: opts.email,
    name: opts.email.split("@")[0] ?? opts.email,
    emailVerified: true,
    twoFactorEnabled: mfa === "complete" || mfa === "unverified" || mfa === "enrolled_not_completed",
  });
  if (mfa !== "none") {
    await db.insert(schema.twoFactors).values({
      id: randomUUID(),
      userId,
      secret: "encrypted-test-secret",
      backupCodes: "encrypted-test-backup-codes",
      verified: mfa !== "unverified",
    });
  }
  await db.insert(schema.platformStaff).values({
    userId,
    role: opts.role ?? "platform_owner",
    isActive: opts.active ?? true,
    mfaRequired: true,
    mfaVerifiedAt: mfa === "complete" ? completedAt : null,
  });

  return {
    userId,
    email: opts.email,
    freshSessionAt: new Date(now - 5 * 60 * 1000),
    staleSessionAt: new Date(completedAt.getTime() - 60 * 60 * 1000),
  };
}
