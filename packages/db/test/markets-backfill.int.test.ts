/**
 * Integration: migration 0087 (markets foundation) on a database that already holds old-shape stores.
 * Builds a database at migration 0086, seeds stores the way production has them, then applies 0087 and checks the
 * backfill (ADR-040, docs/MULTIMARKET-PLAN.md Phase 1: "all existing stores behave identically").
 */
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapRoles } from "../src/scripts/bootstrap-roles.ts";
import { runMigrations } from "../src/scripts/migrate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PW = { owner: "o_test", rw: "rw_test", platform: "p_test", saas: "s_test" };

let container: StartedPostgreSqlContainer | undefined;
let serverUrl: string;
let dbName: string;
let tmp: string;

const T_IN = "00000000-0000-7000-8000-0000000000a1";
const T_US = "00000000-0000-7000-8000-0000000000a2";
const T_BARE = "00000000-0000-7000-8000-0000000000a3";

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
const superUrl = () => withDb(serverUrl, dbName);
function as(role: "app_owner" | "app_rw" | "app_platform"): string {
  const u = new URL(superUrl());
  u.username = role;
  u.password = role === "app_owner" ? PW.owner : role === "app_rw" ? PW.rw : PW.platform;
  return u.toString();
}
async function q<T extends pg.QueryResultRow>(url: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query<T>(text, params);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  const admin = process.env.TEST_PG_ADMIN_URL || process.env.TEST_DATABASE_URL_SUPERUSER;
  if (admin) {
    serverUrl = admin;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    serverUrl = container.getConnectionUri();
  }
  dbName = `mm_backfill_${randomBytes(4).toString("hex")}`;
  await q(serverUrl, `CREATE DATABASE ${dbName}`);
  await bootstrapRoles(superUrl(), PW);

  // A migrations folder that stops before 0087 (and so before 0088).
  tmp = mkdtempSync(path.join(os.tmpdir(), "mm-mig-"));
  const src = path.resolve(here, "../migrations");
  cpSync(src, tmp, { recursive: true });
  rmSync(path.join(tmp, "0087_markets_foundation.sql"));
  rmSync(path.join(tmp, "0088_markets_config.sql"));
  rmSync(path.join(tmp, "0089_market_scope_functions.sql"));
  const journalPath = path.join(tmp, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => !e.tag.startsWith("0087_") && !e.tag.startsWith("0088_") && !e.tag.startsWith("0089_"));
  writeFileSync(journalPath, JSON.stringify(journal));
  await runMigrations(as("app_owner"), tmp);

  // Old-shape stores, seeded as the superuser (bypasses RLS).
  await q(
    superUrl(),
    `INSERT INTO tenants (id, slug, name, country, currency) VALUES
       ('${T_IN}', 'mm-in', 'In Store', 'IN', 'INR'),
       ('${T_US}', 'mm-us', 'Us Store', 'US', 'USD'),
       ('${T_BARE}', 'mm-bare', 'Bare Store', 'IN', 'INR')`,
  );
  await q(
    superUrl(),
    `INSERT INTO store_settings (tenant_id, store_name, currency, weight_unit) VALUES
       ('${T_IN}', 'In Store', 'INR', 'kg'),
       ('${T_US}', 'Us Store', 'USD', 'lb')`,
  );
  await q(
    superUrl(),
    `INSERT INTO shipping_zones (tenant_id, name, countries) VALUES
       ('${T_IN}', 'India', ARRAY['IN']),
       ('${T_US}', 'US', ARRAY['US']),
       ('${T_BARE}', 'Everywhere', ARRAY['IN','ae','AE'])`,
  );
  await q(superUrl(), `INSERT INTO carts (tenant_id, token, currency) VALUES ('${T_IN}', 'tok-1', 'INR')`);
  await q(
    superUrl(),
    `INSERT INTO orders (tenant_id, number, email, phone, currency, status, payment_status, subtotal, grand_total, shipping_total, shipping_address)
     VALUES ('${T_IN}', '#1001', 'a@example.com', '9999999999', 'INR', 'pending', 'pending', 100000, 110000, 10000, '{}'::jsonb)`,
  );

  await runMigrations(as("app_owner")); // applies 0087
}, 240_000);

afterAll(async () => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (dbName) await q(serverUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
  await container?.stop();
});

