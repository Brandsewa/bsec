import { beforeEach, describe, expect, it } from "vitest";
import { buildTenantContext } from "../src/context.ts";
import { invalidateHostCache } from "../src/host-resolver.ts";
import type { Db } from "@bs/db";

describe("buildTenantContext()", () => {
  beforeEach(() => {
    invalidateHostCache();
  });

  const tenantId = "0199a000-0000-7000-8000-000000000001";
  const userId = "0199a000-0000-7000-8000-000000000099";

  const createMockDb = (opts: {
    domainResult?: { tenantId: string; domainStatus: string; tenantStatus: string } | null;
    membershipResult?: { status: string; roleName: string; tenantStatus: string } | null;
  }) => {
    return {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => {
                if (opts.domainResult) return [opts.domainResult];
                return [];
              },
            }),
            innerJoin: () => ({
              where: () => ({
                limit: async () => {
                  if (opts.membershipResult) return [opts.membershipResult];
                  return [];
                },
              }),
            }),
          }),
          where: () => ({
            limit: async () => {
              if (opts.membershipResult) return [opts.membershipResult];
              return [];
            },
          }),
        }),
      }),
    } as unknown as Db;
  };

  describe("Storefront entry path", () => {
    it("resolves tenant from Host header for anonymous visitor", async () => {
      const mockDb = createMockDb({
        domainResult: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "active",
        },
      });

      const ctx = await buildTenantContext(mockDb, {
        entryPath: "storefront",
        headers: {
          host: "alpha.gobs.cloud",
          "x-request-id": "req-12345",
        },
      });

      expect(ctx).toEqual({
        tenantId,
        storeStatus: "live",
        actor: { type: "anonymous" },
        roles: [],
        permissions: [],
        requestId: "req-12345",
      });
    });

    it("resolves customer actor when customer session is provided", async () => {
      const mockDb = createMockDb({
        domainResult: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "active",
        },
      });

      const ctx = await buildTenantContext(mockDb, {
        entryPath: "storefront",
        headers: { host: "alpha.gobs.cloud" },
        session: {
          user: { id: "cust-99" },
          type: "customer",
        },
      });

      expect(ctx).not.toBeNull();
      expect(ctx?.actor).toEqual({ type: "customer", customerId: "cust-99" });
      expect(ctx?.requestId).toBeDefined();
    });

    it("never takes tenant from X-Store-Id in storefront mode", async () => {
      const mockDb = createMockDb({
        domainResult: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "active",
        },
      });

      const ctx = await buildTenantContext(mockDb, {
        entryPath: "storefront",
        headers: {
          host: "alpha.gobs.cloud",
          "x-store-id": "0199a999-9999-7000-8000-999999999999", // Malicious / mismatch header
        },
      });

      expect(ctx?.tenantId).toBe(tenantId); // Must match domain, not header
    });

    it("returns null if host cannot be resolved", async () => {
      const mockDb = createMockDb({ domainResult: null });

      const ctx = await buildTenantContext(mockDb, {
        entryPath: "storefront",
        headers: { host: "unknown.gobs.cloud" },
      });

      expect(ctx).toBeNull();
    });
  });

  describe("Admin entry path", () => {
    it("resolves staff actor with roles when active membership exists for X-Store-Id", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      membershipStatus: "active",
                      roleName: "store_admin",
                      permissions: ["staff.manage", "settings.write"],
                      tenantStatus: "active",
                    },
                  ],
                }),
              }),
            }),
          }),
        }),
      } as unknown as Db;

      const ctx = await buildTenantContext(mockDb, {
        entryPath: "admin",
        headers: {
          "x-store-id": tenantId,
          "x-request-id": "admin-req-1",
        },
        session: {
          user: { id: userId },
          type: "staff",
        },
      });

      expect(ctx).toEqual({
        tenantId,
        storeStatus: "live",
        actor: { type: "staff", userId },
        roles: ["store_admin"],
        permissions: ["staff.manage", "settings.write"],
        requestId: "admin-req-1",
      });
    });

    it("rejects if no session is provided", async () => {
      const mockDb = {} as Db;

      await expect(
        buildTenantContext(mockDb, {
          entryPath: "admin",
          headers: { "x-store-id": tenantId },
          session: null,
        }),
      ).rejects.toThrow(/unauthorized/i);
    });

    it("rejects if session is a customer session", async () => {
      const mockDb = {} as Db;

      await expect(
        buildTenantContext(mockDb, {
          entryPath: "admin",
          headers: { "x-store-id": tenantId },
          session: {
            user: { id: "cust-1" },
            type: "customer",
          },
        }),
      ).rejects.toThrow(/forbidden.*customer/i);
    });

    it("rejects if X-Store-Id header is missing", async () => {
      const mockDb = {} as Db;

      await expect(
        buildTenantContext(mockDb, {
          entryPath: "admin",
          headers: {},
          session: {
            user: { id: userId },
            type: "staff",
          },
        }),
      ).rejects.toThrow(/x-store-id/i);
    });

    it("rejects if user has no active membership for the requested store", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: async () => [], // No membership row
                }),
              }),
            }),
          }),
        }),
      } as unknown as Db;

      await expect(
        buildTenantContext(mockDb, {
          entryPath: "admin",
          headers: { "x-store-id": tenantId },
          session: {
            user: { id: userId },
            type: "staff",
          },
        }),
      ).rejects.toThrow(/membership/i);
    });
  });
});
