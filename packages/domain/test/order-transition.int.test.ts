import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  orders,
  orderEvents,
  withTenant,
  type DbHandle,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { createRuntime, type Runtime, type TenantContext } from "../src/index.ts";
import {
  transitionOrder,
  InvalidStateTransitionError,
} from "../src/orders/state-machine.ts";

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
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });

  const orgId = "0199a0c5-0000-7000-8000-000000000000";
  const tenantId = "0199a0c5-0000-7000-8000-000000000001";
  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM order_events WHERE tenant_id = '${tenantId}';
    DELETE FROM order_notes WHERE tenant_id = '${tenantId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store-c5', 'Test Store') ON CONFLICT DO NOTHING;
  `);
  await pgClient.end();
}, 180_000);



afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("Order State Machine PostgreSQL Integration", () => {
  const tenantId = "0199a0c5-0000-7000-8000-000000000001";
  const ctx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "staff_123" },
    roles: ["admin"],
    permissions: ["orders.write"],
    requestId: "req_test",
  };

  it("transitions order through valid flow and writes audit events", async () => {
    // 1. Create order in pending status
    const orderId = "0199a0c5-0000-7000-8000-0000000000aa";
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        tenantId,
        number: "ORD-TEST-001",
        email: "test@example.com",
        phone: "9876543210",
        status: "pending",
        paymentStatus: "pending",
        fulfillmentStatus: "unfulfilled",
        subtotal: 10000,
        grandTotal: 10000,
        shippingAddress: { city: "Mumbai" },
      });
    });

    // 2. Pending -> Confirmed
    const confirmResult = await transitionOrder(rt, ctx, orderId, {
      type: "order.confirm",
      reason: "Payment verified",
    });
    expect(confirmResult.previousStatus).toBe("pending");
    expect(confirmResult.newStatus).toBe("confirmed");

    // Verify order_events audit trail
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const events = await tx
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, orderId));
      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe("order.confirm");
      expect(events[0]?.actorType).toBe("staff");
      expect(events[0]?.actorId).toBe("staff_123");
    });

    // 3. Confirmed -> Processing
    const processResult = await transitionOrder(rt, ctx, orderId, {
      type: "order.process",
    });
    expect(processResult.newStatus).toBe("processing");
  });

  it("rejects invalid state transition and preserves state", async () => {
    const orderId = "0199a0c5-0000-7000-8000-0000000000bb";
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        tenantId,
        number: "ORD-TEST-002",
        email: "test@example.com",
        phone: "9876543210",
        status: "pending",
        grandTotal: 5000,
        subtotal: 5000,
        shippingAddress: {},
      });
    });

    // Attempt invalid jump: pending -> delivered
    await expect(
      transitionOrder(rt, ctx, orderId, { type: "order.deliver" }),
    ).rejects.toThrow(InvalidStateTransitionError);

    // Verify status was not modified
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const rows = await tx.select().from(orders).where(eq(orders.id, orderId));
      expect(rows[0]?.status).toBe("pending");
    });
  });

  it("enforces cross-entity guard: cannot cancel order when shipped", async () => {
    const orderId = "0199a0c5-0000-7000-8000-0000000000cc";
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        tenantId,
        number: "ORD-TEST-003",
        email: "test@example.com",
        phone: "9876543210",
        status: "processing",
        fulfillmentStatus: "in_transit", // Shipped!
        grandTotal: 5000,
        subtotal: 5000,
        shippingAddress: {},
      });
    });

    await expect(
      transitionOrder(rt, ctx, orderId, {
        type: "order.cancel",
        reason: "Customer requested",
      }),
    ).rejects.toThrow(/Cannot cancel order with fulfillment status 'in_transit'/);
  });
});
