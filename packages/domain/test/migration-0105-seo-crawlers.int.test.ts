/**
 * Migration 0105 (docs/SEO-GEO-AEO-PLAN.md section 3.1): a seo_settings row that still holds exactly the old AI-crawler
 * default is reset to NULL so existing stores follow the new code default; edited rows are left alone.
 * Runs against real Postgres because seo_settings is FORCE ROW LEVEL SECURITY: an UPDATE that forgets to scope each tenant
 * silently changes zero rows, which a mock would never show.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import pg from "pg";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
const orgId = "0199a105-0000-7000-8000-000000000000";
const tenantOld = "0199a105-0000-7000-8000-000000000001";
const tenantEdited = "0199a105-0000-7000-8000-000000000002";
const tenantNull = "0199a105-0000-7000-8000-000000000003";
const OLD_DEFAULT = { GPTBot: "block", ClaudeBot: "block", PerplexityBot: "block", "Google-Extended": "block", CCBot: "block" };
const EDITED = { ...OLD_DEFAULT, ClaudeBot: "allow" };

let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;

function as(role: "app_owner", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

async function crawlersOf(client: pg.Client, tenantId: string): Promise<unknown> {
  const res = await client.query("SELECT ai_crawlers FROM seo_settings WHERE tenant_id = $1", [tenantId]);
  return res.rows[0]?.ai_crawlers;
}

describe("migration 0105: reset untouched old AI crawler defaults", () => {
  let superClient: pg.Client;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL_SUPERUSER) {
      superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
    } else {
      container = await new PostgreSqlContainer("postgres:18").withReuse().start();
      superUrl = container.getConnectionUri();
    }
    await bootstrapRoles(superUrl, PW);
    await runMigrations(as("app_owner", PW.owner));

    superClient = new pg.Client({ connectionString: superUrl });
    await superClient.connect();
    await superClient.query("SET session_replication_role = 'replica'");
    await superClient.query("DELETE FROM seo_settings WHERE tenant_id = ANY($1)", [[tenantOld, tenantEdited, tenantNull]]);
    await superClient.query("DELETE FROM tenants WHERE id = ANY($1)", [[tenantOld, tenantEdited, tenantNull]]);
    await superClient.query("DELETE FROM organizations WHERE id = $1", [orgId]);
    await superClient.query("SET session_replication_role = 'origin'");

    await superClient.query("INSERT INTO organizations (id, name) VALUES ($1, 'Migration 0105 Org')", [orgId]);
    for (const [id, slug] of [
      [tenantOld, "m0105-old"],
      [tenantEdited, "m0105-edited"],
      [tenantNull, "m0105-null"],
    ] as const) {
      await superClient.query("INSERT INTO tenants (id, slug, name, organization_id, status) VALUES ($1, $2, $3, $4, 'active')", [id, slug, slug, orgId]);
    }
    await superClient.query("INSERT INTO seo_settings (tenant_id, ai_crawlers) VALUES ($1, $2::jsonb)", [tenantOld, JSON.stringify(OLD_DEFAULT)]);
    await superClient.query("INSERT INTO seo_settings (tenant_id, ai_crawlers) VALUES ($1, $2::jsonb)", [tenantEdited, JSON.stringify(EDITED)]);
    await superClient.query("INSERT INTO seo_settings (tenant_id, ai_crawlers) VALUES ($1, NULL)", [tenantNull]);
  }, 180_000);

  afterAll(async () => {
    await superClient?.end();
    await container?.stop();
  });

  it("resets only the row that still equals the old default, run as app_owner under FORCE RLS", async () => {
    const sql = readFileSync(new URL("../../db/migrations/0105_seo_reset_old_ai_crawler_defaults.sql", import.meta.url), "utf8");
    const owner = new pg.Client({ connectionString: as("app_owner", PW.owner) });
    await owner.connect();
    try {
      await owner.query(sql);
    } finally {
      await owner.end();
    }

    expect(await crawlersOf(superClient, tenantOld)).toBeNull();
    expect(await crawlersOf(superClient, tenantEdited)).toEqual(EDITED);
    expect(await crawlersOf(superClient, tenantNull)).toBeNull();
  });

  it("is safe to run again", async () => {
    const sql = readFileSync(new URL("../../db/migrations/0105_seo_reset_old_ai_crawler_defaults.sql", import.meta.url), "utf8");
    const owner = new pg.Client({ connectionString: as("app_owner", PW.owner) });
    await owner.connect();
    try {
      await owner.query(sql);
    } finally {
      await owner.end();
    }
    expect(await crawlersOf(superClient, tenantEdited)).toEqual(EDITED);
  });
});
