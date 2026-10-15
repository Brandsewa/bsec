import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Client as PgClient } from "pg";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  createStoreOwner,
  getStorefrontCollection,
  seedThemeDemoCatalog,
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
let rtStorefront: Runtime;
let pg: PgClient;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const orgId = "0199a0a3-0000-7000-8000-0000000000b0";
const controlTenant = "0199a0a3-0000-7000-8000-0000000000b1";
const OWNER = "theme-demo-owner@demo-store-test.example";

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
  // The storefront reads as app_rw, where row level security scopes every query to one store. The platform role bypasses it
  // and would see other stores' products when test files share a database (as they do in CI).
  rtStorefront = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });

  pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Demo Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${controlTenant}', '${orgId}', 'themedemo-control-b7', 'Control Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${controlTenant}', false);
    INSERT INTO products (tenant_id, title, slug, status) VALUES ('${controlTenant}', 'Real Product', 'real-product', 'active') ON CONFLICT DO NOTHING;
    -- another store with its own default warehouse: the seed runs as the platform role (bypasses RLS), so every lookup must filter by tenant itself
    INSERT INTO locations (tenant_id, name, is_default) VALUES ('${controlTenant}', 'Other Store Warehouse', true) ON CONFLICT DO NOTHING;
  `);
  await createStoreOwner(rwDb.db, { email: OWNER, name: "Demo Owner", password: "demo-owner-password", tenantSlug: "themedemo-control-b7" });
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rwDb?.close();
  await rt?.close();
  await rtStorefront?.close();
  await container?.stop();
});

describe("theme demo catalog", () => {
  let tenantId: string;
  const anon = (id: string): TenantContext => ({ tenantId: id, storeStatus: "live", actor: { type: "anonymous" }, roles: [], permissions: [], requestId: "req_theme_demo" });

  it("seeds collections and products covering every storefront case", async () => {
    await seedDemoStore(rt, { ownerEmail: OWNER });
    const res = await seedThemeDemoCatalog(rt);
    tenantId = res.tenantId;
    expect(res.alreadySeeded).toBe(false);
    expect(res.collections).toBe(6);

    const byStatus = await one<{ status: string; n: number }>(`select status, count(*)::int n from products where tenant_id = $1 and 'theme-demo' = any(tags) group by status`, [tenantId]);
    expect(Object.fromEntries(byStatus.map((r) => [r.status, r.n]))).toMatchObject({ draft: 1, archived: 1 });
    expect((await one<{ n: number }>(`select count(*)::int n from variants v join products p on p.id = v.product_id and p.tenant_id = v.tenant_id where p.tenant_id = $1 and 'theme-demo' = any(p.tags)`, [tenantId]))[0]!.n).toBeGreaterThan(40);
    expect((await one<{ n: number }>(`select count(*)::int n from variants where tenant_id = $1 and compare_at_price > price`, [tenantId]))[0]!.n).toBeGreaterThan(0);
  });

  it("the storefront shows published collections with only active products, and the empty collection is empty", async () => {
    const sale = await getStorefrontCollection(rtStorefront, anon(tenantId), "theme-demo-sale");
    expect(sale?.products.items.map((p) => p.title).sort()).toEqual(["Block Print Dupatta", "Handloom Saree", "Weekender Jacket"]);
    const acc = await getStorefrontCollection(rtStorefront, anon(tenantId), "theme-demo-accessories");
    const titles = acc?.products.items.map((p) => p.title) ?? [];
    expect(titles).toContain("Trail Backpack");
    expect(titles.join("|")).not.toMatch(/draft|archived/);
    const empty = await getStorefrontCollection(rtStorefront, anon(tenantId), "theme-demo-empty-collection");
    expect(empty?.products.total).toBe(0);
  });

  it("is idempotent", async () => {
    const before = (await one<{ n: number }>(`select count(*)::int n from products where tenant_id = $1`, [tenantId]))[0]!.n;
    expect((await seedThemeDemoCatalog(rt)).alreadySeeded).toBe(true);
    expect((await one<{ n: number }>(`select count(*)::int n from products where tenant_id = $1`, [tenantId]))[0]!.n).toBe(before);
  });
});
