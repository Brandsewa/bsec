/** Audit A3-04: per-visitor and per-phone limits on order placement, on a real database (counters live in rate_limit_counters). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { RateLimitExceededError, checkPlaceOrderRateLimit } from "../src/index.ts";

let env: TestDb;
let rw: DbHandle;

beforeAll(async () => {
  env = await startTestDb();
  rw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
}, 120_000);

afterAll(async () => {
  await rw?.close();
  await env?.stop();
});

const refused = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) instanceof RateLimitExceededError;

describe("checkout rate limits (real DB)", () => {
  it("allows 10 orders per phone in the window, refuses the 11th, and other phones and stores are not affected", async () => {
    const t = crypto.randomUUID();
    for (let i = 0; i < 10; i++) {
      // a different address each time: only the phone bucket can stop this
      await checkPlaceOrderRateLimit(rw.db, { tenantId: t, ip: `10.0.0.${i}`, phone: "98765 43210" });
    }
    expect(await refused(checkPlaceOrderRateLimit(rw.db, { tenantId: t, ip: "10.0.1.1", phone: "9876543210" }))).toBe(true);
    await expect(checkPlaceOrderRateLimit(rw.db, { tenantId: t, ip: "10.0.1.2", phone: "9123456789" })).resolves.toBeUndefined();
    await expect(checkPlaceOrderRateLimit(rw.db, { tenantId: crypto.randomUUID(), ip: "10.0.1.1", phone: "9876543210" })).resolves.toBeUndefined();
  });

  it("limits one address to 60 requests in the window", async () => {
    const t = crypto.randomUUID();
    for (let i = 0; i < 60; i++) await checkPlaceOrderRateLimit(rw.db, { tenantId: t, ip: "203.0.113.9" });
    expect(await refused(checkPlaceOrderRateLimit(rw.db, { tenantId: t, ip: "203.0.113.9" }))).toBe(true);
  });
});
