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
    requestId: "req-1",
  };

  const createMockRuntime = (mockDb: Db): Runtime => ({
    service: "web",
    _db: { db: mockDb, pool: {} as never, close: async () => {} },
    close: async () => {},
  });

  describe("Admin Services", () => {
    it("lists memberships within tenant isolation wrapper", async () => {
      let tenantSet: string | null = null;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {
              tenantSet = tenantId;
            },
            select: () => ({
              from: () => [
                {
                  id: "m-1",
                  userId: "u-1",
                  roleId: "r-1",
                  status: "active",
                  createdAt: new Date("2026-01-01"),
                },
              ],
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await listMemberships(rt, ctx);

      expect(res).toHaveLength(1);
      expect(res[0]?.id).toBe("m-1");
      expect(tenantSet).toBe(tenantId);
    });

    it("invites staff within tenant isolation wrapper", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            insert: () => ({
              values: (vals: { email: string; roleId: string; expiresAt: Date }) => ({
                returning: () => [
                  {
                    id: "invite-1",
                    email: vals.email,
                    roleId: vals.roleId,
                    expiresAt: vals.expiresAt,
                  },
                ],
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await inviteStaff(rt, ctx, {
        email: "staff@example.com",
        roleId: "0199a000-0000-7000-8000-000000000002",
      });

      expect(res.id).toBe("invite-1");
      expect(res.email).toBe("staff@example.com");
    });

    it("gets store settings fallback when empty", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                limit: () => [],
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await getStoreSettings(rt, ctx);

      expect(res.tenantId).toBe(tenantId);
      expect(res.storeName).toBe("Default Store");
    });

    it("updates store settings", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                limit: () => [
                  {
                    tenantId,
                    storeName: "Old",
                    currency: "NPR",
                    timezone: "Asia/Kathmandu",
                  },
                ],
              }),
            }),
            update: () => ({
              set: (vals: { storeName?: string }) => ({
                returning: () => [
                  {
                    tenantId,
                    storeName: vals.storeName,
                    currency: "NPR",
                    timezone: "Asia/Kathmandu",
                  },
                ],
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await updateStoreSettings(rt, ctx, { storeName: "New Name" });

      expect(res.storeName).toBe("New Name");
    });

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
          from: () => [
            {
              id: "t-1",
              slug: "store1",
              name: "Store 1",
              status: "active",
              createdAt: new Date("2026-01-01"),
            },
          ],
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
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await getPlatformTenant(rt, "t-1");

      expect(res.id).toBe("t-1");
      expect(res.slug).toBe("store1");
    });

    it("asserts platform staff member exists and is active", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => [
                {
                  role: "platform_admin",
                  isActive: true,
                },
              ],
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
  });
});
