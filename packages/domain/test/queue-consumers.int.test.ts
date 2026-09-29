import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  type DbHandle,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { pino } from "pino";
import { handleFulfillmentRtoJob, handleCartAbandonedJob } from "../src/jobs.ts";

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

const orgId = "0199a0e1-0000-7000-8000-000000000000";
const tenantId = "0199a0e1-0000-7000-8000-000000000001";
const locationId = "0199a0e1-0000-7000-8000-000000000010";
const orderId = "0199a0e1-0000-7000-8000-000000000020";
const fulfillmentId = "0199a0e1-0000-7000-8000-000000000030";
const cartId = "0199a0e1-0000-7000-8000-000000000040";

const originalFetch = globalThis.fetch;
const originalEnvKey = process.env.RESEND_API_KEY;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 10 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM email_log WHERE tenant_id = '${tenantId}';
    DELETE FROM fulfillments WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM carts WHERE tenant_id = '${tenantId}';
    DELETE FROM locations WHERE tenant_id = '${tenantId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store-e1', 'Test Store E1') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name, is_default) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse', true) ON CONFLICT DO NOTHING;
    INSERT INTO orders (id, tenant_id, number, email, phone, subtotal, grand_total, shipping_address)
    VALUES ('${orderId}', '${tenantId}', 'ORD-E1-001', 'rto-customer@example.com', '+919876543210', 100000, 100000, '{"city":"Bengaluru"}')
    ON CONFLICT DO NOTHING;
    INSERT INTO fulfillments (id, tenant_id, order_id, location_id, status)
    VALUES ('${fulfillmentId}', '${tenantId}', '${orderId}', '${locationId}', 'shipped')
    ON CONFLICT DO NOTHING;
    INSERT INTO carts (id, tenant_id, token, email, status)
    VALUES ('${cartId}', '${tenantId}', 'cart_tok_e1', 'abandoned-cart@example.com', 'abandoned')
    ON CONFLICT DO NOTHING;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnvKey !== undefined) {
    process.env.RESEND_API_KEY = originalEnvKey;
  } else {
    delete process.env.RESEND_API_KEY;
  }
  vi.restoreAllMocks();
});

describe("Queue Consumers Integration", () => {
  it("fulfillment.rto consumer looks up order and sends order_rto email", async () => {
    let calledUrl = "";
    let sentBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrl = url;
      sentBody = JSON.parse((init?.body as string) ?? "{}");
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "resend_rto_123" }),
      } as Response;
    });

    await handleFulfillmentRtoJob(rwDb.db, logger, {
      tenantId,
      fulfillmentId,
      orderId,
    });

    expect(calledUrl).toBe("https://api.resend.com/emails");
    expect(sentBody.to).toEqual(["rto-customer@example.com"]);
    expect(sentBody.subject).toContain("Return to Origin Initiated");
    expect(sentBody.text).toContain("Template: order_rto");
  });

  it("cart.abandoned consumer sends abandoned_cart_recovery email", async () => {
    let calledUrl = "";
    let sentBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrl = url;
      sentBody = JSON.parse((init?.body as string) ?? "{}");
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "resend_cart_123" }),
      } as Response;
    });

    await handleCartAbandonedJob(rwDb.db, logger, {
      tenantId,
      cartId,
      token: "cart_tok_e1",
      email: "abandoned-cart@example.com",
    });

    expect(calledUrl).toBe("https://api.resend.com/emails");
    expect(sentBody.to).toEqual(["abandoned-cart@example.com"]);
    expect(sentBody.subject).toBe("Did you leave something behind?");
    expect(sentBody.text).toContain("Template: abandoned_cart_recovery");
  });

  it("cart.abandoned consumer skips email when no email address is on payload", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await handleCartAbandonedJob(rwDb.db, logger, {
      tenantId,
      cartId,
      token: "cart_tok_no_email",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws error on retryable email delivery failure to trigger pg-boss retry", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    await expect(
      handleFulfillmentRtoJob(rwDb.db, logger, {
        tenantId,
        fulfillmentId,
        orderId,
      }),
    ).rejects.toThrow(/Transactional email \[order_rto\] delivery failed: Resend API error: 500 Internal Server Error/);
  });

  it("does not throw when Resend API key is unconfigured (non-retryable)", async () => {
    delete process.env.RESEND_API_KEY;

    // Should complete cleanly without throwing (logged as warning)
    await expect(
      handleFulfillmentRtoJob(rwDb.db, logger, {
        tenantId,
        fulfillmentId,
        orderId,
      }),
    ).resolves.toBeUndefined();
  });
});
