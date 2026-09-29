import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  checkRateLimit,
  checkCustomerOtpRequestLimit,
  checkCustomerOtpVerifyLimit,
  checkAdminLoginLimit,
  checkWebhookRateLimit,
  checkStorefrontRateLimit,
  checkAdminApiRateLimit,
  acquireTenantJobSlot,
  releaseTenantJobSlot,
  RateLimitExceededError,
  resolveWebhookTenant,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const orgId = "0199a071-0000-7000-8000-000000000000";
const tenantAId = "0199a071-0000-7000-8000-000000000001";
const tenantBId = "0199a071-0000-7000-8000-000000000002";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 20 });

  const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Rate Limit Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name)
    VALUES
      ('${tenantAId}', '${orgId}', 'rate-limit-store-a', 'Rate Limit Store A'),
      ('${tenantBId}', '${orgId}', 'rate-limit-store-b', 'Rate Limit Store B')
    ON CONFLICT DO NOTHING;
    DELETE FROM rate_limit_counters;
    DELETE FROM tenant_active_jobs WHERE tenant_id IN ('${tenantAId}', '${tenantBId}');
  `);
  await pg.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("Rate Limiting Engine (M7 Hardening)", () => {
  it("enforces atomic counter increments and returns 429 when limit is exceeded under concurrency", async () => {
    const key = `test:concurrent:key:${Date.now()}`;
    const limit = 5;
    const windowSeconds = 60;

    // Fire 12 concurrent requests
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        checkRateLimit(rwDb.db, { key, limit, windowSeconds }),
      ),
    );

    const allowed = results.filter((r) => r.allowed);
    const rejected = results.filter((r) => !r.allowed);

    expect(allowed.length).toBe(5);
    expect(rejected.length).toBe(7);
    for (const r of rejected) {
      expect(r.retryAfter).toBeGreaterThan(0);
      expect(r.remaining).toBe(0);
    }
  });

  it("enforces customer OTP request per-phone limit (3 max) under concurrency", async () => {
    const phone = "919876543210";
    const ipPrefix = "192.168.1.";

    // 10 concurrent requests for same phone from distinct IPs
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        checkCustomerOtpRequestLimit(rwDb.db, {
          tenantId: tenantAId,
          ip: `${ipPrefix}${i + 1}`,
          phone,
        }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter(
      (o) =>
        o.status === "rejected" &&
        o.reason instanceof RateLimitExceededError &&
        o.reason.status === 429 &&
        o.reason.message.includes("phone number"),
    );

    expect(succeeded.length).toBe(3);
    expect(failed.length).toBe(7);
  });

  it("enforces customer OTP request per-IP limit (5 max) under concurrency", async () => {
    const ip = "10.0.0.55";

    // 10 concurrent requests from same IP for distinct phones
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        checkCustomerOtpRequestLimit(rwDb.db, {
          tenantId: tenantAId,
          ip,
          phone: `9198000000${i + 10}`,
        }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter(
      (o) =>
        o.status === "rejected" &&
        o.reason instanceof RateLimitExceededError &&
        o.reason.status === 429 &&
        o.reason.message.includes("IP"),
    );

    expect(succeeded.length).toBe(5);
    expect(failed.length).toBe(5);
  });

  it("enforces customer OTP verify limit (5 per phone) under concurrent guesses", async () => {
    const phone = "919811112222";
    const ipPrefix = "10.1.0.";

    // 10 concurrent verify requests for same phone from distinct IPs
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        checkCustomerOtpVerifyLimit(rwDb.db, {
          tenantId: tenantAId,
          ip: `${ipPrefix}${i + 1}`,
          phone,
        }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter(
      (o) =>
        o.status === "rejected" &&
        o.reason instanceof RateLimitExceededError &&
        o.reason.status === 429,
    );

    expect(succeeded.length).toBe(5);
    expect(failed.length).toBe(5);
  });

  it("enforces admin and staff login limits (5 per email, 10 per IP)", async () => {
    const email = "admin-limit-test@brandsewa.com";

    // 10 concurrent attempts on same email from distinct IPs
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        checkAdminLoginLimit(rwDb.db, {
          ip: `172.16.0.${i + 1}`,
          email,
        }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter(
      (o) =>
        o.status === "rejected" &&
        o.reason instanceof RateLimitExceededError &&
        o.reason.status === 429 &&
        o.reason.message.includes("account"),
    );

    expect(succeeded.length).toBe(5);
    expect(failed.length).toBe(5);
  });

  it("enforces webhook rate limits per IP and provider", async () => {
    const ip = "198.51.100.25";
    // 5 concurrent webhook calls pass cleanly
    for (let i = 0; i < 5; i++) {
      await expect(checkWebhookRateLimit(rwDb.db, { ip, provider: "razorpay" })).resolves.not.toThrow();
    }
  });

  it("enforces tenant storefront and admin API quotas with custom override", async () => {
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    // Configure small override for tenantB: uncached_storefront_rpm = 4, admin_api_rpm = 3
    await pg.query(`
      INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value)
      VALUES
        ('${tenantBId}', 'uncached_storefront_rpm', 4),
        ('${tenantBId}', 'admin_api_rpm', 3)
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = EXCLUDED.value;
    `);
    await pg.end();

    // 8 concurrent storefront calls against limit of 4
    const storeResults = await Promise.allSettled(
      Array.from({ length: 8 }, () => checkStorefrontRateLimit(rwDb.db, tenantBId)),
    );
    const storeSucceeded = storeResults.filter((r) => r.status === "fulfilled");
    const storeRejected = storeResults.filter(
      (r) => r.status === "rejected" && r.reason instanceof RateLimitExceededError,
    );
    expect(storeSucceeded.length).toBe(4);
    expect(storeRejected.length).toBe(4);

    // 6 concurrent admin API calls against limit of 3
    const adminResults = await Promise.allSettled(
      Array.from({ length: 6 }, () => checkAdminApiRateLimit(rwDb.db, tenantBId)),
    );
    const adminSucceeded = adminResults.filter((r) => r.status === "fulfilled");
    const adminRejected = adminResults.filter(
      (r) => r.status === "rejected" && r.reason instanceof RateLimitExceededError,
    );
    expect(adminSucceeded.length).toBe(3);
    expect(adminRejected.length).toBe(3);
  });

  it("enforces background-job concurrency ceilings per tenant (XS ceiling = 1)", async () => {
    // Tenant A defaults to XS tier -> job_concurrency = 1
    // Attempt 5 concurrent slot acquisitions
    const results = await Promise.all([
      acquireTenantJobSlot(rwDb.db, tenantAId),
      acquireTenantJobSlot(rwDb.db, tenantAId),
      acquireTenantJobSlot(rwDb.db, tenantAId),
      acquireTenantJobSlot(rwDb.db, tenantAId),
      acquireTenantJobSlot(rwDb.db, tenantAId),
    ]);

    const acquired = results.filter((r) => r === true);
    const rejected = results.filter((r) => r === false);

    expect(acquired.length).toBe(1);
    expect(rejected.length).toBe(4);

    // Releasing the slot allows subsequent job to acquire
    await releaseTenantJobSlot(rwDb.db, tenantAId);

    const nextAttempt = await acquireTenantJobSlot(rwDb.db, tenantAId);
    expect(nextAttempt).toBe(true);

    await releaseTenantJobSlot(rwDb.db, tenantAId);
  });

  it("derives webhook tenantId server-side and prevents tenant poisoning", async () => {
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    const orderId = "0199a071-0000-7000-8000-000000000010";
    const paymentIntentId = "0199a071-0000-7000-8000-000000000020";
    await pg.query(`
      INSERT INTO orders (id, tenant_id, number, email, phone, currency, status, payment_status, subtotal, grand_total, shipping_total, shipping_address)
      VALUES ('${orderId}', '${tenantAId}', 1001, 'cust@example.com', '919800000001', 'INR', 'pending', 'pending', 10000, 15000, 5000, '{"pincode":"400001","city":"Mumbai","state":"MH"}'::jsonb)
      ON CONFLICT DO NOTHING;

      INSERT INTO payment_intents (id, tenant_id, order_id, provider, amount, status, provider_order_id)
      VALUES ('${paymentIntentId}', '${tenantAId}', '${orderId}', 'razorpay', 15000, 'created', 'order_sec_test_71')
      ON CONFLICT DO NOTHING;
    `);
    await pg.end();

    // 1. Without claimed tenant: rejected (fails closed)
    await expect(
      resolveWebhookTenant(rwDb.db, {
        provider: "razorpay",
        providerOrderId: "order_sec_test_71",
      }),
    ).rejects.toThrow(/Missing tenant identifier/);

    // 2. Caller tries to poison event into Tenant B: rejected!
    await expect(
      resolveWebhookTenant(rwDb.db, {
        provider: "razorpay",
        claimedTenantId: tenantBId,
        providerOrderId: "order_sec_test_71",
      }),
    ).rejects.toThrow(/Tenant mismatch/);

    // 3. Caller provides matching Tenant A: accepted
    const matched = await resolveWebhookTenant(rwDb.db, {
      provider: "razorpay",
      claimedTenantId: tenantAId,
      providerOrderId: "order_sec_test_71",
    });
    expect(matched.tenantId).toBe(tenantAId);
  });
});
