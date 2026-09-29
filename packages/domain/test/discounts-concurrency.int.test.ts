import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  discounts,
  discountRedemptions,
  withTenant,
  type DbHandle,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import type { StorePermission } from "@bs/auth";
import { createRuntime, type Runtime, type TenantContext } from "../src/index.ts";
import { redeemDiscount } from "../src/orders/discounts.ts";

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
  rwDb = createDb(as("app_rw", PW.rw), { max: 20 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 20 });

  const orgId = "0199a0d1-0000-7000-8000-000000000000";
  const tenantId = "0199a0d1-0000-7000-8000-000000000001";
  const pgClient = new (await import("pg")).default.Client({ connectionString: as("app_rw", PW.rw) });
  await pgClient.connect();
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Discount Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'discount-store-1', 'Discount Store') ON CONFLICT DO NOTHING;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("PLAN §15 Concurrency Proof: Simultaneous Coupon Redemption", () => {
  const tenantId = "0199a0d1-0000-7000-8000-000000000001";
  const ctx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" },
    roles: ["admin"],
    permissions: ["discounts.write"] as readonly StorePermission[],
    requestId: "test_concurrency",
  };

  it("proves 50 concurrent redemption attempts against usage_limit of 10 results in exactly 10 successes and 0 over-redemptions", async () => {
    const discountId = "0199a0d1-0000-7000-8000-000000000099";
    const usageLimit = 10;

    // 1. Setup discount with strict usage_limit = 10
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx.delete(discountRedemptions).where(eq(discountRedemptions.discountId, discountId));
      await tx.delete(discounts).where(eq(discounts.id, discountId));
      await tx
        .insert(discounts)
        .values({
          id: discountId,
          tenantId,
          code: "FLASH10",
          title: "Flash Sale 10 uses",
          type: "fixed",
          value: 10000,
          usageLimit,
          usedCount: 0,
          status: "active",
        });
    });

    // Also seed 50 dummy orders to attach redemptions
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const { orders } = await import("@bs/db");
      for (let i = 0; i < 50; i++) {
        const ordId = `0199a0d1-0000-7000-8000-0000000001${String(i).padStart(2, "0")}`;
        await tx
          .insert(orders)
          .values({
            id: ordId,
            tenantId,
            number: `ORD-D-${i}`,
            email: `buyer${i}@example.com`,
            phone: "9999999999",
            status: "pending",
            paymentStatus: "paid",
            subtotal: 50000,
            grandTotal: 50000,
            shippingAddress: { city: "Delhi" },
          })
          .onConflictDoNothing();
      }
    });

    // 2. Fire 50 genuinely concurrent Promise.all requests against real PostgreSQL 18
    const attempts = Array.from({ length: 50 }, (_, i) => {
      const ordId = `0199a0d1-0000-7000-8000-0000000001${String(i).padStart(2, "0")}`;
      return redeemDiscount(rt, ctx, {
        discountId,
        orderId: ordId,
        amount: 10000,
      });
    });

    const results = await Promise.all(attempts);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Exact invariants:
    expect(successful.length).toBe(usageLimit); // Exactly 10
    expect(failed.length).toBe(40); // Exactly 40 rejected cleanly

    // Verify database state directly
    const [finalDiscount] = await withTenant(rwDb.db, tenantId, async (tx) => {
      return tx.select().from(discounts).where(eq(discounts.id, discountId));
    });

    expect(finalDiscount?.usedCount).toBe(usageLimit);

    const totalRedemptions = await withTenant(rwDb.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(discountRedemptions)
        .where(eq(discountRedemptions.discountId, discountId));
    });

    expect(totalRedemptions.length).toBe(usageLimit);
  });
});
