import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema, withTenant } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { pino } from "pino";
import type { Runtime } from "../src/runtime.ts";
import type { TenantContext } from "../src/context.ts";
import { generateInvoice, getIndianFinancialYear } from "../src/orders/invoices.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
const logger = pino({ level: "silent" });

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

// Unique fixture prefix for M6 invoice integration tests: 0199a062
const orgId = "0199a062-0000-7000-8000-000000000000";
const tenantId = "0199a062-0000-7000-8000-000000000001";
const productId = "0199a062-0000-7000-8000-000000000002";
const variantId = "0199a062-0000-7000-8000-000000000003";
const locationId = "0199a062-0000-7000-8000-000000000010";

let rt: Runtime;
const ctx: TenantContext = {
  tenantId,
  roles: ["store_owner"],
  permissions: ["orders.read", "orders.write"],
  actor: { type: "staff", userId: "0199a062-0000-7000-8000-000000000099" },
  requestId: "req_invoice_test",
  storeStatus: "live",
};

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 25 });

  rt = {
    _db: rwDb,
    log: logger,
  } as unknown as Runtime;

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM invoices WHERE tenant_id = '${tenantId}';
    DELETE FROM number_sequences WHERE tenant_id = '${tenantId}';
    DELETE FROM order_items WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM variants WHERE tenant_id = '${tenantId}';
    DELETE FROM products WHERE tenant_id = '${tenantId}';
    DELETE FROM locations WHERE tenant_id = '${tenantId}';
    DELETE FROM tenants WHERE id = '${tenantId}';
    DELETE FROM organizations WHERE id = '${orgId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");

  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org 0199a062') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'tenant-0199a062', 'Tenant 0199a062') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name, is_default) VALUES ('${locationId}', '${tenantId}', 'Delhi Hub', true) ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${productId}', '${tenantId}', 'Shirt', 'shirt', 'published') ON CONFLICT DO NOTHING;
    INSERT INTO variants (id, tenant_id, product_id, title, sku, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'Default', 'SHIRT-01', 118000) ON CONFLICT DO NOTHING;
  `);

  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("generateInvoice() Real Postgres Integration (PLAN §11.2, §15, M5 carry-over)", () => {
  it("allocates sequential numbers scoped to Financial Year inside transaction", async () => {
    const order1Id = "0199a062-0000-7000-8000-000000000101";
    const order2Id = "0199a062-0000-7000-8000-000000000102";

    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.insert(schema.orders).values([
        {
          id: order1Id,
          tenantId,
          number: "ORD-0199a062-001",
          email: "buyer1@example.com",
          phone: "9876543210",
          subtotal: 100000,
          grandTotal: 100000,
          shippingAddress: { state: "Delhi" },
        },
        {
          id: order2Id,
          tenantId,
          number: "ORD-0199a062-002",
          email: "buyer2@example.com",
          phone: "9876543211",
          subtotal: 200000,
          grandTotal: 200000,
          shippingAddress: { state: "Delhi" },
        },
      ]);
    });

    const fy = getIndianFinancialYear(new Date());

    const inv1 = await generateInvoice(rt, ctx, { orderId: order1Id });
    expect(inv1.fy).toBe(fy);
    expect(inv1.number).toBe(`INV-${fy}-0001`);
    expect(inv1.invoiceId).toBeDefined();

    const inv2 = await generateInvoice(rt, ctx, { orderId: order2Id });
    expect(inv2.fy).toBe(fy);
    expect(inv2.number).toBe(`INV-${fy}-0002`);
    expect(inv2.invoiceId).toBeDefined();

    // Verify row persisted in real invoices table
    const rows = await withTenant(rwDb.db, tenantId, async (tx) => {
      return await tx.select().from(schema.invoices);
    });
    expect(rows.length).toBe(2);
    expect(rows[0]?.number).toBe(`INV-${fy}-0001`);
    expect(rows[1]?.number).toBe(`INV-${fy}-0002`);
  });

  describe("Shipping-tax blending (PLAN §15)", () => {
    it("blends intra-state product GST and 18% freight GST into CGST and SGST", async () => {
      const orderId = "0199a062-0000-7000-8000-000000000201";

      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(schema.orders).values({
          id: orderId,
          tenantId,
          number: "ORD-0199a062-SHP1",
          email: "ship-buyer@example.com",
          phone: "9876543210",
          subtotal: 118000, // ₹1,180 item
          shippingTotal: 20000, // ₹200 shipping
          grandTotal: 138000,
          shippingAddress: { state: "Delhi" },
          placeOfSupplyState: "Delhi",
        });

        await tx.insert(schema.orderItems).values({
          id: "0199a062-0000-7000-8000-000000000202",
          tenantId,
          orderId,
          variantId,
          productTitle: "Premium Shirt",
          quantity: 1,
          unitPrice: 118000,
          taxRateBps: 1800,
          total: 118000,
        });
      });

      const inv = await generateInvoice(rt, ctx, {
        orderId,
        sellerState: "Delhi",
        placeOfSupplyState: "Delhi",
        pricesIncludeTax: true,
      });

      expect(inv.totals.isInterState).toBe(false);

      // Item tax: ₹1,180 inclusive of 18% -> taxable: 100000 paise (₹1,000), tax: 18000 paise (₹180)
      // CGST = 9000, SGST = 9000
      // Shipping: ₹200 inclusive of 18% -> taxable: Math.round(20000 * 10000 / 11800) = 16949 paise (~₹169.49)
      // Shipping tax = 3051 paise (~₹30.51). Split: CGST = 1525, SGST = 1526
      expect(inv.totals.shippingTotal).toBe(20000);
      expect(inv.totals.shippingTaxable).toBe(16949);
      expect(inv.totals.shippingCgst).toBe(1525);
      expect(inv.totals.shippingSgst).toBe(1526);
      expect(inv.totals.shippingIgst).toBe(0);

      // Combined grand totals
      expect(inv.totals.taxableAmount).toBe(100000 + 16949); // 116949
      expect(inv.totals.cgst).toBe(9000 + 1525); // 10525
      expect(inv.totals.sgst).toBe(9000 + 1526); // 10526
      expect(inv.totals.igst).toBe(0);
      expect(inv.totals.totalTax).toBe(18000 + 3051); // 21051
      expect(inv.totals.grandTotal).toBe(116949 + 21051); // 138000
    });

    it("blends inter-state product GST and freight GST into IGST", async () => {
      const orderId = "0199a062-0000-7000-8000-000000000203";

      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(schema.orders).values({
          id: orderId,
          tenantId,
          number: "ORD-0199a062-SHP2",
          email: "ship-inter@example.com",
          phone: "9876543210",
          subtotal: 118000,
          shippingTotal: 20000,
          grandTotal: 138000,
          shippingAddress: { state: "Maharashtra" },
          placeOfSupplyState: "Maharashtra",
        });

        await tx.insert(schema.orderItems).values({
          id: "0199a062-0000-7000-8000-000000000204",
          tenantId,
          orderId,
          variantId,
          productTitle: "Premium Shirt",
          quantity: 1,
          unitPrice: 118000,
          taxRateBps: 1800,
          total: 118000,
        });
      });

      const inv = await generateInvoice(rt, ctx, {
        orderId,
        sellerState: "Delhi",
        placeOfSupplyState: "Maharashtra",
        pricesIncludeTax: true,
      });

      expect(inv.totals.isInterState).toBe(true);
      expect(inv.totals.shippingCgst).toBe(0);
      expect(inv.totals.shippingSgst).toBe(0);
      expect(inv.totals.shippingIgst).toBe(3051);

      expect(inv.totals.cgst).toBe(0);
      expect(inv.totals.sgst).toBe(0);
      expect(inv.totals.igst).toBe(18000 + 3051); // 21051
      expect(inv.totals.totalTax).toBe(21051);
    });
  });

  describe("Concurrent sequence allocation with no duplicate or skipped numbers", () => {
    it("allocates exactly 20 unique, gapless invoice numbers under 20 concurrent invocations", async () => {
      const count = 20;
      const orderIds: string[] = [];

      await withTenant(rwDb.db, tenantId, async (tx) => {
        for (let i = 1; i <= count; i++) {
          const oId = `0199a062-0000-7000-8000-${String(1000 + i).padStart(12, "0")}`;
          orderIds.push(oId);
          await tx.insert(schema.orders).values({
            id: oId,
            tenantId,
            number: `ORD-CONCUR-${i}`,
            email: `concur-${i}@example.com`,
            phone: `98765432${String(i).padStart(2, "0")}`,
            subtotal: 50000,
            grandTotal: 50000,
            shippingAddress: { state: "Delhi" },
          });
        }
      });

      // Fire 20 parallel requests concurrently
      const promises = orderIds.map((oId) =>
        generateInvoice(rt, ctx, { orderId: oId }),
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(count);

      const invoiceNumbers = results.map((r) => r.number);
      const uniqueNumbers = new Set(invoiceNumbers);

      // Verify no duplicates
      expect(uniqueNumbers.size).toBe(count);

      // Extract sequence integers: INV-YYYY-YY-XXXX -> parseInt(XXXX)
      const seqIndices = invoiceNumbers
        .map((num) => {
          const parts = num.split("-");
          return parseInt(parts[parts.length - 1]!, 10);
        })
        .sort((a, b) => a - b);

      // Verify gapless sequence (e.g. 5, 6, 7, ..., 24)
      for (let i = 0; i < seqIndices.length - 1; i++) {
        expect(seqIndices[i + 1]! - seqIndices[i]!).toBe(1);
      }
    });
  });
});
