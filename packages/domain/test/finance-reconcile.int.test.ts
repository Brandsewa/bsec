import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  deepSweepWindow,
  reconcileTenant,
  runFinanceReconcileSweep,
} from "../src/finance/index.ts";

let env: TestDb;
let dbRw: DbHandle;

const orgId = "0199a0e3-0000-7000-8000-000000000000";
const tenantId = "0199a0e3-0000-7000-8000-000000000001";
const orderId1 = "0199a0e3-0000-7000-8000-000000000010";
const orderId2 = "0199a0e3-0000-7000-8000-000000000020";

beforeAll(async () => {
  env = await startTestDb();
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });

  // Insert tenant
  await dbRw.db.insert(schema.organizations).values({
    id: orgId,
    name: "Finance Test Org",
  }).onConflictDoNothing();

  await dbRw.db.insert(schema.tenants).values({
    id: tenantId,
    organizationId: orgId,
    slug: "reconcile-test-store",
    name: "Reconcile Test Store",
    status: "active",
  }).onConflictDoNothing();

  // Seed two delivered orders
  await withTenant(dbRw.db, tenantId, async (tx) => {
    await tx.insert(schema.orders).values([
      {
        id: orderId1,
        tenantId,
        number: "REC-001",
        email: "rec1@example.com",
        phone: "+919988776655",
        status: "delivered",
        paymentStatus: "paid",
        subtotal: 100000,
        discountTotal: 0,
        shippingTotal: 10000,
        taxTotal: 18000,
        grandTotal: 128000,
        currency: "INR",
        shippingAddress: { city: "Delhi" },
      },
      {
        id: orderId2,
        tenantId,
        number: "REC-002",
        email: "rec2@example.com",
        phone: "+919988776655",
        status: "delivered",
        paymentStatus: "paid",
        subtotal: 50000,
        discountTotal: 0,
        shippingTotal: 5000,
        taxTotal: 9000,
        grandTotal: 64000,
        currency: "INR",
        shippingAddress: { city: "Mumbai" },
      },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await dbRw?.close();
});

describe("Finance Reconcile Service", () => {
  it("deepSweepWindow generates deterministic 30-day slices", () => {
    const fixedDate = new Date("2026-10-05T12:00:00Z");
    const win = deepSweepWindow(fixedDate);
    expect(win.since).toBeInstanceOf(Date);
    expect(win.until).toBeInstanceOf(Date);
    expect(win.until.getTime() - win.since.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("first reconcile run backfills all historical orders", async () => {
    const res = await reconcileTenant(dbRw.db, tenantId, { fullBackfill: true });
    expect(res.written).toBeGreaterThan(0);
    expect(res.scanned.orders).toBeGreaterThanOrEqual(2);

    // Verify rows exist in ledger
    const rows = await withTenant(dbRw.db, tenantId, async (tx) => {
      return await tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.tenantId, tenantId));
    });
    expect(rows.length).toBe(res.written);
  });

  it("healthy replay writes zero new entries", async () => {
    const res = await reconcileTenant(dbRw.db, tenantId, { fullBackfill: true });
    expect(res.written).toBe(0);
    expect(res.scanned.orders).toBeGreaterThanOrEqual(2);
  });

  it("repairs missing entry when a ledger row was missing or deleted", async () => {
    // Manually delete one ledger entry (simulating a gap or missing write)
    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx
        .delete(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.key, "order:" + orderId1 + ":revenue"),
          ),
        );
    });

    // Reconcile pass should detect and heal the missing row
    const res = await reconcileTenant(dbRw.db, tenantId, { fullBackfill: true });
    expect(res.written).toBe(1);

    // Verify row is back
    const [healed] = await withTenant(dbRw.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.key, "order:" + orderId1 + ":revenue"),
          ),
        );
    });
    expect(healed).toBeDefined();
    expect(healed?.key).toBe("order:" + orderId1 + ":revenue");
  });

  it("runFinanceReconcileSweep runs across tenants without throwing", async () => {
    const logs: string[] = [];
    const mockLog = {
      info: (_obj: object, msg?: string) => logs.push(`INFO: ${msg}`),
      warn: (_obj: object, msg?: string) => logs.push(`WARN: ${msg}`),
    };

    const res = await runFinanceReconcileSweep(dbRw.db, mockLog, { fullBackfill: true });
    expect(res.tenantsProcessed).toBeGreaterThanOrEqual(1);
  });
});
