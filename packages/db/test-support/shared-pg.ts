/**
 * Optional fast path for local integration tests: instead of every *.int.test.ts file starting its
 * own Testcontainers Postgres and running every migration, point TEST_PG_ADMIN_URL at one long-lived
 * Postgres (see docker-compose.test-db.yml). A template database with roles + migrations applied is
 * built once (rebuilt automatically when the migrations change) and each test file gets its own
 * throwaway database cloned from it in well under a second.
 *
 * Unset TEST_PG_ADMIN_URL and nothing here does anything: tests fall back to TEST_DATABASE_URL_SUPERUSER
 * (CI) or Testcontainers, exactly as before.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { bootstrapRoles } from "../src/scripts/bootstrap-roles.ts";
import { runMigrations } from "../src/scripts/migrate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");

// Same passwords every int test file uses.
export const TEST_PW = { owner: "o_test", rw: "rw_test", platform: "p_test", saas: "s_test" };

// Keys for advisory locks on the shared server (template build, and clones from the template).
const TEMPLATE_BUILD_LOCK = 0x62_73_74_31;
const CLONE_LOCK = 0x62_73_74_32;

export function adminUrl(): string | undefined {
  return process.env.TEST_PG_ADMIN_URL || undefined;
}

export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Changes whenever a migration file is added or edited, so a stale template is never reused. */
export function templateName(): string {
  const h = createHash("sha256");
  for (const f of readdirSync(migrationsDir).sort()) {
    const p = path.join(migrationsDir, f);
    if (statSync(p).isDirectory()) {
      for (const g of readdirSync(p).sort()) h.update(`${f}/${g}:`).update(readFileSync(path.join(p, g)));
    } else {
      h.update(`${f}:`).update(readFileSync(p));
    }
  }
  // Roles and the migrate step shape the template too (default privileges, post-migration grants).
  for (const f of ["../src/sql/roles.ts", "../src/scripts/migrate.ts", "../src/scripts/bootstrap-roles.ts"]) {
    h.update(`${f}:`).update(readFileSync(path.resolve(here, f)));
  }
  return `bsec_tpl_${h.digest("hex").slice(0, 12)}`;
}

async function withAdmin<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: withDatabase(url, "postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** vitest globalSetup: make sure the template database for the current migrations exists. */
export async function ensureTemplate(): Promise<void> {
  const url = adminUrl();
  if (!url) return;
  const name = templateName();
  await withAdmin(url, async (c) => {
    await c.query("select pg_advisory_lock($1)", [TEMPLATE_BUILD_LOCK]);
    try {
      const { rowCount } = await c.query("select 1 from pg_database where datname = $1", [name]);
      if (rowCount) return;
      const building = `${name}_building`;
      await c.query(`drop database if exists "${building}" with (force)`);
      await c.query(`create database "${building}"`);
      const buildUrl = withDatabase(url, building);
      await bootstrapRoles(buildUrl, TEST_PW);
      const owner = new URL(buildUrl);
      owner.username = "app_owner";
      owner.password = TEST_PW.owner;
      await runMigrations(owner.toString());
      await c.query(`alter database "${building}" rename to "${name}"`);
    } finally {
      await c.query("select pg_advisory_unlock($1)", [TEMPLATE_BUILD_LOCK]);
    }
  });
}

/** vitest setupFile: give this test file its own database cloned from the template. */
export function useFreshDatabase(hooks: {
  beforeAll: (fn: () => Promise<void>, timeout?: number) => void;
  afterAll: (fn: () => Promise<void>, timeout?: number) => void;
}): void {
  const url = adminUrl();
  if (!url) return;
  const db = `bsec_t_${process.pid}_${randomBytes(4).toString("hex")}`;
  // Set at import time so a test file reading it at module scope still sees the right database.
  process.env.TEST_DATABASE_URL_SUPERUSER = withDatabase(url, db);

  hooks.beforeAll(async () => {
    await withAdmin(url, async (c) => {
      await c.query("select pg_advisory_lock($1)", [CLONE_LOCK]);
      try {
        await c.query(`create database "${db}" template "${templateName()}"`);
      } finally {
        await c.query("select pg_advisory_unlock($1)", [CLONE_LOCK]);
      }
    });
    await bootstrapRoles(withDatabase(url, db), TEST_PW);
  }, 120_000);

  hooks.afterAll(async () => {
    await withAdmin(url, async (c) => {
      await c.query(`alter database "${db}" with allow_connections false`).catch(() => undefined);
      await c.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
        [db],
      ).catch(() => undefined);
      await c.query(`drop database if exists "${db}" with (force)`).catch(() => undefined);
    }).catch(() => undefined);
  }, 60_000);
}
