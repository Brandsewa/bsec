import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { PaymentMethodItem } from "@bs/contracts";
import { createRuntime, listPaymentMethods, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";

/**
 * A store that has never saved any payment settings gets a synthesized COD and Razorpay card. The admin API validates
 * its output against the contract, so a synthesized id that is not a valid UUID made the whole Payments page fail
 * ("Could not load payment methods") and hid the Razorpay gateway card with it.
 */
describe("payment methods catalogue for a new store (real Postgres)", () => {
  let env: TestDb;
  let rtPlatform: Runtime;
  let rt: Runtime;
  let ctx: TenantContext;

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 4 });
    const t = await provisionTenant(rtPlatform, {
      storeName: "Pay Catalogue Store",
      slug: `pay-cat-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@pay-cat.test`, name: "Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    ctx = {
      tenantId: t.tenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: t.ownerId },
      roles: ["owner", "store_owner"],
      permissions: STORE_PERMISSIONS,
      requestId: "test-pay-cat",
    };
  });

  afterAll(async () => {
    await rt?.close();
    await rtPlatform?.close();
  });

  it("returns COD and Razorpay entries that satisfy the API contract", async () => {
    const methods = await listPaymentMethods(rt, ctx);
    expect(methods.map((m) => m.provider)).toEqual(["cod", "razorpay"]);
    for (const m of methods) expect(() => PaymentMethodItem.parse(m)).not.toThrow();
  });
});
