import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Client as PgClient } from "pg";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  createStoreOwner,
  getAdminMe,
  removeDemoStore,
  searchStorefrontProducts,
  seedDemoStore,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;
let pg: PgClient;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const orgId = "0199a0a3-0000-7000-8000-000000000000";
const controlTenant = "0199a0a3-0000-7000-8000-000000000001";
const OWNER = "demo-owner@demo-store-test.example";

async function one<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const res = await pg.query(query, params);
  return res.rows as T[];
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
  rwDb = createDb(as("app_rw", PW.rw), { max: 5 });
  rt = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });

  pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Demo Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${controlTenant}', '${orgId}', 'demo-control-a3', 'Control Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${controlTenant}', false);
    INSERT INTO products (tenant_id, title, slug, status) VALUES ('${controlTenant}', 'Real Product', 'real-product', 'active') ON CONFLICT DO NOTHING;
    -- another store with its own default warehouse: the seed runs as the platform role (bypasses RLS), so every lookup must filter by tenant itself
    INSERT INTO locations (tenant_id, name, is_default) VALUES ('${controlTenant}', 'Other Store Warehouse', true) ON CONFLICT DO NOTHING;
  `);
  await createStoreOwner(rwDb.db, { email: OWNER, name: "Demo Owner", password: "demo-owner-password", tenantSlug: "demo-control-a3" });
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("demo store", () => {
  let tenantId: string;

  it("seeds a separate store with realistic data across every admin area", async () => {
    const res = await seedDemoStore(rt, { ownerEmail: OWNER });
    tenantId = res.tenantId;
    expect(res.alreadySeeded).toBe(false);
    expect(res.slug).toBe("demo-store");
    expect(tenantId).not.toBe(controlTenant);

    const products = await one<{ status: string; n: number }>(`select status, count(*)::int n from products where tenant_id = $1 group by status`, [tenantId]);
    expect(Object.fromEntries(products.map((r) => [r.status, r.n]))).toMatchObject({ active: 8, draft: 1, archived: 1 });

    const orderStatuses = await one<{ status: string }>(`select distinct status from orders where tenant_id = $1`, [tenantId]);
    const statuses = orderStatuses.map((r) => r.status);
    for (const s of ["pending", "confirmed", "cancelled"]) expect(statuses).toContain(s);
    expect((await one<{ n: number }>(`select count(*)::int n from orders where tenant_id = $1`, [tenantId]))[0]!.n).toBe(res.orders);

    const fulfillmentStatuses = (await one<{ status: string }>(`select distinct status from fulfillments where tenant_id = $1`, [tenantId])).map((r) => r.status);
    for (const s of ["label_created", "in_transit", "delivered", "rto"]) expect(fulfillmentStatuses).toContain(s);

    expect((await one<{ n: number }>(`select count(*)::int n from invoices where tenant_id = $1`, [tenantId]))[0]!.n).toBeGreaterThanOrEqual(4);
    expect((await one<{ n: number }>(`select count(*)::int n from customers where tenant_id = $1`, [tenantId]))[0]!.n).toBe(8);
    expect((await one<{ n: number }>(`select count(*)::int n from discounts where tenant_id = $1`, [tenantId]))[0]!.n).toBe(3);
    expect((await one<{ n: number }>(`select count(*)::int n from returns where tenant_id = $1`, [tenantId]))[0]!.n).toBe(1);

    // an out-of-stock and a low-stock variant exist so those filters have something to show
    const stock = await one<{ available: number }>(`select available from inventory_levels where tenant_id = $1`, [tenantId]);
    expect(stock.some((r) => r.available === 0 || r.available <= 3)).toBe(true);
  });

  it("products saved as active in the admin are what the storefront shows (draft and archived are hidden)", async () => {
    const ctx: TenantContext = {
      tenantId,
      storeStatus: "live",
      actor: { type: "anonymous" },
      roles: [],
      permissions: [],
      requestId: "req_storefront_check",
    };
    const find = async (q: string) => (await searchStorefrontProducts(rt, ctx, q, { page: 1, limit: 20 })).items.map((p) => p.title);
    expect(await find("Kurta")).toContain("Cotton Kurta");
    expect(await find("Wallet")).toContain("Leather Wallet");
    expect(await find("Scarf")).not.toContain("Silk Scarf"); // draft
    expect(await find("Tote")).not.toContain("Old Season Tote"); // archived
  });

  it("only uses obviously fake contact details and never sends email or calls a provider", async () => {
    const emails = await one<{ email: string }>(`select email from orders where tenant_id = $1`, [tenantId]);
    expect(emails.every((r) => r.email.endsWith("@demo.example"))).toBe(true);
    expect((await one<{ n: number }>(`select count(*)::int n from email_log where tenant_id = $1`, [tenantId]))[0]!.n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int n from payment_intents where tenant_id = $1 and provider <> 'cod'`, [tenantId]))[0]!.n).toBe(0);
  });

  it("gives the owner access to the demo store next to their real store", async () => {
    const [u] = await one<{ id: string }>(`select id from users where email = $1`, [OWNER]);
    const me = await getAdminMe(rt, u!.id);
    expect(me.stores.map((s) => s.slug).sort()).toEqual(["demo-control-a3", "demo-store"]);
    expect(me.stores.find((s) => s.slug === "demo-store")?.role).toBe("store_owner");
  });

  it("is idempotent: running it again adds nothing", async () => {
    const before = (await one<{ n: number }>(`select count(*)::int n from orders where tenant_id = $1`, [tenantId]))[0]!.n;
    const again = await seedDemoStore(rt, { ownerEmail: OWNER });
    expect(again.alreadySeeded).toBe(true);
    expect((await one<{ n: number }>(`select count(*)::int n from orders where tenant_id = $1`, [tenantId]))[0]!.n).toBe(before);
  });

  it("removes every row of the demo store, leaves other stores alone, and can be re-seeded", async () => {
    const removed = await removeDemoStore(rt);
    expect(removed.removed).toBe(true);
    expect(removed.deleted.orders).toBeGreaterThan(0);

    const tables = await one<{ table_name: string }>(`
      select c.table_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'tenants'`);
    for (const { table_name } of tables) {
      const [row] = await one<{ n: number }>(`select count(*)::int n from "${table_name}" where tenant_id = $1`, [tenantId]);
      expect(row!.n, `leftover rows in ${table_name}`).toBe(0);
    }

    // the other store and the owner's login survive
    expect((await one<{ n: number }>(`select count(*)::int n from products where tenant_id = $1`, [controlTenant]))[0]!.n).toBe(1);
    expect((await one<{ n: number }>(`select count(*)::int n from users where email = $1`, [OWNER]))[0]!.n).toBe(1);
    expect((await one<{ status: string }>(`select status from tenants where id = $1`, [tenantId]))[0]!.status).toBe("archived");

    const reseeded = await seedDemoStore(rt, { ownerEmail: OWNER });
    expect(reseeded.alreadySeeded).toBe(false);
    expect(reseeded.tenantId).toBe(tenantId);
    expect(reseeded.orders).toBeGreaterThan(0);
  });

  it("refuses to remove any store other than the demo store", async () => {
    await expect(removeDemoStore(rt, "demo-control-a3")).rejects.toThrow(/Refusing/);
    expect((await one<{ n: number }>(`select count(*)::int n from products where tenant_id = $1`, [controlTenant]))[0]!.n).toBe(1);
  });
});
