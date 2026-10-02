import { beforeEach, describe, expect, it } from "vitest";
import { invalidateHostCache, resolveHostToTenant } from "../src/host-resolver.ts";
import type { Db } from "@bs/db";

describe("resolveHostToTenant()", () => {
  beforeEach(() => {
    invalidateHostCache();
  });

  it("resolves active domain and tenant, and caches for subsequent calls", async () => {
    const tenantId = "0199a000-0000-7000-8000-000000000001";
    let queryCount = 0;

    const mockDb = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => {
                queryCount++;
                return [
                  {
                    tenantId,
                    domainStatus: "active",
                    tenantStatus: "active",
                  },
                ];
              },
            }),
          }),
        }),
      }),
    } as unknown as Db;

    // First call: hits DB
    const res1 = await resolveHostToTenant(mockDb, "alpha.bcom.si:3000");
    expect(res1).toEqual({ tenantId, tenantStatus: "active" });
    expect(queryCount).toBe(1);

    // Second call with different casing/port: cache hit, no DB query
    const res2 = await resolveHostToTenant(mockDb, "ALPHA.bcom.si");
    expect(res2).toEqual({ tenantId, tenantStatus: "active" });
    expect(queryCount).toBe(1);

    // Invalidate cache
    invalidateHostCache("alpha.bcom.si");

    // Third call: hits DB again
    const res3 = await resolveHostToTenant(mockDb, "alpha.bcom.si");
    expect(res3).toEqual({ tenantId, tenantStatus: "active" });
    expect(queryCount).toBe(2);
  });

  it("returns null for non-existent domain", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
        }),
      }),
    } as unknown as Db;

    const res = await resolveHostToTenant(mockDb, "unknown.bcom.si");
    expect(res).toBeNull();
  });

  it("returns null for inactive domain", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => [
                {
                  tenantId: "0199a000-0000-7000-8000-000000000001",
                  domainStatus: "awaiting_dns",
                  tenantStatus: "active",
                },
              ],
            }),
          }),
        }),
      }),
    } as unknown as Db;

    const res = await resolveHostToTenant(mockDb, "pending.bcom.si");
    expect(res).toBeNull();
  });

  it("returns suspended tenant status", async () => {
    const tenantId = "0199a000-0000-7000-8000-000000000001";
    const mockDb = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => [
                {
                  tenantId,
                  domainStatus: "active",
                  tenantStatus: "suspended",
                },
              ],
            }),
          }),
        }),
      }),
    } as unknown as Db;

    const res = await resolveHostToTenant(mockDb, "suspended.bcom.si");
    expect(res).toEqual({ tenantId, tenantStatus: "suspended" });
  });
});
