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
import { sweepAbandonedCarts } from "../src/system/abandoned-carts.ts";
import type { Transporter } from "nodemailer";
import { setPlatformEmailTransportFactory } from "../src/system/platform-mailer.ts";
import { encryptSecret } from "@bs/payments";

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

  const enc = encryptSecret("mock-token-0199a0e1");
  await pgClient.query(`
    INSERT INTO platform_email_settings (
      id, provider, host, port, secure_mode, username, password_ciphertext, password_iv, key_version,
      from_email, from_name, reply_to, enabled
    ) VALUES (
      'default', 'zoho_zeptomail', 'smtp.zeptomail.in', 587, 'starttls', 'emailapikey',
      '${enc.ciphertext}', '${enc.iv}', 1,
      'no-reply@gobs.cloud', 'Brand Sewa', 'support@gobs.cloud', true
    ) ON CONFLICT (id) DO UPDATE SET
      password_ciphertext = EXCLUDED.password_ciphertext,
      password_iv = EXCLUDED.password_iv,
      enabled = true;
  `);

  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

const sentMails: Array<Record<string, unknown>> = [];

beforeEach(() => {
  sentMails.length = 0;
  setPlatformEmailTransportFactory((config) => {
    return {
      sendMail: async (opts: Record<string, unknown>) => {
        sentMails.push({ ...opts, _config: config });
        return { messageId: "msg_platform_mock_0199a0e1" };
      },
    } as unknown as Transporter;
  });
});

afterEach(() => {
  setPlatformEmailTransportFactory(null);
  vi.restoreAllMocks();
});

describe("Queue Consumers Integration", () => {
  it("fulfillment.rto consumer looks up order and sends order_rto email", async () => {
    await handleFulfillmentRtoJob(rwDb.db, logger, {
      tenantId,
      fulfillmentId,
      orderId,
    });

    expect(sentMails).toHaveLength(1);
    const sent = sentMails[0]!;
    expect(sent.to).toBe("rto-customer@example.com");
    expect(sent.subject).toContain("Return to Origin Initiated");
    expect(String(sent.from)).toContain("Test Store E1");
    expect(String(sent.html)).toContain("We couldn&#39;t deliver your order");
    expect(String(sent.html)).toContain("ORD-E1-001");
    expect(String(sent.text)).toContain("being returned to us");
    expect(String(sent.text)).not.toContain("Template:");
  });

  it("cart.abandoned consumer sends abandoned_cart_recovery email", async () => {
    await handleCartAbandonedJob(rwDb.db, logger, {
      tenantId,
      cartId,
      token: "cart_tok_e1",
      email: "abandoned-cart@example.com",
    });

    expect(sentMails).toHaveLength(1);
    const sent = sentMails[0]!;
    expect(sent.to).toBe("abandoned-cart@example.com");
    expect(sent.subject).toBe("Did you leave something behind?");
    expect(String(sent.html)).toContain("Did you leave something behind?");
    expect(String(sent.html)).toContain("https://test-store-e1.gobs.cloud/cart");
    expect(String(sent.text)).toContain("Return to your cart: https://test-store-e1.gobs.cloud/cart");
    expect(String(sent.text)).not.toContain("Template:");
  });

  it("cart.abandoned consumer skips email when no email address is on payload", async () => {
    await handleCartAbandonedJob(rwDb.db, logger, {
      tenantId,
      cartId,
      token: "cart_tok_no_email",
    });

    expect(sentMails).toHaveLength(0);
  });

  it("throws error on retryable email delivery failure to trigger pg-boss retry", async () => {
    setPlatformEmailTransportFactory(() => {
      return {
        sendMail: async () => {
          throw new Error("SMTP connection timeout");
        },
      } as unknown as Transporter;
    });

    await expect(
      handleFulfillmentRtoJob(rwDb.db, logger, {
        tenantId,
        fulfillmentId,
        orderId,
      }),
    ).rejects.toThrow(/Transactional email \[order_rto\] delivery failed: SMTP connection timeout/);
  });

  it("does not throw when platform email is unconfigured (non-retryable)", async () => {
    // Disable platform email settings in DB
    const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pgClient.connect();
    await pgClient.query("UPDATE platform_email_settings SET enabled = false WHERE id = 'default'");
    await pgClient.end();

    try {
      // Should complete cleanly without throwing (logged as warning)
      await expect(
        handleFulfillmentRtoJob(rwDb.db, logger, {
          tenantId,
          fulfillmentId,
          orderId,
        }),
      ).resolves.toBeUndefined();
    } finally {
      const pgClient2 = new (await import("pg")).default.Client({ connectionString: superUrl });
      await pgClient2.connect();
      await pgClient2.query("UPDATE platform_email_settings SET enabled = true WHERE id = 'default'");
      await pgClient2.end();
    }
  });

  describe("sweepAbandonedCarts", () => {
    const sweepCartA = "0199a0e1-0000-7000-8000-000000000041";
    const sweepCartB = "0199a0e1-0000-7000-8000-000000000042";

    async function seedStaleCart(id: string, token: string) {
      const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
      await pgClient.connect();
      await pgClient.query(`DELETE FROM carts WHERE id IN ('${sweepCartA}', '${sweepCartB}')`);
      await pgClient.query(
        `INSERT INTO carts (id, tenant_id, token, email, status, last_activity_at)
         VALUES ('${id}', '${tenantId}', '${token}', 'sweep@example.com', 'active', now() - interval '3 hours')`,
      );
      await pgClient.end();
    }

    async function recoverySentAt(id: string): Promise<unknown> {
      const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
      await pgClient.connect();
      const { rows } = await pgClient.query(`SELECT recovery_sent_at FROM carts WHERE id = '${id}'`);
      await pgClient.end();
      return rows[0]?.recovery_sent_at;
    }

    it("with a jobs provider, enqueues cart.abandoned with the email and does NOT send directly", async () => {
      await seedStaleCart(sweepCartA, "sweep_tok_a");
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      const send = vi.fn().mockResolvedValue("job-1");

      const res = await sweepAbandonedCarts(rwDb.db, tenantId, { jobs: { send } });

      expect(res.abandonedCount).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[1]).toMatchObject({ cartId: sweepCartA, email: "sweep@example.com" });
      expect(await recoverySentAt(sweepCartA)).not.toBeNull();
    });

    it("without a jobs provider, logs a warning and leaves recovery unsent when the email fails", async () => {
      await seedStaleCart(sweepCartB, "sweep_tok_b");
      setPlatformEmailTransportFactory(() => {
        return {
          sendMail: async () => {
            throw new Error("boom");
          },
        } as unknown as Transporter;
      });
      const warn = vi.fn();

      const res = await sweepAbandonedCarts(rwDb.db, tenantId, { log: { warn } });

      expect(res.emailsSentCount).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({ cartId: sweepCartB, status: "failed" });
      expect(await recoverySentAt(sweepCartB)).toBeNull();
    });
  });
});