describe("migration 0087 backfill", () => {
  it("gives every existing store exactly one base market from its country and currency", async () => {
    const r = await q<{ tenant_id: string; handle: string; currency: string; is_base: boolean; tax_display: string; status: string }>(
      superUrl(),
      `SELECT tenant_id, handle, currency, is_base, tax_display, status FROM markets ORDER BY handle, tenant_id`,
    );
    const byTenant = new Map(r.rows.map((m) => [m.tenant_id, m]));
    expect(r.rows).toHaveLength(3);
    expect(byTenant.get(T_IN)).toMatchObject({ handle: "in", currency: "INR", is_base: true, tax_display: "inclusive", status: "active" });
    expect(byTenant.get(T_US)).toMatchObject({ handle: "us", currency: "USD", is_base: true, tax_display: "exclusive" });
    expect(byTenant.get(T_BARE)).toMatchObject({ currency: "INR", is_base: true });
  });

  it("covers the countries the shipping zones already served, without duplicates", async () => {
    const r = await q<{ tenant_id: string; country: string }>(superUrl(), `SELECT tenant_id, country FROM market_countries ORDER BY tenant_id, country`);
    const countries = (id: string) => r.rows.filter((x) => x.tenant_id === id).map((x) => x.country);
    expect(countries(T_IN)).toEqual(["IN"]);
    expect(countries(T_US)).toEqual(["US"]);
    expect(countries(T_BARE)).toEqual(["AE", "IN"]);
  });

  it("points carts and orders at the base market and snapshots base-currency totals", async () => {
    const o = await q<{ market_id: string; base_currency: string; base_grand_total: string; fx_rate: string | null }>(
      superUrl(),
      `SELECT market_id, base_currency, base_grand_total, fx_rate FROM orders WHERE tenant_id = '${T_IN}'`,
    );
    const m = await q<{ id: string }>(superUrl(), `SELECT id FROM markets WHERE tenant_id = '${T_IN}'`);
    expect(o.rows[0]!.market_id).toBe(m.rows[0]!.id);
    expect(o.rows[0]!.base_currency).toBe("INR");
    expect(Number(o.rows[0]!.base_grand_total)).toBe(110000);
    expect(o.rows[0]!.fx_rate).toBeNull();
    const c = await q<{ market_id: string }>(superUrl(), `SELECT market_id FROM carts WHERE tenant_id = '${T_IN}'`);
    expect(c.rows[0]!.market_id).toBe(m.rows[0]!.id);
  });

  it("maps the old weight unit to a unit system", async () => {
    const r = await q<{ tenant_id: string; unit_system: string }>(superUrl(), `SELECT tenant_id, unit_system FROM store_settings`);
    const by = new Map(r.rows.map((x) => [x.tenant_id, x.unit_system]));
    expect(by.get(T_IN)).toBe("metric");
    expect(by.get(T_US)).toBe("imperial");
  });

  it("seeds IN, US and CA as selectable countries, readable but not writable by app_rw", async () => {
    const r = await q<{ iso2: string; enabled: boolean }>(as("app_rw"), `SELECT iso2, enabled FROM platform_countries ORDER BY sort`);
    expect(r.rows.map((x) => x.iso2)).toEqual(["IN", "US", "CA"]);
    expect(r.rows.every((x) => x.enabled)).toBe(true);
    await expect(q(as("app_rw"), `UPDATE platform_countries SET enabled = false WHERE iso2 = 'US'`)).rejects.toThrow(/permission denied/);
    await expect(q(as("app_platform"), `UPDATE platform_countries SET enabled = true WHERE iso2 = 'US'`)).resolves.toBeDefined();
  });

  it("enforces tenant isolation, one base market per store and one market per country", async () => {
    const none = await q(as("app_rw"), `SELECT 1 FROM markets`);
    expect(none.rows).toHaveLength(0); // no tenant set: forced RLS hides every row
    await expect(
      q(superUrl(), `INSERT INTO markets (tenant_id, name, handle, is_base) VALUES ('${T_IN}', 'Second base', 'second', true)`),
    ).rejects.toThrow(/markets_tenant_base_uniq/);
    const m = await q<{ id: string }>(superUrl(), `SELECT id FROM markets WHERE tenant_id = '${T_IN}'`);
    const other = await q<{ id: string }>(
      superUrl(),
      `INSERT INTO markets (tenant_id, name, handle, currency, path_prefix) VALUES ('${T_IN}', 'USA', 'us', 'USD', '/us') RETURNING id`,
    );
    await expect(
      q(superUrl(), `INSERT INTO market_countries (tenant_id, market_id, country) VALUES ('${T_IN}', '${other.rows[0]!.id}', 'IN')`),
    ).rejects.toThrow(/market_countries_tenant_country_uniq/);
    // A market cannot be referenced across tenants (composite foreign key).
    await expect(
      q(superUrl(), `INSERT INTO market_countries (tenant_id, market_id, country) VALUES ('${T_US}', '${m.rows[0]!.id}', 'CA')`),
    ).rejects.toThrow(/market_countries_market_fk/);
  });
});
