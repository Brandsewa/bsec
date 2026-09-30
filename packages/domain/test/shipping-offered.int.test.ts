import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, getTenantShippingRates, provisionTenant, type Runtime } from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let tenantId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = await provisionTenant(rt, { storeName: "ship-a", slug: "ship-a", owner: { email: "owner@ship-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  tenantId = r.tenantId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("shipping offered to a shopper (a new store is seeded with 'Standard ₹99' and 'Free above ₹999')", () => {
  it("below the threshold: one Standard option at ₹99", async () => {
    const rates = await getTenantShippingRates(rtWeb._db.db, tenantId, 10000);
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ method: "standard", title: "Standard Shipping", amount: 9900, isFree: false });
  });

  it("just below ₹999 it is still ₹99", async () => {
    const rates = await getTenantShippingRates(rtWeb._db.db, tenantId, 99899);
    expect(rates.map((r) => r.amount)).toEqual([9900]);
  });

  it("from ₹999 up the same Standard option is free", async () => {
    const rates = await getTenantShippingRates(rtWeb._db.db, tenantId, 99900);
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ method: "standard", amount: 0, isFree: true });
  });
});
