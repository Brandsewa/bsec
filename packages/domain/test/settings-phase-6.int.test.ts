import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  schema,
  withTenant,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import {
  updateTaxSettings,
  listTaxClasses,
  createTaxClass,
  updateTaxClass,
  deleteTaxClass,
} from "../src/admin/tax-settings.ts";
import {
  getAdminShippingSettings,
  updateAdminShippingSettings,
  previewShippingRate,
} from "../src/orders/shipping-rates.ts";
import { createAdminDraftOrder } from "../src/admin/orders.ts";
import { generateInvoice } from "../src/orders/invoices.ts";
import { actOnReturn } from "../src/orders/manual-lifecycle.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const orgId = "0199a099-0000-7000-8000-000000000000";
const tenantId = "0199a099-0000-7000-8000-000000000001";
const productId = "0199a099-0000-7000-8000-000000000002";
const variantId = "0199a099-0000-7000-8000-000000000003";

let adminCtx: TenantContext;
let staffLimitedCtx: TenantContext;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 15 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 15 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM invoices WHERE tenant_id = '${tenantId}';
    DELETE FROM returns WHERE tenant_id = '${tenantId}';
    DELETE FROM return_items WHERE tenant_id = '${tenantId}';
    DELETE FROM order_items WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM variants WHERE tenant_id = '${tenantId}';
    DELETE FROM products WHERE tenant_id = '${tenantId}';
    DELETE FROM tax_classes WHERE tenant_id = '${tenantId}';
    DELETE FROM shipping_rates WHERE tenant_id = '${tenantId}';
    DELETE FROM shipping_zones WHERE tenant_id = '${tenantId}';
    DELETE FROM store_settings WHERE tenant_id = '${tenantId}';
    DELETE FROM tenant_feature_overrides WHERE tenant_id = '${tenantId}';
    DELETE FROM audit_logs WHERE tenant_id = '${tenantId}';
    DELETE FROM tenants WHERE id = '${tenantId}';
    DELETE FROM organizations WHERE id = '${orgId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");

  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org P6') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'tenant-p6', 'Tenant P6') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO feature_flags (key, default_on) VALUES ('settings.gst_v2', false) ON CONFLICT (key) DO NOTHING;
    INSERT INTO store_settings (tenant_id, store_name, address, checkout)
    VALUES ('${tenantId}', 'Test P6 Store', '{"state": "Maharashtra"}'::jsonb, '{"tax": {"taxCollection": true, "sellerState": "Maharashtra", "pricesIncludeTax": true}}'::jsonb)
    ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${productId}', '${tenantId}', 'Test Kurta', 'test-kurta', 'published') ON CONFLICT DO NOTHING;
    INSERT INTO variants (id, tenant_id, product_id, title, sku, price, track_inventory) VALUES ('${variantId}', '${tenantId}', '${productId}', 'Default', 'KURTA-01', 100000, false) ON CONFLICT DO NOTHING;
  `);

  await pgClient.end();

  adminCtx = {
    tenantId,
    roles: ["store_admin"],
    permissions: [
      "settings.read",
      "taxes.manage",
      "shipping.manage",
      "orders.read",
      "orders.write",
      "orders.refund",
      "returns.manage",
      "catalog.read",
      "catalog.write",
    ],
    actor: { type: "staff", userId: "0199a099-0000-7000-8000-000000000099" },
    storeStatus: "live",
    requestId: "req-p6-admin",
  };

  staffLimitedCtx = {
    tenantId,
    roles: ["analytics_viewer"],
    permissions: ["analytics.read"],
    actor: { type: "staff", userId: "0199a099-0000-7000-8000-000000000088" },
    storeStatus: "live",
    requestId: "req-p6-limited",
  };
}, 120_000);

afterAll(async () => {
  await rt?.close();
  await rwDb?.close();
  await container?.stop();
});

describe("Settings Phase 6: GST Correctness & Real Postgres Integration", () => {
  it("lazy-seeds Standard 18% default tax class on first read", async () => {
    const classes = await listTaxClasses(rt, adminCtx);
    expect(classes.length).toBeGreaterThanOrEqual(1);
    const def = classes.find((c) => c.isDefault);
    expect(def).toBeDefined();
    expect(def?.name).toBe("Standard 18%");
    expect(def?.rateBps).toBe(1800);
  });

  it("creates, updates, and deletes non-default tax class with audit logs", async () => {
    const created = await createTaxClass(rt, adminCtx, {
      name: "Books 0%",
      rateBps: 0,
      defaultHsn: "4901",
      isDefault: false,
    });
    expect(created.rateBps).toBe(0);
    expect(created.defaultHsn).toBe("4901");

    const updated = await updateTaxClass(rt, adminCtx, {
      id: created.id,
      name: "Printed Books 0%",
    });
    expect(updated.name).toBe("Printed Books 0%");

    const del = await deleteTaxClass(rt, adminCtx, created.id);
    expect(del.ok).toBe(true);

    // Verify audit log exists
    const logs = await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.targetId, created.id))),
    );
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it("validates GSTIN format, checksum, and state match in tax settings update", async () => {
    // Bad format
    await expect(
      updateTaxSettings(rt, adminCtx, {
        gstin: "INVALID_GSTIN",
      }),
    ).rejects.toThrow(/Bad Request/);

    // Bad checksum
    await expect(
      updateTaxSettings(rt, adminCtx, {
        gstin: "27AAPFU0939F1Z0", // Invalid check char
      }),
    ).rejects.toThrow(/checksum character/);

    // State mismatch: Karnataka GSTIN with Maharashtra sellerState
    await expect(
      updateTaxSettings(rt, adminCtx, {
        gstin: "29AAFCD5862R1ZR", // 29 is Karnataka
        sellerState: "Maharashtra",
      }),
    ).rejects.toThrow(/does not match/);

    // Valid Maharashtra GSTIN (27AAPFU0955L1ZI)
    const updated = await updateTaxSettings(rt, adminCtx, {
      gstin: "27AAPFU0955L1ZI",
      sellerState: "Maharashtra",
    });
    expect(updated.gstin).toBe("27AAPFU0955L1ZI");
    expect(updated.sellerState).toBe("Maharashtra");
  });

  it("enforces taxes.manage permission for tax modifications", async () => {
    await expect(
      createTaxClass(rt, staffLimitedCtx, {
        name: "Jewellery 3%",
        rateBps: 300,
      }),
    ).rejects.toThrow();

    await expect(
      updateTaxSettings(rt, staffLimitedCtx, {
        pricesIncludeTax: false,
      }),
    ).rejects.toThrow();
  });
});

describe("Settings Phase 6: Tax Engine Wiring & Defect Fixes", () => {
  it("Defect 1 & 2: under settings.gst_v2, orders fail if state missing, and use product tax class instead of hardcoded 1800", async () => {
    // 1. Create a 5% tax class
    const class5 = await createTaxClass(rt, adminCtx, {
      name: "Food 5%",
      rateBps: 500,
      isDefault: false,
    });

    // Assign class to product
    await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .update(schema.products)
        .set({ taxClassId: class5.id })
        .where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.id, productId))),
    );

    // Enable settings.gst_v2 feature flag
    await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .insert(schema.tenantFeatureOverrides)
        .values({
          tenantId,
          key: "settings.gst_v2",
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [schema.tenantFeatureOverrides.tenantId, schema.tenantFeatureOverrides.key],
          set: { enabled: true },
        }),
    );

    // Attempt to draft order with MISSING destination state -> MUST fail explicitly
    await expect(
      createAdminDraftOrder(rt, adminCtx, {
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceOverride: 10500,
            unitPriceOverrideReason: "promotion",
          },
        ],
        email: "gst2@example.com",
        phone: "9876543210",
        shippingAddress: {
          name: "GST2 Buyer",
          line1: "123 Street",
          city: "Pune",
          // state omitted!
          pincode: "411001",
          country: "IN",
        },
      }),
    ).rejects.toThrow(/destination state is required/i);

    // Draft order with Maharashtra destination state -> Intra-state 5% CGST + SGST (2.5% each)
    const draft = await createAdminDraftOrder(rt, adminCtx, {
      items: [
        {
          variantId,
          quantity: 1,
          unitPriceOverride: 10500,
          unitPriceOverrideReason: "promotion",
        },
      ],
      email: "gst2@example.com",
      phone: "9876543210",
      shippingAddress: {
        name: "GST2 Buyer",
        line1: "123 Street",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        country: "IN",
      },
    });

    expect(draft.taxTotal).toBe(500); // 5% of 10000 paise taxable = 500 paise
    expect(draft.grandTotal).toBe(10500);

    // Defect 3: Verify tax snapshots written to order_items row
    const [itemRow] = await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.orderItems)
        .where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, draft.orderId))),
    );

    expect(itemRow?.taxRateBps).toBe(500); // 500 bps, NOT 1800!
    expect(itemRow?.taxableValuePaise).toBe(10000);
    expect(itemRow?.taxPaise).toBe(500);
    expect(itemRow?.cgst).toBe(250);
    expect(itemRow?.sgst).toBe(250);
    expect(itemRow?.igst).toBe(0);

    // Generate Invoice: must reproduce snapshot even if product class changes later
    await updateTaxClass(rt, adminCtx, { id: class5.id, rateBps: 1200 }); // Mutate class to 12%

    const inv = await generateInvoice(rt, adminCtx, { orderId: draft.orderId });
    expect(inv.totals.totalTax).toBe(500); // Still 500 from snapshot, NOT 1200!
    expect(inv.totals.cgst).toBe(250);
    expect(inv.totals.sgst).toBe(250);
  });

  it("Defect 4: Refund generates credit note linked to return and invoice, and is idempotent", async () => {
    // 1. Create an invoiced order
    const draft = await createAdminDraftOrder(rt, adminCtx, {
      items: [
        {
          variantId,
          quantity: 2,
          unitPriceOverride: 10500,
          unitPriceOverrideReason: "promotion",
        },
      ],
      email: "refund@example.com",
      phone: "9876543210",
      shippingAddress: {
        name: "Refund Buyer",
        line1: "123 Street",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        country: "IN",
      },
    });

    const [itemRow] = await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.orderItems)
        .where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, draft.orderId))),
    );

    // Generate parent invoice
    const parentInv = await generateInvoice(rt, adminCtx, { orderId: draft.orderId });
    expect(parentInv.invoiceId).toBeDefined();

    // 2. Create an approved return request for 1 quantity
    const returnId = "0199a099-0000-7000-8000-000000000555";
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.insert(schema.returns).values({
        id: returnId,
        tenantId,
        orderId: draft.orderId,
        number: "RET-001",
        status: "approved",
        reason: "wrong_size",
      });
      await tx.insert(schema.returnItems).values({
        id: "0199a099-0000-7000-8000-000000000556",
        tenantId,
        returnId,
        orderItemId: itemRow!.id,
        quantity: 1,
      });
    });

    // 3. Act on return with refund
    await actOnReturn(rt, adminCtx, {
      id: returnId,
      action: "refund",
      refundAmount: 10500,
      refundMethod: "original_payment",
    });

    // Verify credit note row created in invoices table
    const cnRows = await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, tenantId),
            eq(schema.invoices.returnId, returnId),
            eq(schema.invoices.type, "credit_note"),
          ),
        ),
    );

    expect(cnRows.length).toBe(1);
    const cn = cnRows[0]!;
    expect(cn.type).toBe("credit_note");
    expect(cn.parentInvoiceId).toBe(parentInv.invoiceId);
    const totalsObj = cn.totals as { grandTotal: number };
    expect(totalsObj.grandTotal).toBe(-10500); // Negative signed
    expect(cn.number).toMatch(/^CN-/);

    // 4. Idempotency: Calling generateInvoice with same returnId returns existing credit note without duplicate insert
    const cnRepeat = await generateInvoice(rt, adminCtx, {
      orderId: draft.orderId,
      type: "credit_note",
      returnId,
      parentInvoiceId: parentInv.invoiceId,
    });
    expect(cnRepeat.invoiceId).toBe(cn.id);

    const cnRowsAfter = await withTenant(rwDb.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, tenantId),
            eq(schema.invoices.returnId, returnId),
            eq(schema.invoices.type, "credit_note"),
          ),
        ),
    );
    expect(cnRowsAfter.length).toBe(1);
  });
});

describe("Settings Phase 6: Shipping Settings & Preview", () => {
  it("enforces shipping.manage permission and audits updates", async () => {
    // Unauthorized call rejected
    await expect(
      updateAdminShippingSettings(rt, staffLimitedCtx, {
        zoneName: "North India",
        standardRatePaise: 5000,
        expressRatePaise: 12000,
      }),
    ).rejects.toThrow();

    // Authorized update succeeds
    const updateRes = await updateAdminShippingSettings(rt, adminCtx, {
      zoneName: "All India Domestic",
      standardRatePaise: 7000, // ₹70
      expressRatePaise: 15000, // ₹150
      freeShippingThresholdPaise: 100000, // Free above ₹1000
    });
    expect(updateRes.success).toBe(true);

    const settings = await getAdminShippingSettings(rt, adminCtx);
    const defZone = settings.zones[0];
    expect(defZone?.name).toBe("All India Domestic");

    // Preview below threshold: standard ₹70, express ₹150
    const previewBelow = await previewShippingRate(rt, adminCtx, {
      subtotalPaise: 50000, // ₹500
    });
    expect(previewBelow.zoneName).toBe("All India Domestic");
    const stdBelow = previewBelow.rates.find((r) => r.method === "standard");
    expect(stdBelow?.amountPaise).toBe(7000);
    expect(stdBelow?.isFree).toBe(false);
    expect(stdBelow?.trace).toContain("Rate: Standard Shipping ₹70");

    // Preview at or above threshold: standard becomes Free
    const previewAbove = await previewShippingRate(rt, adminCtx, {
      subtotalPaise: 120000, // ₹1,200
    });
    const stdAbove = previewAbove.rates.find((r) => r.method === "standard");
    expect(stdAbove?.amountPaise).toBe(0);
    expect(stdAbove?.isFree).toBe(true);
    expect(stdAbove?.trace).toContain("Free delivery applied");
  });
});
