import { describe, expect, it } from "vitest";
import {
  startSupportSession,
  extendSupportSession,
  confirmSupportSessionWriteAccess,
  endSupportSession,
  validateSupportSessionToken,
} from "../src/platform/support-sessions.ts";
import { setMemberRole, inviteStaff, removeMember } from "../src/admin/team.ts";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../src/runtime.ts";
import type { TenantContext } from "../src/context.ts";

describe("Support Sessions Impersonation & Escalation Guards (PLAN §6.3)", () => {
  const tenantA = "0199a000-0000-7000-8000-000000000001";
  const tenantB = "0199b000-0000-7000-8000-000000000002";
  const staffUserId = "0199c000-0000-7000-8000-000000000003";

  it("validates that support session token cannot cross tenants", async () => {
    const validUntil = new Date(Date.now() + 3600_000);
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                id: "sess-1",
                token: "sup_validtoken123",
                tenantId: tenantA, // Authorized ONLY for tenantA
                platformUserId: staffUserId,
                scope: "read_only",
                reason: "Investigating checkout bug",
                ticketRef: "TICKET-101",
                expiresAt: validUntil,
                endedAt: null,
                actionsCount: 0,
              },
            ],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
    } as unknown as Db;

    // Tenant A matches session -> valid
    const validRes = await validateSupportSessionToken(mockDb, "sup_validtoken123", tenantA);
    expect(validRes.valid).toBe(true);
    expect(validRes.sessionId).toBe("sess-1");

    // Tenant B attempts to use Tenant A's token -> FORBIDDEN cross-tenant rejection
    await expect(
      validateSupportSessionToken(mockDb, "sup_validtoken123", tenantB),
    ).rejects.toThrow("Forbidden: support session is not authorized for this store");
  });

  it("rejects expired support sessions", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [], // where query filters expiresAt > now(), returning 0 rows
          }),
        }),
      }),
    } as unknown as Db;

    await expect(
      validateSupportSessionToken(mockDb, "sup_expired", tenantA),
    ).rejects.toThrow("Unauthorized: invalid or expired support session token");
  });

  describe("Role Escalation Prevention (PLAN §4 / M9)", () => {
    it("prevents store_admin from assigning store_owner or store_admin roles", async () => {
      // Context has role store_admin (holds staff.manage, but is NOT store_owner)
      const adminCtx: TenantContext = {
        tenantId: tenantA,
        storeStatus: "live",
        actor: { type: "staff", userId: "staff-admin-1" },
        roles: ["store_admin"],
        permissions: ["staff.manage"],
        requestId: "req-1",
      };

      const mockDb = {
        transaction: async (fn: any) => {
          const tx = {
            execute: async () => ({ rows: [] }),
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: async () => [{ id: "mem-1", roleName: "store_staff" }],
                  }),
                }),
                where: () => ({
                  limit: async () => [{ id: "role-admin", name: "store_admin" }], // Trying to elevate to admin
                }),
              }),
            }),
          };
          return fn(tx);
        },
      } as unknown as Db;

      const rt = {
        _db: { db: mockDb },
      } as unknown as Runtime;

      await expect(
        setMemberRole(rt, adminCtx, { id: "mem-1", roleId: "role-admin" }),
      ).rejects.toThrow("Forbidden: only store owners can assign or modify owner and admin roles");
    });

    it("prevents store_admin from inviting store_owner or store_admin members", async () => {
      const adminCtx: TenantContext = {
        tenantId: tenantA,
        storeStatus: "live",
        actor: { type: "staff", userId: "staff-admin-1" },
        roles: ["store_admin"],
        permissions: ["staff.manage"],
        requestId: "req-2",
      };

      const mockDb = {
        execute: async () => ({ rows: [{ tier: "S" }] }),
        transaction: async (fn: any) => {
          const tx = {
            execute: async () => ({ rows: [] }),
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [{ id: "role-owner", name: "store_owner" }], // Inviting as owner
                }),
              }),
            }),
          };
          return fn(tx);
        },
      } as unknown as Db;

      const rt = {
        _db: { db: mockDb },
      } as unknown as Runtime;

      await expect(
        inviteStaff(rt, adminCtx, { email: "newowner@test.local", roleId: "role-owner" }),
      ).rejects.toThrow("Forbidden: only store owners can invite owner or admin members");
    });

    it("prevents store_admin from removing store_owner or store_admin members", async () => {
      const adminCtx: TenantContext = {
        tenantId: tenantA,
        storeStatus: "live",
        actor: { type: "staff", userId: "staff-admin-1" },
        roles: ["store_admin"],
        permissions: ["staff.manage"],
        requestId: "req-3",
      };

      const mockDb = {
        transaction: async (fn: any) => {
          const tx = {
            execute: async () => ({ rows: [] }),
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: async () => [{ id: "mem-target", userId: "u-owner", roleName: "store_owner" }],
                  }),
                }),
              }),
            }),
          };
          return fn(tx);
        },
      } as unknown as Db;

      const rt = {
        _db: { db: mockDb },
      } as unknown as Runtime;

      await expect(
        removeMember(rt, adminCtx, { id: "mem-target" }),
      ).rejects.toThrow("Forbidden: only store owners can remove owner or admin members");
    });
  });
});
