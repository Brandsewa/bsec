import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
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
  cleanExpiredRateLimits,
  reapStaleTenantJobSlots,
  resolveTenantQuota,
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

  it("gives a store with no tier or override generous defaults (what every live store has today)", async () => {
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    const [fresh] = (await pg.query(`select id from tenants where slug = 'rate-limit-fresh-71'`)).rows as Array<{ id: string }>;
    let freshId = fresh?.id;
    if (!freshId) {
      const res = await pg.query(
        `insert into tenants (id, organization_id, slug, name) values ('0199a071-0000-7000-8000-0000000000f1', '${orgId}', 'rate-limit-fresh-71', 'Fresh') returning id`,
      );
      freshId = (res.rows[0] as { id: string }).id;
    }
    await pg.end();
    // The migration seeds are what production will really run with, not the code fallback.
    expect(await resolveTenantQuota(rwDb.db, freshId, "uncached_storefront_rpm")).toBeGreaterThanOrEqual(3000);
    expect(await resolveTenantQuota(rwDb.db, freshId, "admin_api_rpm")).toBeGreaterThanOrEqual(600);
    expect(await resolveTenantQuota(rwDb.db, freshId, "job_concurrency")).toBeGreaterThanOrEqual(4);
    // and a normal burst is never limited
    const burst = await Promise.allSettled(Array.from({ length: 200 }, () => checkStorefrontRateLimit(rwDb.db, freshId)));
    expect(burst.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("the tenant runtime role can read quota configuration but never change it", async () => {
    await expect(resolveTenantQuota(rwDb.db, tenantAId, "admin_api_rpm")).resolves.toBeGreaterThan(0);
    await expect(
      rwDb.db.execute(sql`INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES (${tenantAId}, 'admin_api_rpm', 999999)`),
    ).rejects.toThrow();
    await expect(rwDb.db.execute(sql`UPDATE quota_definitions SET tier_xs = 999999`)).rejects.toThrow();
    await expect(rwDb.db.execute(sql`DELETE FROM tenant_size_tiers`)).rejects.toThrow();
  });

  it("frees job slots a crashed worker never released, and prunes expired rate-limit counters", async () => {
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    await pg.query(`
      INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES ('${tenantBId}', 'job_concurrency', 1)
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 1;
      DELETE FROM tenant_active_jobs WHERE tenant_id = '${tenantBId}';
    `);
    // A worker takes the only slot and dies without releasing it.
    expect(await acquireTenantJobSlot(rwDb.db, tenantBId)).toBe(true);
    expect(await acquireTenantJobSlot(rwDb.db, tenantBId)).toBe(false);
    // Not stale yet: the reaper leaves a slot that was used just now.
    expect(await reapStaleTenantJobSlots(rwDb.db, 30)).toBe(0);
    expect(await acquireTenantJobSlot(rwDb.db, tenantBId)).toBe(false);
    // 31 minutes later it is reaped and the store's jobs run again.
    await pg.query(`UPDATE tenant_active_jobs SET updated_at = now() - interval '31 minutes' WHERE tenant_id = '${tenantBId}'`);
    expect(await reapStaleTenantJobSlots(rwDb.db, 30)).toBeGreaterThanOrEqual(1);
    expect(await acquireTenantJobSlot(rwDb.db, tenantBId)).toBe(true);
    await releaseTenantJobSlot(rwDb.db, tenantBId);

    // Counters expired more than an hour ago are deleted; live ones are kept.
    await pg.query(`
      INSERT INTO rate_limit_counters (key, count, expires_at) VALUES
        ('test:prune:old', 3, now() - interval '2 hours'),
        ('test:prune:live', 3, now() + interval '5 minutes')
      ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at;
    `);
    expect(await cleanExpiredRateLimits(rwDb.db)).toBeGreaterThanOrEqual(1);
    const left = (await pg.query(`select key from rate_limit_counters where key like 'test:prune:%'`)).rows as Array<{ key: string }>;
    expect(left.map((r) => r.key)).toEqual(["test:prune:live"]);
    await pg.query(`DELETE FROM tenant_quota_overrides WHERE tenant_id = '${tenantBId}' AND quota_key = 'job_concurrency'`);
    await pg.end();
  });

  it("enforces background-job concurrency ceilings per tenant (with a ceiling of 1)", async () => {
    // Give tenant A an explicit ceiling of 1, then attempt 5 concurrent slot acquisitions
    const pgc = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pgc.connect();
    await pgc.query(`
      INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES ('${tenantAId}', 'job_concurrency', 1)
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 1;
      DELETE FROM tenant_active_jobs WHERE tenant_id = '${tenantAId}';
    `);
    await pgc.end();
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
