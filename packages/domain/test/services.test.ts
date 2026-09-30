import { describe, expect, it } from "vitest";
import {
  getStoreSettings,
  updateStoreSettings,
  listMemberships,
  inviteStaff,
  listStoreFeatureFlags,
  listPlatformTenants,
  getPlatformTenant,
  assertPlatformStaff,
} from "../src/index.ts";
import type { Runtime, TenantContext } from "../src/index.ts";
import type { Db } from "@bs/db";

describe("Domain Services", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";
  const ctx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "user-1" },
    roles: ["store_admin"],
    permissions: ["staff.manage", "settings.write"],
    requestId: "req-1",
  };

  const createMockRuntime = (mockDb: Db): Runtime => ({
    service: "web",
    _db: { db: mockDb, pool: {} as never, close: async () => {} },
    close: async () => {},
  });

  describe("Admin Services", () => {
    it("lists store feature flags resolving overrides", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => [
                {
                  key: "multi_currency",
                  defaultOn: false,
                  killSwitch: false,
                },
              ],
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await listStoreFeatureFlags(rt, ctx);

      expect(res).toBeInstanceOf(Array);
    });
  });

  describe("Platform Services", () => {
    it("lists platform tenants across all stores without tenant wrapper", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              orderBy: () => [
                {
                  id: "t-1",
                  slug: "store1",
                  name: "Store 1",
                  status: "active",
                  createdAt: new Date("2026-01-01"),
                },
              ],
            }),
          }),
        }),
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await listPlatformTenants(rt);

      expect(res).toHaveLength(1);
      expect(res[0]?.slug).toBe("store1");
    });

    it("gets platform tenant by id", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: () => [
                  {
                    id: "t-1",
                    slug: "store1",
                    name: "Store 1",
                    status: "active",
                    createdAt: new Date("2026-01-01"),
                  },
                ],
              }),
            }),
          }),
        }),
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await getPlatformTenant(rt, "t-1");

      expect(res.id).toBe("t-1");
      expect(res.slug).toBe("store1");
    });

    it("asserts platform staff member exists and is active", async () => {
      let callCount = 0;
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => {
                callCount++;
                if (callCount === 1) return [{ role: "platform_admin", isActive: true, mfaRequired: true }];
                if (callCount === 2) return [{ twoFactorEnabled: true }];
                return [{ verified: true }];
              },
            }),
          }),
        }),
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await assertPlatformStaff(rt, "staff-user-1");

      expect(res.role).toBe("platform_admin");
    });

    it("rejects non-platform staff", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => [],
            }),
          }),
        }),
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      await expect(assertPlatformStaff(rt, "unauthorized-user")).rejects.toThrow(/forbidden/i);
    });

    it("rejects admin procedures when required permission is missing", async () => {
      const unprivilegedCtx: TenantContext = {
        ...ctx,
        permissions: ["products.read"], // lacks staff.manage and settings.write
      };
      const mockDb = {} as Db;
      const rt = createMockRuntime(mockDb);

      await expect(listMemberships(rt, unprivilegedCtx)).rejects.toThrow(/missing required permission 'staff\.manage'/);
      await expect(inviteStaff(rt, unprivilegedCtx, { email: "a@b.com", roleId: "r1" })).rejects.toThrow(/missing required permission 'staff\.manage'/);
      await expect(getStoreSettings(rt, unprivilegedCtx)).rejects.toThrow(/missing required permission 'settings\.write'/);
      await expect(updateStoreSettings(rt, unprivilegedCtx, { storeName: "X" })).rejects.toThrow(/missing required permission 'settings\.write'/);
      await expect(listStoreFeatureFlags(rt, unprivilegedCtx)).rejects.toThrow(/missing required permission 'settings\.write'/);
    });
  });
});
