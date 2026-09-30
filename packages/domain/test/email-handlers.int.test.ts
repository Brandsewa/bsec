import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, withTenant, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import {
  handleFulfillmentShippedJob,
  handleFulfillmentDeliveredJob,
  handleReturnRequestedJob,
  handleRefundProcessedJob,
} from "../src/jobs.ts";

const PW = {
  owner: "o_test",
  rw: "rw_test",
  platform: "p_test",
};

function as(user: string, pw: string) {
  const u = new URL(superUrl);
  u.username = user;
  u.password = pw;
  return u.toString();
}

let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
const logger = pino({ level: "silent" });

// Unique fixture prefix for M6 email handler tests: 0199a063
const orgId = "0199a063-0000-7000-8000-000000000000";
const tenantId = "0199a063-0000-7000-8000-000000000001";
const orderId = "0199a063-0000-7000-8000-000000000100";
const orderNumber = "ORD-0199a063-001";
const customerEmail = "customer@example.com";

let originalFetch: typeof globalThis.fetch;
let originalResendKey: string | undefined;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw));

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM email_log WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM tenants WHERE id = '${tenantId}';
    DELETE FROM organizations WHERE id = '${orgId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");

  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org 0199a063') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'tenant-0199a063', 'Tenant 0199a063') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO orders (id, tenant_id, number, email, phone, subtotal, grand_total, shipping_address)
    VALUES ('${orderId}', '${tenantId}', '${orderNumber}', '${customerEmail}', '+919876543210', 99900, 99900, '{"city":"Mumbai"}')
    ON CONFLICT DO NOTHING;
  `);

  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalResendKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_mock_api_key_0199a063";

  // Mock outer network edge: Resend API HTTP endpoint
  globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("api.resend.com/emails")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "msg_resend_mock_0199a063" }),
        text: async () => JSON.stringify({ id: "msg_resend_mock_0199a063" }),
      } as unknown as Response;
    }
    return originalFetch(url);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalResendKey !== undefined) {
    process.env.RESEND_API_KEY = originalResendKey;
  } else {
    delete process.env.RESEND_API_KEY;
  }
  vi.restoreAllMocks();
});

describe("M5 carry-over: Email job handlers asserting real email_log rows (PLAN §5.10, §11)", () => {
  it("handleFulfillmentShippedJob creates sent email_log row with carrier and awb", async () => {
    const fulfillmentId = "0199a063-0000-7000-8000-000000000201";
    await handleFulfillmentShippedJob(rwDb.db, logger, {
      tenantId,
      fulfillmentId,
      orderId,
      carrier: "Delhivery",
      awb: "DELHI-987654",
    });

    const rows = await withTenant(rwDb.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.emailLog)
        .where(eq(schema.emailLog.eventRef, `fulfillment_${fulfillmentId}`));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.template).toBe("order_shipped");
    expect(row.toEmail).toBe(customerEmail);
    expect(row.subject).toContain(orderNumber);
    expect(row.status).toBe("sent");
    expect(row.providerId).toBe("msg_resend_mock_0199a063");
    expect(row.sentAt).not.toBeNull();
  });

  it("handleFulfillmentDeliveredJob creates sent email_log row", async () => {
    const fulfillmentId = "0199a063-0000-7000-8000-000000000202";
    await handleFulfillmentDeliveredJob(rwDb.db, logger, {
      tenantId,
      fulfillmentId,
      orderId,
    });

    const rows = await withTenant(rwDb.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.emailLog)
        .where(eq(schema.emailLog.eventRef, `delivered_${fulfillmentId}`));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.template).toBe("order_delivered");
    expect(row.toEmail).toBe(customerEmail);
    expect(row.subject).toContain(orderNumber);
    expect(row.status).toBe("sent");
    expect(row.providerId).toBe("msg_resend_mock_0199a063");
  });

  it("handleReturnRequestedJob creates sent email_log row with return number", async () => {
    const returnId = "0199a063-0000-7000-8000-000000000203";
    const returnNumber = "RET-0199a063-001";
    await handleReturnRequestedJob(rwDb.db, logger, {
      tenantId,
      returnId,
      orderId,
      returnNumber,
    });

    const rows = await withTenant(rwDb.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.emailLog)
        .where(eq(schema.emailLog.eventRef, `return_${returnId}`));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.template).toBe("return_requested");
    expect(row.toEmail).toBe(customerEmail);
    expect(row.subject).toContain(returnNumber);
    expect(row.status).toBe("sent");
    expect(row.providerId).toBe("msg_resend_mock_0199a063");
  });

  it("handleRefundProcessedJob creates sent email_log row with refund amount", async () => {
    const refundId = "0199a063-0000-7000-8000-000000000204";
    const refundAmount = 45000;
    await handleRefundProcessedJob(rwDb.db, logger, {
      tenantId,
      refundId,
      orderId,
      refundAmount,
    });

    const rows = await withTenant(rwDb.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.emailLog)
        .where(eq(schema.emailLog.eventRef, `refund_${orderId}_${refundId}`));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.template).toBe("refund_processed");
    expect(row.toEmail).toBe(customerEmail);
    expect(row.subject).toContain(orderNumber);
    expect(row.status).toBe("sent");
    expect(row.providerId).toBe("msg_resend_mock_0199a063");
  });

  it("two different refunds on one order produce two email_log rows, and a retry of the same job produces one", async () => {
    const return1Id = "0199a063-0000-7000-8000-000000000301";
    const return2Id = "0199a063-0000-7000-8000-000000000302";

    // 1. Process first refund
    await handleRefundProcessedJob(rwDb.db, logger, {
      tenantId,
      orderId,
      returnId: return1Id,
      refundAmount: 20000,
    });

    // 2. Retry the first refund job (must be deduplicated)
    await handleRefundProcessedJob(rwDb.db, logger, {
      tenantId,
      orderId,
      returnId: return1Id,
      refundAmount: 20000,
    });

    // 3. Process a second distinct refund on the SAME order
    await handleRefundProcessedJob(rwDb.db, logger, {
      tenantId,
      orderId,
      returnId: return2Id,
      refundAmount: 30000,
    });

    const rows = await withTenant(rwDb.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.emailLog)
        .where(
          and(
            eq(schema.emailLog.template, "refund_processed"),
            sql`${schema.emailLog.eventRef} LIKE ${`refund_${orderId}_0199a063-0000-7000-8000-00000000030%`}`,
          ),
        );
    });

    // Two distinct refunds on order -> exactly 2 rows (retry did not insert a 3rd row)
    expect(rows.length).toBe(2);
    const eventRefs = rows.map((r) => r.eventRef).sort();
    expect(eventRefs).toEqual([`refund_${orderId}_${return1Id}`, `refund_${orderId}_${return2Id}`]);
  });
});
