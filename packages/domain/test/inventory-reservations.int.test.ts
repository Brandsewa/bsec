import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  inventoryLevels,
  inventoryMovements,
  inventoryReservations,
  withTenant,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  reserveInventory,
  commitReservation,
  releaseReservation,
  expireOldReservations,
  InsufficientInventoryError,
} from "../src/catalog/inventory-reservations.ts";

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

const orgId = "0199a0c3-0000-7000-8000-000000000000";
const tenantId = "0199a0c3-0000-7000-8000-000000000001";
const locationId = "0199a0c3-0000-7000-8000-000000000010";
const productId = "0199a0c3-0000-7000-8000-000000000020";
const variantId = "0199a0c3-0000-7000-8000-000000000030";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 30 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM inventory_reservations WHERE tenant_id = '${tenantId}';
    DELETE FROM inventory_movements WHERE tenant_id = '${tenantId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store-c3', 'Test Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse') ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug) VALUES ('${productId}', '${tenantId}', 'Test Product', 'test-prod') ON CONFLICT DO NOTHING;
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'SKU-100', 'Default', 5000) ON CONFLICT DO NOTHING;
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a0c3-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 100, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 100, reserved = 0;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("PLAN §11.3 Guarded Inventory Reservation & Concurrency Proof", () => {
  it("PLAN §11.3 Concurrency Proof: 500 concurrent attempts against stock of 100 -> exactly 100 reservations, 0 oversold", async () => {
    const totalAttempts = 500;

    const attempts = Array.from({ length: totalAttempts }, async (_, idx) => {
      try {
        const reservations = await reserveInventory(
          rwDb.db,
          tenantId,
          [{ variantId, locationId, qty: 1 }],
          { cartId: `0199a0c3-0000-7000-8000-${String(idx).padStart(12, "0")}` }
        );
        return { success: true, reservations };
      } catch (err) {
        if (err instanceof InsufficientInventoryError) {
          return { success: false, error: err.message };
        }
        throw err;
      }
    });

    const results = await Promise.all(attempts);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Exactly 100 reservations granted, exactly 400 rejected
    expect(successful.length).toBe(100);
    expect(failed.length).toBe(400);

    // Verify database state: on_hand = 100, reserved = 100, available = 0
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(inventoryLevels)
        .where(
          sql`${inventoryLevels.variantId} = ${variantId} AND ${inventoryLevels.locationId} = ${locationId}`
        );
      expect(rows.length).toBe(1);
      expect(rows[0]?.onHand).toBe(100);
      expect(rows[0]?.reserved).toBe(100);
      expect(rows[0]?.available).toBe(0);

      const activeReservations = await tx
        .select()
        .from(inventoryReservations)
        .where(
          sql`${inventoryReservations.variantId} = ${variantId} AND ${inventoryReservations.status} = 'active'`
        );
      expect(activeReservations.length).toBe(100);
    });
  }, 90_000);

  it("commits reservation on payment: on_hand and reserved decrease, movement row sold", async () => {
    // Pick one active reservation to commit
    let reservationIdToCommit: string | undefined;
    const testOrderId = "0199a0c3-0000-7000-8000-000000000999";

    await withTenant(rwDb.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(inventoryReservations)
        .where(
          sql`${inventoryReservations.variantId} = ${variantId} AND ${inventoryReservations.status} = 'active'`
        )
        .limit(1);
      reservationIdToCommit = rows[0]?.id;
      // Associate with order
      await tx
        .update(inventoryReservations)
        .set({ orderId: testOrderId })
        .where(eq(inventoryReservations.id, reservationIdToCommit!));
    });

    expect(reservationIdToCommit).toBeDefined();

    // Commit reservation
    const commitRes = await commitReservation(rwDb.db, tenantId, { orderId: testOrderId });
    expect(commitRes.committedCount).toBe(1);

    // Verify DB state
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const resRow = await tx
        .select()
        .from(inventoryReservations)
        .where(eq(inventoryReservations.id, reservationIdToCommit!));
      expect(resRow[0]?.status).toBe("committed");

      const level = await tx
        .select()
        .from(inventoryLevels)
        .where(
          sql`${inventoryLevels.variantId} = ${variantId} AND ${inventoryLevels.locationId} = ${locationId}`
        );
      // on_hand was 100, now 99; reserved was 100, now 99
      expect(level[0]?.onHand).toBe(99);
      expect(level[0]?.reserved).toBe(99);

      // Verify movement ledger row 'sold'
      const movements = await tx
        .select()
        .from(inventoryMovements)
        .where(
          sql`${inventoryMovements.variantId} = ${variantId} AND ${inventoryMovements.referenceId} = ${testOrderId}`
        );
      expect(movements.length).toBe(1);
      expect(movements[0]?.delta).toBe(-1);
      expect(movements[0]?.reason).toBe("sold");
    });

    // Idempotent commit: calling again changes nothing
    const secondCommit = await commitReservation(rwDb.db, tenantId, { orderId: testOrderId });
    expect(secondCommit.committedCount).toBe(0);
  });

  it("releases active reservations and is idempotent on expiry", async () => {
    // Pick another active reservation and expire it manually
    let resIdToExpire: string | undefined;
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(inventoryReservations)
        .where(
          sql`${inventoryReservations.variantId} = ${variantId} AND ${inventoryReservations.status} = 'active'`
        )
        .limit(1);
      resIdToExpire = rows[0]?.id;
      // Set expires_at in the past
      await tx
        .update(inventoryReservations)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(inventoryReservations.id, resIdToExpire!));
    });

    expect(resIdToExpire).toBeDefined();

    // Run expiration job
    const expireRes = await expireOldReservations(rwDb.db);
    expect(expireRes.expiredCount).toBeGreaterThanOrEqual(1);

    // Verify reservation status is 'expired' and reserved decreased
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const resRow = await tx
        .select()
        .from(inventoryReservations)
        .where(eq(inventoryReservations.id, resIdToExpire!));
      expect(resRow[0]?.status).toBe("expired");

      const level = await tx
        .select()
        .from(inventoryLevels)
        .where(
          sql`${inventoryLevels.variantId} = ${variantId} AND ${inventoryLevels.locationId} = ${locationId}`
        );
      // reserved decreased from 99 to 98
      expect(level[0]?.reserved).toBe(98);
    });

    // Idempotent second run: no additional decrements
    const secondExpire = await expireOldReservations(rwDb.db);
    expect(secondExpire.expiredCount).toBe(0);

    // Test manual releaseReservation
    const [manualRes] = await reserveInventory(rwDb.db, tenantId, [{ variantId, locationId, qty: 1 }]);
    if (!manualRes) throw new Error("Expected reservation");
    const releaseResult = await releaseReservation(rwDb.db, tenantId, { reservationIds: [manualRes.id] });
    expect(releaseResult.releasedCount).toBe(1);
  });
});
