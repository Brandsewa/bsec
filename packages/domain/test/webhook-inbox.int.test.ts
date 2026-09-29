import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  orders,
  inventoryReservations,
  webhookInbox,
  withTenant,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  withIdempotencyKey,
  IdempotencyConflictError,
} from "../src/system/idempotency.ts";
import {
  receiveWebhook,
  processWebhookInboxItem,
} from "../src/system/webhooks.ts";
import { reserveInventory } from "../src/catalog/inventory-reservations.ts";

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

const orgId = "0199a000-0000-7000-8000-000000000000";
const tenantId = "0199a000-0000-7000-8000-000000000001";
const locationId = "0199a000-0000-7000-8000-000000000010";
const productId = "0199a000-0000-7000-8000-000000000020";
const variantId = "0199a000-0000-7000-8000-000000000030";

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

  const pgClient = new (await import("pg")).default.Client({ connectionString: as("app_rw", PW.rw) });
  await pgClient.connect();
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store', 'Test Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse') ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug) VALUES ('${productId}', '${tenantId}', 'Test Product', 'test-prod') ON CONFLICT DO NOTHING;
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'SKU-100', 'Default', 5000) ON CONFLICT DO NOTHING;
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a000-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 50, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 50, reserved = 0;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("PLAN §5.10 & §11.4 Idempotency & Webhook Inbox Integration", () => {
  it("withIdempotencyKey executes once, returns cached response on replay, and rejects payload divergence", async () => {
    let executions = 0;
    const idempotencyKey = "order-create-test-key-01";
    const route = "/api/storefront/checkout/place-order";
    const payload = { cartId: "cart-123", email: "alice@example.com" };

    // First call: executes fn
    const res1 = await withIdempotencyKey(rwDb.db, tenantId, route, idempotencyKey, payload, async () => {
      executions++;
      return { status: 201, body: { orderId: "ord_1", number: "ORD-001" } };
    });

    expect(executions).toBe(1);
    expect(res1.status).toBe(201);
    expect(res1.body).toEqual({ orderId: "ord_1", number: "ORD-001" });
    expect(res1.cached).toBe(false);

    // Replay call: does not execute fn, returns cached response
    const res2 = await withIdempotencyKey(rwDb.db, tenantId, route, idempotencyKey, payload, async () => {
      executions++;
      return { status: 201, body: { orderId: "ord_SHOULD_NOT_EXECUTE" } };
    });

    expect(executions).toBe(1); // fn was NOT called
    expect(res2.status).toBe(201);
    expect(res2.body).toEqual({ orderId: "ord_1", number: "ORD-001" });
    expect(res2.cached).toBe(true);

    // Replay with different payload: rejected with IdempotencyConflictError
    const divergentPayload = { cartId: "cart-DIFFERENT", email: "alice@example.com" };
    await expect(
      withIdempotencyKey(rwDb.db, tenantId, route, idempotencyKey, divergentPayload, async () => {
        executions++;
        return { status: 201, body: {} };
      })
    ).rejects.toThrow(IdempotencyConflictError);

    expect(executions).toBe(1);
  });

  it("PLAN §11.4 Webhook Inbox: verifies, sanitizes, deduplicates on (provider, event_id), and allows cross-provider IDs", async () => {
    const rawRazorpayPayload = {
      event: "payment.captured",
      contains_secret: "super_secret_merchant_key",
      payment: {
        id: "pay_123",
        card: {
          number: "4111111111111111",
          cvv: "123",
        },
      },
    };

    // 1. Ingest Razorpay webhook
    const firstIngest = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId: "evt_shared_001",
      tenantId,
      signatureValid: true,
      rawPayload: rawRazorpayPayload,
    });

    expect(firstIngest.duplicate).toBe(false);
    expect(firstIngest.inboxId).toBeDefined();

    // Verify sanitized payload in DB: card number and cvv stripped
    const [saved] = await rwDb.db
      .select()
      .from(webhookInbox)
      .where(eq(webhookInbox.id, firstIngest.inboxId!));
    expect(saved).toBeDefined();
    expect(saved?.signatureValid).toBe(true);
    const sanitized = saved?.payloadSanitized as Record<string, unknown>;
    expect(sanitized.contains_secret).toBeUndefined();
    const payment = sanitized.payment as Record<string, unknown> | undefined;
    expect(payment?.card).toBeUndefined();
    expect(payment?.id).toBe("pay_123");

    // 2. Duplicate Razorpay webhook: ON CONFLICT (provider, event_id) DO NOTHING -> duplicate: true
    const duplicateIngest = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId: "evt_shared_001",
      tenantId,
      signatureValid: true,
      rawPayload: rawRazorpayPayload,
    });
    expect(duplicateIngest.duplicate).toBe(true);

    // 3. Same event_id from a DIFFERENT provider (e.g. shiprocket): SUCCEEDS!
    const shiprocketIngest = await receiveWebhook(rwDb.db, {
      provider: "shiprocket",
      eventId: "evt_shared_001",
      tenantId,
      signatureValid: true,
      rawPayload: { tracking: "SR_1234" },
    });
    expect(shiprocketIngest.duplicate).toBe(false);
    expect(shiprocketIngest.inboxId).toBeDefined();
    expect(shiprocketIngest.inboxId).not.toBe(firstIngest.inboxId);
  });

  it("processes webhook idempotently: transitions order and commits reservation", async () => {
    // 1. Create order and active reservation
    const testOrderId = "0199a000-0000-7000-8000-000000000888";
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.insert(orders).values({
        id: testOrderId,
        tenantId,
        number: "ORD-WH-001",
        email: "bob@example.com",
        phone: "9876543210",
        status: "pending",
        paymentStatus: "pending",
        grandTotal: 5000,
        subtotal: 5000,
        shippingAddress: {},
      });
    });

    const [reservation] = await reserveInventory(
      rwDb.db,
      tenantId,
      [{ variantId, locationId, qty: 1 }],
      { orderId: testOrderId }
    );
    expect(reservation).toBeDefined();

    // 2. Ingest Razorpay payment.captured webhook referencing order
    const webhookRes = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId: "evt_pay_cap_999",
      tenantId,
      signatureValid: true,
      rawPayload: {
        event: "payment.captured",
        order_id: testOrderId,
        payment_id: "pay_xyz_999",
      },
    });

    expect(webhookRes.duplicate).toBe(false);

    // 3. Process the webhook
    const processRes = await processWebhookInboxItem(rwDb.db, webhookRes.inboxId!);
    expect(processRes.success).toBe(true);

    // Verify order is confirmed
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [orderRow] = await tx.select().from(orders).where(eq(orders.id, testOrderId));
      expect(orderRow?.status).toBe("confirmed");
      expect(orderRow?.paymentStatus).toBe("paid");

      // Verify reservation committed
      const [resRow] = await tx
        .select()
        .from(inventoryReservations)
        .where(eq(inventoryReservations.id, reservation!.id));
      expect(resRow?.status).toBe("committed");
    });

    // 4. Reprocessing the same webhook inbox item is idempotent
    const secondProcessRes = await processWebhookInboxItem(rwDb.db, webhookRes.inboxId!);
    expect(secondProcessRes.alreadyProcessed).toBe(true);
  });
});
