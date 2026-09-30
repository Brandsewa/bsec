import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { bootstrapRoles } from "../src/scripts/bootstrap-roles.ts";
import { runMigrations } from "../src/scripts/migrate.ts";
import "../src/schema/index.ts";
import { APP_SAAS_WRITABLE_TABLES } from "../src/sql/saas-grants.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test", saas: "s_test" };
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
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

describe("B2: app_rw privileges on platform vs tenant tables", () => {
  it("rejects forbidden writes on platform-owned tables by app_rw", async () => {
    const rw = as("app_rw", PW.rw);

    // 1. Updating a plan price must be rejected
    await expect(
      q(rw, "UPDATE plans SET price_monthly_paise = 1 WHERE code = 'starter'")
    ).rejects.toThrow(/permission denied/i);

    // 2. Deleting a reserved slug must be rejected
    await expect(
      q(rw, "DELETE FROM reserved_slugs WHERE slug = 'admin'")
    ).rejects.toThrow(/permission denied/i);

    // 3. Changing a tenant size tier must be rejected
    await expect(
      q(rw, "UPDATE tenant_size_tiers SET tier = 'L'")
    ).rejects.toThrow(/permission denied/i);

    // 4. Updating or deleting an audit row in platform_audit_logs must be rejected
    await expect(
      q(rw, "UPDATE platform_audit_logs SET action = 'tampered'")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      q(rw, "DELETE FROM platform_audit_logs")
    ).rejects.toThrow(/permission denied/i);

    // 5. Updating or inserting on quota config tables must be rejected
    await expect(
      q(rw, "UPDATE quota_definitions SET tier_xs = 9999 WHERE key = 'products'")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      q(rw, "INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES ('0199a000-0000-7000-8000-000000000001', 'products', 9999)")
    ).rejects.toThrow(/permission denied/i);

    // 6. Writes on subscriptions, platform_invoices, quota_events, tenant_owner_invites, signup_leads, slug_reservations must be rejected
    await expect(
      q(rw, "INSERT INTO subscriptions (tenant_id) VALUES ('0199a000-0000-7000-8000-000000000001')")
    ).rejects.toThrow(/permission denied/i);

    await expect(
      q(rw, "INSERT INTO platform_invoices (tenant_id, number, amount_paise, tax_paise) VALUES ('0199a000-0000-7000-8000-000000000001', 'INV-1', 100, 18)")
    ).rejects.toThrow(/permission denied/i);

    await expect(
      q(rw, "INSERT INTO quota_events (tenant_id, quota_key, level, value, limit_value) VALUES ('0199a000-0000-7000-8000-000000000001', 'products', 'pct_80', 80, 100)")
    ).rejects.toThrow(/permission denied/i);

    await expect(
      q(rw, "INSERT INTO tenant_owner_invites (tenant_id, email, token_hash, expires_at) VALUES ('0199a000-0000-7000-8000-000000000001', 'hacker@evil.com', 'h1', now() + interval '1 day')")
    ).rejects.toThrow(/permission denied/i);

    await expect(
      q(rw, "INSERT INTO signup_leads (email) VALUES ('lead@test.com')")
    ).rejects.toThrow(/permission denied/i);

    await expect(
      q(rw, "INSERT INTO slug_reservations (slug, expires_at) VALUES ('badslug', now() + interval '1 hour')")
    ).rejects.toThrow(/permission denied/i);
  });

  it("permits legitimate reads on platform tables and append-only on platform_audit_logs", async () => {
    const rw = as("app_rw", PW.rw);

    // Reading plans is allowed
    const plansRes = await q(rw, "SELECT count(*) FROM plans");
    expect(Number(plansRes.rows[0]?.count)).toBeGreaterThan(0);

    // Reading reserved_slugs is allowed
    const slugRes = await q(rw, "SELECT count(*) FROM reserved_slugs");
    expect(Number(slugRes.rows[0]?.count)).toBeGreaterThan(0);

    // platform_audit_logs allows INSERT (append-only)
    await q(
      rw,
      "INSERT INTO platform_audit_logs (action, target_type, target_id) VALUES ('test_action', 'tenant', '0199a000-0000-7000-8000-000000000001')"
    );
  });
});

// Every table the tenant runtime role (app_rw) can write must be either tenant-scoped (RLS enabled)
// or consciously listed here. New tables get full DML for app_rw by default (ALTER DEFAULT PRIVILEGES),
// so a new platform-owned table fails this test until it is revoked in a migration or added here on purpose.
const NON_RLS_TABLES_WRITABLE_BY_APP_RW: string[] = [
  "_platform_meta",
  "accounts",
  "domains",
  "platform_audit_logs", // INSERT + SELECT only (append-only), asserted in the test above
  "rate_limit_counters",
  "sessions",
  "tenant_active_jobs",
  "two_factors",
  "users",
  "verifications",
  "webhook_inbox",
];

describe("B2: app_rw write surface stays intentional", () => {
  it("only tenant-scoped (RLS) tables and the listed runtime tables are writable by app_rw", async () => {
    const { rows } = await q<{ table_name: string }>(
      as("app_owner", PW.owner),
      `select c.relname as table_name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
          and (has_table_privilege('app_rw', c.oid, 'INSERT')
            or has_table_privilege('app_rw', c.oid, 'UPDATE')
            or has_table_privilege('app_rw', c.oid, 'DELETE'))
        order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...NON_RLS_TABLES_WRITABLE_BY_APP_RW].sort());
  });
});

describe("B2: app_saas write surface stays intentional", () => {
  it("app_saas can write exactly the tables app_rw can, plus the listed self-service platform tables", async () => {
    const { rows } = await q<{ table_name: string }>(
      as("app_owner", PW.owner),
      `select c.relname as table_name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (has_table_privilege('app_saas', c.oid, 'INSERT')
            or has_table_privilege('app_saas', c.oid, 'UPDATE')
            or has_table_privilege('app_saas', c.oid, 'DELETE'))
          and not (has_table_privilege('app_rw', c.oid, 'INSERT')
            or has_table_privilege('app_rw', c.oid, 'UPDATE')
            or has_table_privilege('app_rw', c.oid, 'DELETE'))
        order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...APP_SAAS_WRITABLE_TABLES].sort());
  });
});
