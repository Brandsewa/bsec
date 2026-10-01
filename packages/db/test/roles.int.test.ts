/**
 * Integration: real PostgreSQL 18. Uses TEST_DATABASE_URL_SUPERUSER if set (CI service container),
 * otherwise starts postgres:18 via Testcontainers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { bootstrapRoles } from "../src/scripts/bootstrap-roles.ts";
import { runMigrations } from "../src/scripts/migrate.ts";
import { forceRlsSql, tenantTableNames } from "../src/tenant-table.ts";
import "../src/schema/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
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
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    // .withReuse() only activates with TESTCONTAINERS_REUSE_ENABLE=true (opt-in for local dev
    // to skip container startup between runs); it's a no-op otherwise, so CI is unaffected.
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await bootstrapRoles(superUrl, PW); // idempotent
  await runMigrations(as("app_owner", PW.owner));
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

describe("postgres roles", () => {
  it("runs on PostgreSQL 18", async () => {
    const r = await q<{ v: string }>(superUrl, "select current_setting('server_version_num') as v");
    expect(Number(r.rows[0]!.v)).toBeGreaterThanOrEqual(180000);
  });

  it("has the right attributes", async () => {
    const r = await q<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
      superUrl,
      "select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'app_%' order by rolname",
    );
    expect(r.rows.filter((x) => x.rolname !== "app_saas")).toEqual([
      { rolname: "app_owner", rolbypassrls: false, rolsuper: false },
      { rolname: "app_platform", rolbypassrls: true, rolsuper: false },
      { rolname: "app_rw", rolbypassrls: false, rolsuper: false },
    ]);
    // app_saas exists only when a password was supplied at bootstrap; it must never bypass RLS.
    const saas = r.rows.find((x) => x.rolname === "app_saas");
    if (saas) expect(saas).toEqual({ rolname: "app_saas", rolbypassrls: false, rolsuper: false });
  });

  it("migration created tables owned by app_owner", async () => {
    const r = await q<{ owner: string }>(superUrl, "select tableowner as owner from pg_tables where tablename = '_platform_meta'");
    expect(r.rows[0]?.owner).toBe("app_owner");
  });

  it("app_rw can do DML but no DDL", async () => {
    const rw = as("app_rw", PW.rw);
    await q(rw, "insert into _platform_meta(key, value) values ('k', 'v') on conflict (key) do update set value = excluded.value");
    expect((await q(rw, "select * from _platform_meta")).rowCount).toBe(1);
    await expect(q(rw, "create table nope(id int)")).rejects.toThrow(/permission denied/);
    await expect(q(rw, "drop table _platform_meta")).rejects.toThrow(/must be owner/);
  });

  it("app_rw can use pg-boss", async () => {
    const rw = as("app_rw", PW.rw);
    const r = await q<{ name: string }>(rw, "select name from pgboss.queue where name = 'system.ping'");
    expect(r.rowCount).toBe(1);
  });

  it("FORCE RLS + nullif policy: owner sees 0 rows, unset/empty setting is not an error, platform bypasses", async () => {
    const owner = as("app_owner", PW.owner);
    const t1 = "0199a000-0000-7000-8000-000000000001";
    const t2 = "0199a000-0000-7000-8000-000000000002";
    await q(owner, `
      create table if not exists rls_probe (tenant_id uuid not null, v text);
      ${forceRlsSql("rls_probe")}
      drop policy if exists tenant_isolation on rls_probe;
      create policy tenant_isolation on rls_probe
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
    `);
    // Superuser bypasses RLS; seed one row per tenant.
    await q(superUrl, "truncate rls_probe");
    await q(superUrl, "insert into rls_probe values ($1, 'a'), ($2, 'b')", [t1, t2]);

    // Owner without a tenant: 0 rows (FORCE RLS), no error.
    expect((await q(owner, "select * from rls_probe")).rowCount).toBe(0);

    // Pooled connection after SET LOCAL ends reads '' -> nullif -> 0 rows, not an error.
    const c = new pg.Client({ connectionString: as("app_rw", PW.rw) });
    await c.connect();
    await c.query("begin");
    await c.query("select set_config('app.tenant_id', $1, true)", [t1]);
    const inTx = await c.query("select v from rls_probe");
    await c.query("commit");
    const after = await c.query("select v from rls_probe");
    await expect(c.query("insert into rls_probe values ($1, 'x')", [t2])).rejects.toThrow(/row-level security/);
    await c.end();
    expect(inTx.rows).toEqual([{ v: "a" }]);
    expect(after.rowCount).toBe(0);

    // BYPASSRLS role reads everything (why it lives only in the platform container).
    expect((await q(as("app_platform", PW.platform), "select * from rls_probe")).rowCount).toBe(2);
  });

  it("enforces FORCE ROW LEVEL SECURITY on every registered tenant table", async () => {
    const tableList = Array.from(tenantTableNames);
    expect(tableList.length).toBeGreaterThan(0);
    const r = await q<{ relname: string; relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      superUrl,
      `select relname, relforcerowsecurity, relrowsecurity
       from pg_class
       where relname = any($1::text[])`,
      [tableList],
    );
    expect(r.rows.length).toBe(tableList.length);
    for (const row of r.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it("proves raw pooled connection without SET LOCAL returns 0 rows on real tables", async () => {
    const rw = as("app_rw", PW.rw);
    const c = new pg.Client({ connectionString: rw });
    await c.connect();
    try {
      const resMemberships = await c.query("select * from memberships");
      expect(resMemberships.rowCount).toBe(0);
      const resSettings = await c.query("select * from store_settings");
      expect(resSettings.rowCount).toBe(0);
      const resOverrides = await c.query("select * from tenant_feature_overrides");
      expect(resOverrides.rowCount).toBe(0);
    } finally {
      await c.end();
    }
  });
});
