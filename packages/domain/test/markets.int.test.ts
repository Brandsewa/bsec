/**
 * Integration: markets admin service on a real Postgres (ADR-040). Pricing materialisation, countries, readiness gates,
 * plan limit, permissions and tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Client as PgClient } from "pg";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  acknowledgeMarketCompliance,
  createMarket,
  createRuntime,
  deleteMarket,
  getMarketDetail,
  listMarketPricing,
  listMarkets,
  setFixedMarketPrices,
  setMarketCountries,
  setMarketPaymentMethods,
  setMarketPolicy,
  setMarketStatus,
  setMarketTaxRules,
  syncVariantMarketPrices,
  updateMarket,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { withTenant } from "@bs/db";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rt: Runtime;
let pg: PgClient;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const A = "0199b0b3-0000-7000-8000-0000000000a1";
const B = "0199b0b3-0000-7000-8000-0000000000b1";
const PRODUCT = "0199b0b3-0000-7000-8000-0000000000a2";
const V1 = "0199b0b3-0000-7000-8000-0000000000a3";
const V2 = "0199b0b3-0000-7000-8000-0000000000a4";
const ctxOf = (tenantId: string, permissions: string[] = ["markets.manage"]): TenantContext =>
  ({ tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["store_owner"], permissions, requestId: "req_markets" }) as TenantContext;
const owner = ctxOf(A);

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query(sql, params)).rows as T[];
}

let baseMarketId = "";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rt = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });
  pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO tenants (id, slug, name, country, currency) VALUES ('${A}', 'mk-a', 'Markets A', 'IN', 'INR') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, slug, name, country, currency) VALUES ('${B}', 'mk-b', 'Markets B', 'IN', 'INR') ON CONFLICT DO NOTHING;
    INSERT INTO markets (tenant_id, name, handle, is_base, currency, tax_display) VALUES ('${A}', 'India', 'in', true, 'INR', 'inclusive');
    INSERT INTO markets (tenant_id, name, handle, is_base, currency, tax_display) VALUES ('${B}', 'India', 'in', true, 'INR', 'inclusive');
    INSERT INTO market_countries (tenant_id, market_id, country) SELECT tenant_id, id, 'IN' FROM markets WHERE tenant_id IN ('${A}', '${B}');
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${PRODUCT}', '${A}', 'Desk Lamp', 'desk-lamp', 'published');
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price, compare_at_price) VALUES ('${V1}', '${A}', '${PRODUCT}', 'LAMP-1', 'Small', 100000, 120000);
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${V2}', '${A}', '${PRODUCT}', 'LAMP-2', 'Large', 250000);
    INSERT INTO payment_methods (tenant_id, provider, display_name, status) VALUES ('${A}', 'stripe', 'Stripe', 'active'), ('${A}', 'cod', 'Cash on delivery', 'active'), ('${A}', 'paypal', 'PayPal', 'active');
    INSERT INTO shipping_zones (tenant_id, name, countries) VALUES ('${A}', 'Domestic', ARRAY['IN']);
  `);
  baseMarketId = (await q<{ id: string }>(`select id from markets where tenant_id = $1`, [A]))[0]!.id;
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rt?.close();
  await container?.stop();
});

let usId = "";

describe("creating markets", () => {
  it("refuses callers without the markets.manage permission", async () => {
    await expect(listMarkets(rt, ctxOf(A, ["products.read"]))).rejects.toThrow(/Forbidden/);
  });

  it("creates a draft USD market with derived prices from the merchant's rate", async () => {
    const m = await createMarket(rt, owner, { name: "United States", currency: "usd", countries: ["us"], fxRate: 0.012, rounding: "none" });
    usId = m.id;
    expect(m).toMatchObject({ isBase: false, status: "draft", currency: "USD", countries: ["US"], pathPrefix: "/us", fxRate: 0.012 });
    const rows = await q<{ variant_id: string; price: string; compare_at_price: string | null; source: string }>(
      `select variant_id, price, compare_at_price, source from market_prices where market_id = $1 order by price`,
      [usId],
    );
    expect(rows.map((r) => [r.variant_id, Number(r.price), r.compare_at_price === null ? null : Number(r.compare_at_price), r.source])).toEqual([
      [V1, 1200, 1440, "derived"],
      [V2, 3000, null, "derived"],
    ]);
    expect((await q(`select 1 from market_fx_history where market_id = $1`, [usId])).length).toBe(1);
  });

  it("allows only the plan's number of extra markets, and the base market does not count", async () => {
    await expect(createMarket(rt, owner, { name: "Canada", currency: "CAD", countries: ["CA"], fxRate: 0.016 })).rejects.toThrow(/plan allows 1 extra market/);
  });

  it("keeps a country in only one market", async () => {
    await expect(setMarketCountries(rt, owner, usId, ["US", "IN"])).rejects.toThrow(/IN is already in the market "India"/);
    await expect(setMarketCountries(rt, owner, usId, ["XX"])).rejects.toThrow(/not available yet/);
    const m = await setMarketCountries(rt, owner, usId, ["US"]);
    expect(m.countries).toEqual(["US"]);
  });

  it("rejects an unsupported currency and a bad URL prefix", async () => {
    await expect(createMarket(rt, owner, { name: "Japan", currency: "JPY", countries: ["US"], fxRate: 1 })).rejects.toThrow(/not supported/);
    await expect(updateMarket(rt, owner, usId, { pathPrefix: "/cart" })).rejects.toThrow(/cannot clash/);
  });
});

describe("pricing", () => {
  it("rebuilds derived prices when the rate, adjustment or rounding changes, and records the rate", async () => {
    await updateMarket(rt, owner, usId, { fxRate: 0.013, priceAdjustBps: 1000, rounding: "charm_99" });
    const rows = await q<{ price: string }>(`select price from market_prices where market_id = $1 order by price`, [usId]);
    // 1000 INR x 0.013 x 1.10 = 14.30 -> 14.99 ; 2500 x 0.013 x 1.1 = 35.75 -> 35.99
    expect(rows.map((r) => Number(r.price))).toEqual([1499, 3599]);
    expect((await q(`select 1 from market_fx_history where market_id = $1`, [usId])).length).toBe(2);
  });

  it("keeps fixed prices through a rebuild and returns to derived when cleared", async () => {
    await setFixedMarketPrices(rt, owner, { marketId: usId, items: [{ variantId: V1, price: 1999, compareAtPrice: 2499 }] });
    await updateMarket(rt, owner, usId, { fxRate: 0.014 });
    const fixed = await q<{ price: string; source: string }>(`select price, source from market_prices where market_id = $1 and variant_id = $2`, [usId, V1]);
    expect(fixed[0]).toMatchObject({ price: "1999", source: "fixed" });
    await setFixedMarketPrices(rt, owner, { marketId: usId, items: [{ variantId: V1, price: null }] });
    const back = await q<{ source: string }>(`select source from market_prices where market_id = $1 and variant_id = $2`, [usId, V1]);
    expect(back[0]!.source).toBe("derived");
  });

  it("derives a price for a variant added later through the sync used by every write path", async () => {
    const V3 = "0199b0b3-0000-7000-8000-0000000000a5";
    await pg.query(`INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${V3}', '${A}', '${PRODUCT}', 'LAMP-3', 'XL', 50000)`);
    await withTenant(rt._db.db, A, (tx) => syncVariantMarketPrices(tx, A, [V3]));
    const r = await q<{ price: string }>(`select price from market_prices where market_id = $1 and variant_id = $2`, [usId, V3]);
    expect(Number(r[0]!.price)).toBeGreaterThan(0);
    const list = await listMarketPricing(rt, owner, { marketId: usId, search: "lamp" });
    expect(list.total).toBe(3);
    expect(list.rows.every((x) => x.source !== "missing")).toBe(true);
  });

  it("does not let the base market take overrides", async () => {
    await expect(setFixedMarketPrices(rt, owner, { marketId: baseMarketId, items: [{ variantId: V1, price: 5 }] })).rejects.toThrow(/base market/);
    await expect(updateMarket(rt, owner, baseMarketId, { currency: "USD" })).rejects.toThrow(/base market keeps/);
  });
});

describe("going live", () => {
  it("cannot activate until the market is ready", async () => {
    const detail = await getMarketDetail(rt, owner, usId);
    expect(detail.readiness.ready).toBe(false);
    expect(detail.readiness.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(["gateway", "shipping", "policy", "tax_acknowledgement"]);
    await expect(setMarketStatus(rt, owner, usId, "active")).rejects.toThrow(/not ready/);
  });

  it("checks a gateway can charge in the market currency", async () => {
    await expect(setMarketPaymentMethods(rt, owner, usId, [{ provider: "cod", enabled: true }])).rejects.toThrow(/only offered for INR orders in India/);
    await expect(setMarketPaymentMethods(rt, owner, usId, [{ provider: "razorpay", enabled: true }])).rejects.toThrow(/Connect razorpay/);
    const m = await setMarketPaymentMethods(rt, owner, usId, [{ provider: "paypal", enabled: true }, { provider: "stripe", enabled: true }]);
    expect(m.paymentMethods.map((p) => p.provider)).toEqual(["paypal", "stripe"]);
    expect(m.paymentMethods.find((p) => p.provider === "stripe")?.warning).toMatch(/invite-only/);
  });

  it("goes live once rates, shipping, policy and the acknowledgement are in place", async () => {
    const [zone] = await q<{ id: string }>(`insert into shipping_zones (tenant_id, name, countries, market_id) values ($1, 'US', ARRAY['US'], $2) returning id`, [A, usId]);
    await pg.query(`insert into shipping_rates (tenant_id, zone_id, name, price_paise) values ($1, $2, 'Standard', 999)`, [A, zone!.id]);
    await setMarketPolicy(rt, owner, usId, { returnSettings: null, cancellation: null, policyText: "30 day returns, buyer pays return shipping." });
    await setMarketTaxRules(rt, owner, usId, [{ country: "US", region: "ca", taxName: "Sales tax", rateBps: 725 }]);
    await expect(setMarketTaxRules(rt, owner, usId, [{ country: "CA", region: "", taxName: "GST", rateBps: 500 }])).rejects.toThrow(/not one of this market's countries/);
    await acknowledgeMarketCompliance(rt, owner, usId);
    const live = await setMarketStatus(rt, owner, usId, "active");
    expect(live.status).toBe("active");
    expect(live.taxRules).toMatchObject([{ country: "US", region: "CA", rateBps: 725 }]);
    const audit = await q<{ action: string }>(`select action from audit_logs where tenant_id = $1 and target_type = 'market' order by created_at`, [A]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["markets.create", "markets.activate", "markets.compliance_ack", "markets.tax_rules_update"]));
  });

  it("refuses to disable the base market or delete one that has orders", async () => {
    await expect(setMarketStatus(rt, owner, baseMarketId, "disabled")).rejects.toThrow(/base market cannot be disabled/);
    await expect(deleteMarket(rt, owner, baseMarketId)).rejects.toThrow(/base market cannot be deleted/);
    await pg.query(
      `insert into orders (tenant_id, number, email, phone, currency, status, payment_status, subtotal, grand_total, shipping_address, market_id)
       values ($1, '#M1', 'a@b.co', '1', 'USD', 'pending', 'pending', 1, 1, '{}'::jsonb, $2)`,
      [A, usId],
    );
    await expect(deleteMarket(rt, owner, usId)).rejects.toThrow(/has orders/);
  });
});

describe("tenant isolation", () => {
  it("never shows or changes another store's market", async () => {
    const other = ctxOf(B);
    await expect(getMarketDetail(rt, other, usId)).rejects.toThrow(/Not Found/);
    await expect(updateMarket(rt, other, usId, { name: "hijack" })).rejects.toThrow(/Not Found/);
    const mine = await listMarkets(rt, other);
    expect(mine.markets.map((m) => m.id)).not.toContain(usId);
    expect(mine.markets).toHaveLength(1);
  });
});
