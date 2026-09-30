import { describe, expect, it } from "vitest";
import { assertPlatformStaff } from "../src/platform-services.ts";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../src/runtime.ts";

describe("Platform Staff Auth & MFA Enforcement (PLAN §6 / M9)", () => {
  function createMockRuntime(data: {
    staff?: { role: string; isActive: boolean; mfaRequired: boolean } | null;
    user?: { twoFactorEnabled: boolean } | null;
    twoFactorRecord?: { verified: boolean } | null;
  }): Runtime {
    const mockDb = {
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => {
              if (table === schema.platformStaff) {
                return data.staff ? [data.staff] : [];
              }
              if (table === schema.users) {
                return data.user ? [data.user] : [];
              }
              if (table === schema.twoFactors) {
                return data.twoFactorRecord ? [data.twoFactorRecord] : [];
              }
              return [];
            },
          }),
        }),
      }),
    } as unknown as Db;

    return {
      _db: { db: mockDb },
    } as unknown as Runtime;
  }

  const userId = "0199a000-0000-7000-8000-000000000001";

  it("rejects store owner or admin account that is not platform staff", async () => {
    // User exists as store owner/admin, but has NO row in platform_staff
    const rt = createMockRuntime({
      staff: null,
      user: { twoFactorEnabled: false },
    });

    await expect(assertPlatformStaff(rt, userId)).rejects.toThrow(
      "Forbidden: user is not an active platform staff member",
    );
  });

  it("rejects deactivated platform staff member", async () => {
    // User is in platform_staff, but isActive is false
    const rt = createMockRuntime({
      staff: null, // where query filters isActive === true, returning 0 rows
      user: { twoFactorEnabled: true },
      twoFactorRecord: { verified: true },
    });

    await expect(assertPlatformStaff(rt, userId)).rejects.toThrow(
      "Forbidden: user is not an active platform staff member",
    );
  });

  it("rejects platform staff member with valid password but no MFA enrolled", async () => {
    // Active staff, but twoFactorEnabled is false
    const rt = createMockRuntime({
      staff: { role: "platform_admin", isActive: true, mfaRequired: true },
      user: { twoFactorEnabled: false },
      twoFactorRecord: null,
    });

    await expect(assertPlatformStaff(rt, userId)).rejects.toThrow(
      "Forbidden: platform staff requires verified MFA (two-factor authentication not enabled)",
    );
  });

  it("rejects platform staff member with MFA enabled on user but unverified TOTP/backup session", async () => {
    // Active staff, twoFactorEnabled true, but twoFactors row is not verified
    const rt = createMockRuntime({
      staff: { role: "platform_admin", isActive: true, mfaRequired: true },
      user: { twoFactorEnabled: true },
      twoFactorRecord: { verified: false },
    });

    await expect(assertPlatformStaff(rt, userId)).rejects.toThrow(
      "Forbidden: platform staff requires verified MFA (two-factor authentication not verified)",
    );
  });

  it("accepts platform staff member with verified MFA", async () => {
    const rt = createMockRuntime({
      staff: { role: "platform_owner", isActive: true, mfaRequired: true },
      user: { twoFactorEnabled: true },
      twoFactorRecord: { verified: true },
    });

    const res = await assertPlatformStaff(rt, userId);
    expect(res).toEqual({ role: "platform_owner" });
  });

  it("isolates user holding both store owner and platform staff roles", async () => {
    // Dual-role user: holds store ownership and platform_admin
    // If MFA is not verified, they cannot reach platform routes even if logged in to their store
    const rtUnverifiedMfa = createMockRuntime({
      staff: { role: "platform_admin", isActive: true, mfaRequired: true },
      user: { twoFactorEnabled: false },
      twoFactorRecord: null,
    });

    await expect(assertPlatformStaff(rtUnverifiedMfa, userId)).rejects.toThrow(
      "Forbidden: platform staff requires verified MFA",
    );

    // When MFA is verified, platform access is granted with platform role
    const rtVerifiedMfa = createMockRuntime({
      staff: { role: "platform_admin", isActive: true, mfaRequired: true },
      user: { twoFactorEnabled: true },
      twoFactorRecord: { verified: true },
    });

    const staffRes = await assertPlatformStaff(rtVerifiedMfa, userId);
    expect(staffRes.role).toBe("platform_admin");
  });
});
