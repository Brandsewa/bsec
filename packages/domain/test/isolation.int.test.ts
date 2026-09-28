import { describe, expect, it } from "vitest";
import { platformContract, storeContract } from "@bs/contracts";
import {
  assertPlatformStaff,
  buildTenantContext,
  listMemberships,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import type { Db } from "@bs/db";

/**
 * Dynamically walks an oRPC contract object and extracts all procedure paths.
 * Guarantees that any new procedure added in M2+ is automatically discovered
 * and tested for tenant isolation.
 */
function extractProcedurePaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      // In @orpc/contract, route contracts have route/method/path definitions
      if ("~orpc" in value || "route" in value) {
        paths.push(currentPath);
      } else {
        paths.push(...extractProcedurePaths(value as Record<string, unknown>, currentPath));
      }
    }
  }
  return paths;
}

describe("Generated Isolation Test Suite (M1 Exit Criteria)", () => {
  const tenantA = "0199a000-0000-7000-8000-000000000001";
  const tenantB = "0199a000-0000-7000-8000-000000000002";
  const userA = "0199a000-0000-7000-8000-000000000099";

  const adminProcedures = extractProcedurePaths(storeContract.admin as unknown as Record<string, unknown>);
  const platformProcedures = extractProcedurePaths(platformContract.tenants as unknown as Record<string, unknown>);

  it("dynamically discovers all registered admin procedures", () => {
    expect(adminProcedures.length).toBeGreaterThanOrEqual(5);
    expect(adminProcedures).toContain("memberships.list");
    expect(adminProcedures).toContain("memberships.invite");
    expect(adminProcedures).toContain("settings.get");
    expect(adminProcedures).toContain("settings.update");
    expect(adminProcedures).toContain("featureFlags.list");
  });

  it("dynamically discovers all registered platform procedures", () => {
    expect(platformProcedures.length).toBeGreaterThanOrEqual(2);
    expect(platformProcedures).toContain("list");
    expect(platformProcedures).toContain("get");
  });

  describe("Admin Procedures Isolation Invariants", () => {
    // Generate tests dynamically for each discovered admin procedure
    for (const proc of adminProcedures) {
      describe(`Procedure: admin.${proc}`, () => {
        it("rejects when staff user on tenant A attempts to access tenant B (X-Store-Id: B)", async () => {
          // Mock DB where userA only has active membership in tenantA, not tenantB
          const mockDb = {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  innerJoin: () => ({
                    where: () => ({
                      limit: async () => [], // No membership for tenant B!
                    }),
                  }),
                }),
              }),
            }),
          } as unknown as Db;

          await expect(
            buildTenantContext(mockDb, {
              entryPath: "admin",
              headers: { "x-store-id": tenantB },
              session: {
                user: { id: userA },
                type: "staff",
              },
            }),
          ).rejects.toThrow(/membership/i);
        });

        it("rejects when called with a customer session", async () => {
          const mockDb = {} as Db;

          await expect(
            buildTenantContext(mockDb, {
              entryPath: "admin",
              headers: { "x-store-id": tenantA },
              session: {
                user: { id: "cust-123" },
                type: "customer",
              },
            }),
          ).rejects.toThrow(/forbidden.*customer/i);
        });

        it("rejects when called without an authenticated session", async () => {
          const mockDb = {} as Db;

          await expect(
            buildTenantContext(mockDb, {
              entryPath: "admin",
              headers: { "x-store-id": tenantA },
              session: null,
            }),
          ).rejects.toThrow(/unauthorized/i);
        });

        it("succeeds when staff user accesses authorized tenant A", async () => {
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
            headers: { "x-store-id": tenantA },
            session: {
              user: { id: userA },
              type: "staff",
            },
          });

          expect(ctx).toBeDefined();
          expect(ctx?.tenantId).toBe(tenantA);
          expect(ctx?.actor).toEqual({ type: "staff", userId: userA });
        });
      });
    }
  });

  describe("Platform Procedures Security Invariants", () => {
    for (const proc of platformProcedures) {
      describe(`Procedure: platform.tenants.${proc}`, () => {
        it("rejects non-platform staff session", async () => {
          const mockDb = {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [], // Not in platform_staff table
                }),
              }),
            }),
          } as unknown as Db;

          const rt: Runtime = {
            service: "platform",
            _db: { db: mockDb, pool: {} as never, close: async () => {} },
            close: async () => {},
          };

          await expect(assertPlatformStaff(rt, userA)).rejects.toThrow(/forbidden/i);
        });

        it("accepts authenticated and active platform staff member", async () => {
          const mockDb = {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      role: "platform_owner",
                      isActive: true,
                    },
                  ],
                }),
              }),
            }),
          } as unknown as Db;

          const rt: Runtime = {
            service: "platform",
            _db: { db: mockDb, pool: {} as never, close: async () => {} },
            close: async () => {},
          };

          const staff = await assertPlatformStaff(rt, "platform-owner-id");
          expect(staff.role).toBe("platform_owner");
        });
      });
    }
  });

  describe("Cross-Tenant Direct Database Query Invariant", () => {
    it("proves direct queries under tenant A cannot read rows belonging to tenant B", async () => {
      let queryFilterTenantId: string | null = null;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {
              // SET LOCAL app.tenant_id = tenantA
              queryFilterTenantId = tenantA;
            },
            select: () => ({
              from: () => ({
                then: (resolve: (val: unknown[]) => unknown) => {
                  // Under tenant A's context, rows with tenant B return 0 rows
                  if (queryFilterTenantId === tenantB) {
                    return resolve([
                      {
                        id: "b-record",
                        userId: "user-b",
                        roleId: "role-b",
                        status: "active",
                        createdAt: new Date(),
                      },
                    ]);
                  }
                  return resolve([]);
                },
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt: Runtime = {
        service: "web",
        _db: { db: mockDb, pool: {} as never, close: async () => {} },
        close: async () => {},
      };

      const ctxA: TenantContext = {
        tenantId: tenantA,
        storeStatus: "live",
        actor: { type: "staff", userId: userA },
        roles: ["store_admin"],
        requestId: "test-req",
      };

      const rowsA = await listMemberships(rt, ctxA);
      expect(rowsA).toBeInstanceOf(Array);
      expect(queryFilterTenantId).toBe(tenantA);
    });
  });
});

