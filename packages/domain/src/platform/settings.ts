import { and, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, isStaffMfaRequired, writePlatformAudit, type AuditMeta } from "../platform-services.ts";

export interface PlatformSettingsView {
  requireStaffMfa: boolean;
  /** Whether the value comes from an explicit row (the toggle was used) or from the environment default. */
  explicit: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

/**
 * Reads the platform settings for the Super Admin toggle. Never throws for a missing row: absence is
 * the environment default (required in production, optional when APP_ENV=local).
 */
export async function getPlatformSettings(rt: Runtime, platformStaffUserId: string): Promise<PlatformSettingsView> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;
  const [row] = await db
    .select({
      requireStaffMfa: schema.platformSettings.requireStaffMfa,
      updatedAt: schema.platformSettings.updatedAt,
      updatedByEmail: schema.users.email,
    })
    .from(schema.platformSettings)
    .leftJoin(schema.users, eq(schema.users.id, schema.platformSettings.updatedBy))
    .where(eq(schema.platformSettings.id, "default"))
    .limit(1);
  if (!row) {
    return { requireStaffMfa: await isStaffMfaRequired(db), explicit: false, updatedAt: null, updatedByEmail: null };
  }
  return {
    requireStaffMfa: row.requireStaffMfa,
    explicit: true,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    updatedByEmail: row.updatedByEmail ?? null,
  };
}

/**
 * Toggles platform-wide staff MFA (platform_owner only, audited).
 *
 * Disabling flips two_factor_enabled off for every active platform staff user, so Better Auth stops
 * challenging them at sign-in; their enrolled secrets and verified records stay untouched, so
 * re-enabling restores the exact same authenticators. Enabling turns the flag back on for everyone
 * with a verified authenticator and leaves the rest to enrol at next sign-in. Sessions created while
 * MFA was off are refused by assertPlatformStaff once it is on again (they predate mfa_verified_at),
 * so a fresh password + TOTP sign-in is always required after re-enabling.
 */
export async function updatePlatformSettings(
  rt: Runtime,
  platformStaffUserId: string,
  input: { requireStaffMfa: boolean },
  meta?: AuditMeta,
): Promise<{ ok: true; requireStaffMfa: boolean }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_owner", "change platform security settings");

  const db = rt._db.db;
  const result = await db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ requireStaffMfa: schema.platformSettings.requireStaffMfa })
      .from(schema.platformSettings)
      .where(eq(schema.platformSettings.id, "default"))
      .limit(1);
    const before = prev ? prev.requireStaffMfa : await isStaffMfaRequired(db);
    const after = input.requireStaffMfa;

    if (after) {
      // Re-arm the challenge only where a verified authenticator exists; everyone else enrols at next sign-in.
      await tx
        .update(schema.users)
        .set({ twoFactorEnabled: true, updatedAt: sql`now()` })
        .where(
          and(
            sql`exists (select 1 from platform_staff ps where ps.user_id = ${schema.users.id} and ps.is_active = true)`,
            sql`exists (select 1 from two_factors tf where tf.user_id = ${schema.users.id} and tf.verified = true)`,
          ),
        );
    } else {
      // Better Auth challenges every user with the flag set: clear it so password-only sign-ins go through.
      await tx
        .update(schema.users)
        .set({ twoFactorEnabled: false, updatedAt: sql`now()` })
        .where(sql`exists (select 1 from platform_staff ps where ps.user_id = ${schema.users.id} and ps.is_active = true)`);
    }

    await tx
      .insert(schema.platformSettings)
      .values({ id: "default", requireStaffMfa: after, updatedBy: platformStaffUserId, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { requireStaffMfa: after, updatedBy: platformStaffUserId, updatedAt: sql`now()` },
      });

    await writePlatformAudit(tx, platformStaffUserId, "platform_settings.update", "platform_settings", "default", null, {
      requireStaffMfa: { from: before, to: after },
    }, meta);

    return { ok: true as const, requireStaffMfa: after };
  });
  return result;
}
