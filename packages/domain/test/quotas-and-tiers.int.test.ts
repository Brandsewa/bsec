import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  type TenantContext,
  resolveEffectiveQuota,
  assertProductQuota,
  assertStaffQuota,
  createProduct,
  placeOrder,
  getOrCreateCart,
  addToCart,
  trackSoftQuotaUsage,
  getTenantUsageReport,
  runNightlyQuotaRecommendationsJob,
  QuotaExceededError,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let platformDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

// Unique fixture prefix for M8 Quota tests: 0199a081
const orgId = "0199a081-0000-7000-8000-000000000000";
const tenantAId = "0199a081-0000-7000-8000-000000000001";
const tenantBId = "0199a081-0000-7000-8000-000000000002";
const userA = "0199a081-0000-7000-8000-000000000011";
const roleA = "0199a081-0000-7000-8000-000000000021";
const locA = "0199a081-0000-7000-8000-000000000031";

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
  platformDb = createDb(as("app_platform", PW.platform), { max: 5 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 15 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Quota Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, name, email) VALUES ('${userA}', 'Quota Admin', 'admin@quota-test.local') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name, status)
    VALUES
      ('${tenantAId}', '${orgId}', 'quota-store-a', 'Quota Store A', 'active'),
      ('${tenantBId}', '${orgId}', 'quota-store-b', 'Quota Store B', 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO roles (id, tenant_id, name, permissions)
    VALUES ('${roleA}', '${tenantAId}', 'store_owner', ARRAY['products.write', 'staff.manage', 'orders.read', 'orders.write']::text[])
    ON CONFLICT DO NOTHING;

    INSERT INTO memberships (tenant_id, user_id, role_id, status)
    VALUES ('${tenantAId}', '${userA}', '${roleA}', 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO locations (id, tenant_id, name, is_default)
    VALUES ('${locA}', '${tenantAId}', 'Primary Warehouse', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO store_settings (tenant_id, store_name, currency, timezone, order_prefix)
    VALUES ('${tenantAId}', 'Quota Store A', 'INR', 'Asia/Kolkata', '#Q-')
    ON CONFLICT DO NOTHING;

    INSERT INTO tenant_size_tiers (tenant_id, tier)
    VALUES
      ('${tenantAId}', 'L'),
      ('${tenantBId}', 'L')
    ON CONFLICT (tenant_id) DO UPDATE SET tier = 'L';
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("PLAN §6.1 Quotas & Size Tiers Engine (Milestone M8)", () => {
  it("resolves quota limit through hierarchy: override → size tier → plan → default", async () => {
    // 1. Initial state: tenant A has Tier L from migration non-regression
    const initialRes = await resolveEffectiveQuota(rt._db.db, tenantAId, "products");
    expect(initialRes.limit).toBe(25000); // Tier L
    expect(initialRes.source).toBe("tier");
    expect(initialRes.tier).toBe("L");

    // 2. Set tenant size tier to XS
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`UPDATE tenant_size_tiers SET tier = 'XS' WHERE tenant_id = ${tenantAId};`
    );
    const xsRes = await resolveEffectiveQuota(rt._db.db, tenantAId, "products");
    expect(xsRes.limit).toBe(50); // XS default
    expect(xsRes.source).toBe("tier");
    expect(xsRes.tier).toBe("XS");

    // 3. Add explicit tenant quota override (e.g. 75 products)
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`
        INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value, reason)
        VALUES (${tenantAId}, 'products', 75, 'VIP trial override')
        ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 75;
      `
    );
    const overrideRes = await resolveEffectiveQuota(rt._db.db, tenantAId, "products");
    expect(overrideRes.limit).toBe(75);
    expect(overrideRes.source).toBe("override");

    // Clean up override
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${tenantAId};`
    );
  });

  it("hard creation quotas block admin mutations when ceiling is reached", async () => {
    // Set tenant size tier to XS (50 products limit)
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`UPDATE tenant_size_tiers SET tier = 'XS' WHERE tenant_id = ${tenantAId};`
    );

    // Override products limit to 1 for precise testing
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`
        INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value)
        VALUES (${tenantAId}, 'products', 1)
        ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 1;
      `
    );

    const ctx: TenantContext = {
      tenantId: tenantAId,
      storeStatus: "live",
      actor: { type: "staff", userId: userA },
      roles: ["store_owner"],
      permissions: ["products.write", "staff.manage"],
      requestId: "0199a081-req-001",
    };

    // First product creation should succeed
    const p1 = await createProduct(rt, ctx, {
      title: "Allowed Product",
      slug: "allowed-product-1",
      variants: [{ sku: "SKU-Q-1", title: "Default", price: 50000 }],
    });
    expect(p1.id).toBeDefined();

    // Second product creation must be blocked by QuotaExceededError
    await expect(
      createProduct(rt, ctx, {
        title: "Blocked Product",
        slug: "blocked-product-2",
      })
    ).rejects.toThrow(QuotaExceededError);

    // Cleanup
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${tenantAId};`
    );
  });

  it("soft quotas warn and emit quota_events at 80% and 100% without blocking", async () => {
    // Reset quota events
    await rt._db.db.execute(
      (await import("drizzle-orm")).sql`DELETE FROM quota_events WHERE tenant_id = ${tenantAId};`
    );

    // Set order quota override to 10 orders
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`
        INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value)
        VALUES (${tenantAId}, 'orders_month', 10)
        ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 10;
      `
    );

    // At 8 orders (80%), emits pct_80 event
    const res80 = await trackSoftQuotaUsage(rt._db.db, {
      tenantId: tenantAId,
      quotaKey: "orders_month",
      current: 8,
    });
    expect(res80.level).toBe("pct_80");
    expect(res80.notified).toBe(true);

    // At 10 orders (100%), emits pct_100 event
    const res100 = await trackSoftQuotaUsage(rt._db.db, {
      tenantId: tenantAId,
      quotaKey: "orders_month",
      current: 10,
    });
    expect(res100.level).toBe("pct_100");
    expect(res100.notified).toBe(true);

    // Verify events recorded in database
    const events = await rt._db.db.execute<{ level: string; value: number }>(
      (await import("drizzle-orm")).sql`SELECT level, value FROM quota_events WHERE tenant_id = ${tenantAId} ORDER BY created_at;`
    );
    expect(events.rows.length).toBe(2);
    expect(events.rows[0]?.level).toBe("pct_80");
    expect(events.rows[1]?.level).toBe("pct_100");

    // Cleanup
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${tenantAId};`
    );
  });

  it("CRITICAL INVARIANT: quotas NEVER block customer checkout even when 100% exhausted", async () => {
    // Simulate completely exhausted tenant quotas:
    // 0 products allowance, 0 orders allowance, 0 staff allowance
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`
        INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value)
        VALUES
          (${tenantAId}, 'products', 0),
          (${tenantAId}, 'orders_month', 0),
          (${tenantAId}, 'storage_mb', 0)
        ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 0;
      `
    );

    try {
      // Setup inventory & stock for product variant
      const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
      await pgClient.connect();
      const prodId = "0199a081-0000-7000-8000-000000000091";
      const varId = "0199a081-0000-7000-8000-000000000092";
      await pgClient.query(`
        INSERT INTO products (id, tenant_id, title, slug, status)
        VALUES ('${prodId}', '${tenantAId}', 'Checkout Test Item', 'checkout-test-item', 'active')
        ON CONFLICT DO NOTHING;

        INSERT INTO variants (id, tenant_id, product_id, sku, title, price, track_inventory)
        VALUES ('${varId}', '${tenantAId}', '${prodId}', 'SKU-CHK-1', 'Default Variant', 150000, true)
        ON CONFLICT DO NOTHING;

        INSERT INTO inventory_levels (tenant_id, variant_id, location_id, on_hand, reserved)
        VALUES ('${tenantAId}', '${varId}', '${locA}', 50, 0)
        ON CONFLICT DO NOTHING;
      `);
      await pgClient.end();

      const storefrontCtx: TenantContext = {
        tenantId: tenantAId,
        storeStatus: "live",
        actor: { type: "anonymous" },
        roles: [],
        permissions: [],
        requestId: "0199a081-chk-001",
      };

      // Customer creates cart and adds item
      const cart = await getOrCreateCart(rt, storefrontCtx);
      await addToCart(rt, storefrontCtx, {
        token: cart.token,
        variantId: varId,
        quantity: 1,
      });

      // Customer places order — MUST SUCCEED despite 0 quota remaining!
      const orderResult = await placeOrder(rt, storefrontCtx, {
        cartToken: cart.token,
        email: "shopper@domain.local",
        phone: "+919876543210",
        fullName: "Ananya Sharma",
        addressLine1: "42 Park Street",
        city: "Kolkata",
        state: "West Bengal",
        pincode: "700016",
        paymentMethod: "cod",
      });

      expect(orderResult.success).toBe(true);
      expect(orderResult.orderId).toBeDefined();
      expect(orderResult.orderNumber).toBeDefined();
      expect(orderResult.status).toBe("pending");
    } finally {
      // Cleanup overrides
      await platformDb.db.execute(
        (await import("drizzle-orm")).sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${tenantAId};`
      );
    }
  });

  it("getTenantUsageReport returns live metrics for merchant settings", async () => {
    const report = await getTenantUsageReport(rt._db.db, tenantAId);
    expect(report.tenantId).toBe(tenantAId);
    expect(["XS", "S", "M", "L"]).toContain(report.tier);
    expect(report.items.length).toBeGreaterThan(0);

    const prodUsage = report.items.find((i) => i.quotaKey === "products");
    expect(prodUsage).toBeDefined();
    expect(prodUsage!.current).toBeGreaterThanOrEqual(1);
    expect(prodUsage!.limit).toBeGreaterThan(0);
  });

  it("nightly recommendations job audits stores and identifies upgrade candidates", async () => {
    // Set low override so tenant A is > 80% used
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`
        INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value)
        VALUES (${tenantAId}, 'products', 1)
        ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 1;
      `
    );

    const jobResult = await runNightlyQuotaRecommendationsJob(rt._db.db);
    expect(jobResult.inspectedTenants).toBeGreaterThan(0);
    const rec = jobResult.recommendations.find((r) => r.tenantId === tenantAId);
    expect(rec).toBeDefined();
    expect(rec?.recommendedTier).toBeDefined();

    // Cleanup
    await platformDb.db.execute(
      (await import("drizzle-orm")).sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${tenantAId};`
    );
  });
});
