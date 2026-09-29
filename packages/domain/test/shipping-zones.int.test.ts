import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  getTenantShippingRates,
  getAdminShippingSettings,
  updateAdminShippingSettings,
} from "../src/index.ts";

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

// Unique fixture prefix for M7 shipping tests: 0199a076
const orgId = "0199a076-0000-7000-8000-000000000000";
const tenantAId = "0199a076-0000-7000-8000-000000000001";
const tenantBId = "0199a076-0000-7000-8000-000000000002";

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
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Shipping Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name)
    VALUES
      ('${tenantAId}', '${orgId}', 'shipping-store-a', 'Shipping Store A'),
      ('${tenantBId}', '${orgId}', 'shipping-store-b', 'Shipping Store B')
    ON CONFLICT DO NOTHING;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("Per-Store Configurable Shipping & RLS Isolation (PLAN §5.4 / M7)", () => {
  it("initializes default shipping rates (standard: 0, express: 15000 paise) for fresh tenant", async () => {
    const rates = await getTenantShippingRates(rt._db.db, tenantAId, 0);

    expect(rates).toHaveLength(2);
    const standard = rates.find((r) => r.method === "standard");
    const express = rates.find((r) => r.method === "express");

    expect(standard).toBeDefined();
    expect(standard?.amount).toBe(0);
    expect(standard?.isFree).toBe(true);

    expect(express).toBeDefined();
    expect(express?.amount).toBe(15000);
    expect(express?.isFree).toBe(false);
  });

  it("updates shipping settings via admin procedure and applies custom rates", async () => {
    // Tenant A sets:
    // Standard: ₹70 (7000 paise), Free above ₹1200 (120000 paise)
    // Express: ₹250 (25000 paise)
    const updateRes = await updateAdminShippingSettings(rt._db.db, tenantAId, {
      zoneName: "All India Delivery",
      standardRatePaise: 7000,
      expressRatePaise: 25000,
      freeShippingThresholdPaise: 120000,
    });
    expect(updateRes.success).toBe(true);

    // Verify under subtotal threshold: ₹70 standard
    const ratesLow = await getTenantShippingRates(rt._db.db, tenantAId, 50000);
    const standardLow = ratesLow.find((r) => r.method === "standard");
    expect(standardLow?.amount).toBe(7000);
    expect(standardLow?.isFree).toBe(false);

    // Verify at or above subtotal threshold: ₹0 free delivery
    const ratesHigh = await getTenantShippingRates(rt._db.db, tenantAId, 120000);
    const standardHigh = ratesHigh.find((r) => r.method === "standard");
    expect(standardHigh?.amount).toBe(0);
    expect(standardHigh?.isFree).toBe(true);

    // Express is always ₹250
    const expressHigh = ratesHigh.find((r) => r.method === "express");
    expect(expressHigh?.amount).toBe(25000);
  });

  it("enforces RLS isolation: Tenant B never sees or inherits Tenant A rates", async () => {
    // Tenant B gets fresh settings
    const tenantBSettings = await getAdminShippingSettings(rt._db.db, tenantBId);
    expect(tenantBSettings.zones).toHaveLength(1);

    const bZone = tenantBSettings.zones[0];
    expect(bZone?.name).toBe("Domestic (India)"); // Default name, not Tenant A's "All India Delivery"

    const bStandard = bZone?.rates.find((r) => r.method === "standard");
    expect(bStandard?.pricePaise).toBe(0); // Tenant B has default 0, NOT Tenant A's 7000
    expect(bStandard?.thresholdPaise).toBeNull(); // Tenant B has no threshold
  });

  it("enforces composite foreign key preventing cross-tenant zone referencing", async () => {
    // Get Tenant A's zone ID
    const aSettings = await getAdminShippingSettings(rt._db.db, tenantAId);
    const aZoneId = aSettings.zones[0]?.id;
    expect(aZoneId).toBeDefined();

    // Attempt to insert a rate for Tenant B pointing to Tenant A's zoneId
    const pg = new (await import("pg")).default.Client({ connectionString: as("app_rw", PW.rw) });
    await pg.connect();
    await pg.query(`SET LOCAL app.tenant_id = '${tenantBId}';`);

    let foreignKeyViolation = false;
    try {
      await pg.query(`
        INSERT INTO shipping_rates (tenant_id, zone_id, name, method, rate_type, price_paise)
        VALUES ('${tenantBId}', '${aZoneId}', 'Cross Tenant Rate', 'standard', 'flat', 9900);
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("foreign key") || msg.includes("shipping_rates_zone_fk") || msg.includes("violates")) {
        foreignKeyViolation = true;
      }
    } finally {
      await pg.end();
    }

    expect(foreignKeyViolation).toBe(true);
  });
});
