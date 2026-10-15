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
  resolvePageRenderData,
  createCollection,
  updateCollection,
  seedDemoStore,
  removeDemoStore,
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
  // CI shares one database across files, and the demo store has a fixed slug: leave none behind for demo-store.int.test.ts.
  await removeDemoStore(rt);
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

  it("the archive grid lists every published collection with product counts, hides unpublished ones and never crosses stores", async () => {
    const grid = [{ id: "g", type: "CollectionGrid" as const, version: 1, props: { title: "All", collectionSlugs: [], showAll: true, columns: "3" } }];
    await one(`update collections set published = false where tenant_id = $1 and slug = 'theme-demo-men'`, [tenantId]);
    const out = await resolvePageRenderData(rtStorefront, anon(tenantId), grid as never);
    const d = out.data["g"];
    expect(d?.kind).toBe("collections");
    const cols = d?.kind === "collections" ? d.collections : [];
    const slugs = cols.map((c) => c.slug);
    expect(slugs).toContain("theme-demo-sale");
    expect(slugs).not.toContain("theme-demo-men"); // unpublished
    expect(cols.find((c) => c.slug === "theme-demo-sale")?.productCount).toBe(3);
    expect(cols.find((c) => c.slug === "theme-demo-empty-collection")?.productCount).toBe(0);
    // the control store has none of these collections: row level security keeps the lists apart
    const other = await resolvePageRenderData(rtStorefront, anon(controlTenant), grid as never);
    const od = other.data["g"];
    expect(od?.kind === "collections" ? od.collections.length : -1).toBe(0);
    await one(`update collections set published = true where tenant_id = $1 and slug = 'theme-demo-men'`, [tenantId]);
  });

  it("collection descriptions: saved as plain text, limited to 300 characters, shown on archive cards, and empty clears it", async () => {
    const ctx: TenantContext = { tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["store_owner"], permissions: ["products.write", "products.read"], requestId: "req_desc" };
    const made = await createCollection(rt, ctx, { title: "Described", slug: "theme-demo-described", description: "  Hand-made and small batch.  " });
    expect(made.description).toBe("Hand-made and small batch.");

    await expect(createCollection(rt, ctx, { title: "Bad", slug: "theme-demo-bad-html", description: "<b>hi</b>" })).rejects.toThrow(/plain text/);
    await expect(updateCollection(rt, ctx, { id: made.id, description: "x".repeat(301) })).rejects.toThrow(/300/);

    const grid = [{ id: "g", type: "CollectionGrid" as const, version: 1, props: { title: "All", collectionSlugs: [], showAll: true, columns: "3" } }];
    const seen = async () => {
      const d = (await resolvePageRenderData(rtStorefront, anon(tenantId), grid as never)).data["g"];
      return d?.kind === "collections" ? d.collections.find((c) => c.slug === "theme-demo-described") : undefined;
    };
    expect((await seen())?.description).toBe("Hand-made and small batch.");
    await updateCollection(rt, ctx, { id: made.id, description: "   " });
    expect((await seen())?.description).toBeUndefined();
  });

  it("listing cards carry what quick add needs: a direct variant for simple products, options and variants for the rest, and stock", async () => {
    const find = async (slug: string, title: string) => (await getStorefrontCollection(rtStorefront, anon(tenantId), slug))?.products.items.find((p) => p.title === title);

    const saree = await find("theme-demo-sale", "Handloom Saree");
    expect(saree?.quickAdd?.singleVariantId).toBeTruthy(); // one variant, nothing to choose
    expect(saree?.quickAdd?.variants).toBeUndefined();
    expect(saree?.categoryName).toBe("Women");

    const jacket = await find("theme-demo-sale", "Weekender Jacket");
    expect(jacket?.quickAdd?.singleVariantId).toBeUndefined();
    expect(jacket?.quickAdd?.options?.map((o) => o.name)).toEqual(["Size", "Color"]);
    expect(jacket?.quickAdd?.variants).toHaveLength(12);
    expect(jacket?.quickAdd?.variants?.every((v) => v.inStock && v.compareAtPrice === 399900)).toBe(true);

    const basket = await find("theme-demo-accessories", "Jute Storage Basket"); // no stock at all
    expect(basket?.quickAdd?.inStock).toBe(false);
    expect(basket?.quickAdd?.singleVariantId).toBeUndefined(); // an unavailable product must not be addable directly

    const hoodie = (await getStorefrontCollection(rtStorefront, anon(tenantId), "theme-demo-new-arrivals"))?.products.items.find((p) => p.title === "Everyday Hoodie");
    expect(hoodie?.quickAdd?.variants?.find((v) => v.title === "S/Black")?.inStock).toBe(false); // one sold-out variant among in-stock ones
    expect(hoodie?.quickAdd?.inStock).toBe(true);
  });

  it("is idempotent", async () => {
    const before = (await one<{ n: number }>(`select count(*)::int n from products where tenant_id = $1`, [tenantId]))[0]!.n;
    expect((await seedThemeDemoCatalog(rt)).alreadySeeded).toBe(true);
    expect((await one<{ n: number }>(`select count(*)::int n from products where tenant_id = $1`, [tenantId]))[0]!.n).toBe(before);
  });
});
