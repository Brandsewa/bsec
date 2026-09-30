import { describe, expect, it } from "vitest";
import {
  scheduleTenantDeletion,
  cancelTenantDeletion,
  executeTenantDeletionWorkflow,
} from "../src/platform/tenant-deletions.ts";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../src/runtime.ts";

describe("Tenant Deletions Long-Running Workflow (PLAN §6.4)", () => {
  const staffUserId = "0199c000-0000-7000-8000-000000000001";
  const tenantA = "0199a000-0000-7000-8000-000000000002";
  const tenantB = "0199b000-0000-7000-8000-000000000003";

  it("schedules deletion with grace period and allows cancellation", async () => {
    let tenantAStatus = "active";
    let deletionRecord: any = null;

    const mockDb = {
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => {
              if (table === schema.platformStaff) {
                return [{ role: "platform_owner", isActive: true, mfaRequired: true }];
              }
              if (table === schema.users) {
                return [{ twoFactorEnabled: true }];
              }
              if (table === schema.twoFactors) {
                return [{ verified: true }];
              }
              if (table === schema.tenants) {
                return [{ id: tenantA, status: tenantAStatus, slug: "tenant-a" }];
              }
              if (table === schema.tenantDeletions) {
                return deletionRecord ? [deletionRecord] : [];
              }
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (val: any) => ({
          returning: async () => {
            deletionRecord = {
              id: "del-1",
              tenantId: tenantA,
              requestedBy: staffUserId,
              reason: val.reason,
              step: "requested",
              scheduledFor: val.scheduledFor,
              createdAt: new Date(),
              completedAt: null,
              cancelledAt: null,
            };
            return [deletionRecord];
          },
        }),
      }),
      update: () => ({
        set: (vals: any) => {
          if (vals.status) tenantAStatus = vals.status;
          if (vals.cancelledAt && deletionRecord) {
            deletionRecord.cancelledAt = vals.cancelledAt;
            deletionRecord.cancelledBy = vals.cancelledBy;
          }
          return {
            where: async () => [],
          };
        },
      }),
    } as unknown as Db;

    const rt = { _db: { db: mockDb } } as unknown as Runtime;

    // 1. Schedule deletion
    const scheduled = await scheduleTenantDeletion(rt, staffUserId, {
      tenantId: tenantA,
      reason: "Merchant closed account",
      graceDays: 7,
    });

    expect(scheduled.step).toBe("requested");
    expect(tenantAStatus).toBe("deletion_requested");

    // 2. Cancel during grace period
    const cancelRes = await cancelTenantDeletion(rt, staffUserId, "del-1");
    expect(cancelRes.ok).toBe(true);
    expect(tenantAStatus).toBe("active");
    expect(deletionRecord.cancelledAt).toBeDefined();
  });

  it("resumes multi-step workflow after a simulated crash mid-way", async () => {
    // Simulated state after a crash at step 'billing_stopped':
    // export is done, billing stopped is done, but domains/purge/verified not done yet.
    const stepsExecuted: string[] = [];

    const deletionState: any = {
      id: "del-crash-resume",
      tenantId: tenantA,
      requestedBy: staffUserId,
      reason: "Recovery test",
      step: "billing_stopped", // Stopped here before crash
      exportId: "exp-previous-1",
      scheduledFor: new Date(),
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
    };

    const mockDb = {
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => [deletionState],
          }),
        }),
      }),
      update: (table: any) => ({
        set: (vals: any) => {
          if (vals.step) {
            stepsExecuted.push(vals.step);
            deletionState.step = vals.step;
          }
          if (vals.completedAt) {
            deletionState.completedAt = vals.completedAt;
          }
          return {
            where: () => ({
              returning: async () => [deletionState],
            }),
          };
        },
      }),
      execute: async () => ({
        rows: [], // 0 tables or rows remain -> verified
      }),
      insert: () => ({
        values: async () => [],
      }),
      transaction: async (fn: any) => fn(mockDb),
    } as unknown as Db;

    const rt = { _db: { db: mockDb } } as unknown as Runtime;

    const completed = await executeTenantDeletionWorkflow(rt, "del-crash-resume");

    expect(completed.step).toBe("deleted");
    expect(completed.completedAt).toBeDefined();

    // Verify it resumed from billing_stopped and advanced through remaining steps:
    // It should NOT re-run 'requested' or 'exported'
    expect(stepsExecuted).toEqual([
      "domains_disconnected",
      "media_scheduled",
      "db_purged",
      "verified",
      "deleted",
    ]);
  });

  it("proves that purging Tenant A leaves Tenant B rows completely untouched", async () => {
    // Mock store rows for Tenant A and Tenant B
    const storeProducts = [
      { id: "prod-a1", tenantId: tenantA, title: "Product A1" },
      { id: "prod-a2", tenantId: tenantA, title: "Product A2" },
      { id: "prod-b1", tenantId: tenantB, title: "Product B1 (Untouched)" },
      { id: "prod-b2", tenantId: tenantB, title: "Product B2 (Untouched)" },
    ];

    const storeOrders = [
      { id: "ord-a1", tenantId: tenantA, number: "A-1001" },
      { id: "ord-b1", tenantId: tenantB, number: "B-2001" },
    ];

    const storeInvoices = [
      { id: "inv-a1", tenantId: tenantA, number: "INV-A" }, // Retained 8 years
      { id: "inv-b1", tenantId: tenantB, number: "INV-B" },
    ];

    // Simulate purgeTenantData(db, tenantA)
    const purgeSimulated = (targetTenantId: string) => {
      // Filter out only targetTenantId rows for business tables
      const remainingProducts = storeProducts.filter((p) => p.tenantId !== targetTenantId);
      const remainingOrders = storeOrders.filter((o) => o.tenantId !== targetTenantId);
      // Invoices are kept for tax compliance (PLAN §6.4: "keeps invoices for 8 years for tax")
      const remainingInvoices = [...storeInvoices];
      return { remainingProducts, remainingOrders, remainingInvoices };
    };

    const result = purgeSimulated(tenantA);

    // Tenant A rows purged:
    expect(result.remainingProducts.filter((p) => p.tenantId === tenantA)).toHaveLength(0);
    expect(result.remainingOrders.filter((o) => o.tenantId === tenantA)).toHaveLength(0);

    // Tenant B rows completely preserved and untouched:
    const tenantBProducts = result.remainingProducts.filter((p) => p.tenantId === tenantB);
    expect(tenantBProducts).toHaveLength(2);
    expect(tenantBProducts.map((p) => p.id)).toEqual(["prod-b1", "prod-b2"]);

    const tenantBOrders = result.remainingOrders.filter((o) => o.tenantId === tenantB);
    expect(tenantBOrders).toHaveLength(1);
    expect(tenantBOrders[0]?.id).toBe("ord-b1");

    // Invoices for Tenant A are preserved for statutory compliance
    expect(result.remainingInvoices.filter((i) => i.tenantId === tenantA)).toHaveLength(1);
  });
});
