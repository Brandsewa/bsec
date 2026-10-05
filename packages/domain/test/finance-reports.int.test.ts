/**
 * Integration Test: Finance reports, period close and permissions on real PostgreSQL (docs/FINANCE-PLAN.md §3.6, §3.9).
 *
 * Seeds a tax-inclusive COD order (the shape real checkout produces: grandTotal = subtotal - discount + shipping)
 * and asserts the overview figures to the paisa, then walks month-end close, the closed-period shift and reopen.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime } from "../src/runtime.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import { createAdminDraftOrder } from "../src/index.ts";
import type { TenantContext } from "../src/context.ts";
import {
  closeFiscalPeriod,
  createAdjustment,
  getFinanceOverview,
  handleFinancePost,
  listFiscalPeriods,
  reopenFiscalPeriod,
} from "../src/finance/index.ts";

let env: TestDb;
let dbRw: DbHandle;
let tenantId: string;
let ctx: TenantContext;
let rtApp: ReturnType<typeof createRuntime>;

const productId = crypto.randomUUID();
const variantId = crypto.randomUUID();
const orderCosted = crypto.randomUUID();
const orderUncosted = crypto.randomUUID();

beforeAll(async () => {
  env = await startTestDb();
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const rand = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: "Finance Reports Store",
    slug: `fin-rep-${rand}`,
    owner: { email: `owner-${rand}@finance-reports.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
  rtApp = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  ctx = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "0199a0e5-0000-7000-8000-000000000001" },
    roles: ["owner"],
    permissions: ["finance.read", "finance.write", "orders.read", "orders.write", "products.read", "products.write"],
    requestId: "req-reports",
  } as unknown as TenantContext;

  await withTenant(dbRw.db, tenantId, async (tx) => {
    await tx.insert(schema.products).values({ id: productId, tenantId, title: "Scarf", slug: "scarf", status: "active" });
    await tx.insert(schema.variants).values({
      id: variantId, tenantId, productId, sku: "SC-1", title: "Red", price: 250000n, costPrice: 100000n, trackInventory: true,
    });

    const placed = new Date("2026-08-15T10:00:00.000Z");
    // Tax-inclusive: 2 x 2,500 = 5,000 incl. 5% GST (23,810 paise); shipping 200; grand = 5,200.
    const mk = async (id: string, number: string, withCost: boolean) => {
      await tx.insert(schema.orders).values({
        id, tenantId, number, email: `${number}@example.com`, phone: "+919988776655",
        status: "delivered", paymentStatus: "cod_collected", fulfillmentStatus: "delivered",
        subtotal: 500000, discountTotal: 0, shippingTotal: 20000, taxTotal: 23810, grandTotal: 520000,
        currency: "INR", shippingAddress: { city: "Pune" }, createdAt: placed, updatedAt: placed,
      } as never);
      await tx.insert(schema.paymentIntents).values({
        tenantId, orderId: id, provider: "cod", amount: 520000, currency: "INR", status: "cod_collected",
      });
      await tx.insert(schema.orderItems).values({
        tenantId, orderId: id, variantId, productTitle: "Scarf", variantTitle: "Red", sku: "SC-1",
        quantity: 2, unitPrice: 250000, total: 500000, costPrice: withCost ? 100000 : null,
        cgst: 11905, sgst: 11905, igst: 0, taxRateBps: 500,
      } as never);
    };
    await mk(orderCosted, "REP-1", true);
    await mk(orderUncosted, "REP-2", false);
    await handleFinancePost(tx, tenantId, { kind: "order", id: orderCosted });
    await handleFinancePost(tx, tenantId, { kind: "order", id: orderUncosted });
  });
}, 180_000);

afterAll(async () => {
  await dbRw?.close();
});

describe("Finance overview figures", () => {
  it("matches a seeded tax-inclusive scenario to the paisa", async () => {
    const o = await getFinanceOverview(dbRw, ctx, { named: "all" });

    // Each order: revenue = 500000 - 23810 (tax is inside the subtotal), shipping 20000.
    expect(o.profitAndLoss.totalIncomePaise).toBe(2 * (476190 + 20000));
    // COGS only for the costed order: 2 x 100000.
    expect(o.profitAndLoss.totalExpensePaise).toBe(200000);
    expect(o.profitAndLoss.netProfitPaise).toBe(2 * 496190 - 200000);

    // Cash collected equals the two grand totals; tax is owed onward; stock goes negative until purchases are booked.
    const bal = (a: string) => o.cashPosition.assets.find((x) => x.account === a)?.balancePaise;
    expect(bal("cash_on_hand")).toBe(2 * 520000);
    expect(o.owed.youOweTaxPaise).toBe(2 * 23810);
    expect(o.taxSummary.taxCollectedPaise).toBe(2 * 23810);
    expect(o.taxSummary.taxOwedPaise).toBe(2 * 23810);

    // GST split is read from the order lines.
    const aug = o.taxSummary.gstMonthlyBreakdown.find((m) => m.month === "2026-08");
    expect(aug?.cgstPaise).toBe(2 * 11905);
    expect(aug?.sgstPaise).toBe(2 * 11905);
    expect(aug?.totalTaxPaise).toBe(2 * 23810);

    // Half the revenue has no cost snapshot: the report must say so instead of showing a 100% margin.
    expect(o.costCoverage.revenueUncostedPaise).toBeGreaterThan(0);
    expect(o.costCoverage.revenueCostedPaise).toBeGreaterThan(0);
    expect(o.anomalies.length).toBe(0);
  });

  it("is refused without finance.read", async () => {
    const denied = { ...ctx, permissions: [] } as unknown as TenantContext;
    await expect(getFinanceOverview(dbRw, denied, { named: "all" })).rejects.toThrow(/finance\.read/);
  });
});

describe("Month-end close", () => {
  it("closes a finished month with a snapshot, refuses duplicates and open months, shifts late postings, reopens newest only", async () => {
    const closed = await closeFiscalPeriod(dbRw, ctx, { label: "2026-08", note: "reports test" });
    expect(closed.label).toBe("2026-08");
    expect(closed.snapshot).toBeTruthy();

    await expect(closeFiscalPeriod(dbRw, ctx, { label: "2026-08" })).rejects.toThrow(/already closed/i);
    const future = new Date();
    const futureLabel = `${future.getUTCFullYear()}-${String(future.getUTCMonth() + 1).padStart(2, "0")}`;
    await expect(closeFiscalPeriod(dbRw, ctx, { label: futureLabel })).rejects.toThrow(/ongoing or future/i);

    // A posting dated inside the closed month lands just after the boundary with an explanatory note.
    const adj = await createAdjustment(dbRw, ctx, {
      date: "2026-08-20", accountDebit: "cash_bank", accountCredit: "cash_on_hand", amount: 100000, currency: "INR",
      reason: "COD remittance after close",
    });
    expect(adj.date).toBe("2026-09-01");
    expect(adj.note).toMatch(/Dated 2026-08-20, posted after the period close/);

    // Older period cannot be reopened while a newer one is closed.
    const july = await closeFiscalPeriod(dbRw, ctx, { label: "2026-07" });
    expect(july.label).toBe("2026-07");
    await expect(reopenFiscalPeriod(dbRw, ctx, { label: "2026-07", reason: "wrong order" })).rejects.toThrow(/newest closed/i);

    // Reopen newest-first works; shifted entry is not moved back.
    // (2026-08 is newer than 2026-07, so 2026-08 reopens first.)
    const reopened = await reopenFiscalPeriod(dbRw, ctx, { label: "2026-08", reason: "test reopen" });
    expect(reopened.reopenedLabel).toBe("2026-08");
    const still = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.tenantId, tenantId), eq(schema.ledgerEntries.sourceId, adj.sourceId as string))),
    );
    expect(still[0]?.date.toISOString().slice(0, 10)).toBe("2026-09-01");

    const listed = await listFiscalPeriods(dbRw, ctx);
    expect(listed.items.map((p) => p.label)).toEqual(["2026-07"]);
  });

  it("period close and reopen need finance.write", async () => {
    const readOnly = { ...ctx, permissions: ["finance.read"] } as unknown as TenantContext;
    await expect(closeFiscalPeriod(dbRw, readOnly, { label: "2026-06" })).rejects.toThrow(/finance\.write/);
  });
});

describe("Cost snapshot on order creation", () => {
  it("admin manual orders snapshot the variant cost on every line", async () => {
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const [loc] = await tx.select({ id: schema.locations.id }).from(schema.locations).limit(1);
      await tx.insert(schema.inventoryLevels).values({ tenantId, variantId, locationId: loc!.id, onHand: 50 }).onConflictDoNothing();
    });
    const draft = await createAdminDraftOrder(rtApp, ctx, {
      email: "snap@example.com",
      phone: "+919876543210",
      shippingAddress: { line1: "1 MG Road", city: "Pune", stateCode: "MH", pincode: "411001" },
      items: [{ variantId, quantity: 2 }],
    });
    const lines = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, draft.orderId)),
    );
    expect(lines.length).toBe(1);
    expect(Number(lines[0]?.costPrice)).toBe(100000);
  });
});
