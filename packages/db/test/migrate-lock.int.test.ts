/**
 * Integration: real PostgreSQL 18. A migration blocked by a table lock must give up quickly, because while it waits every
 * later query on that table waits behind it (outage of 2026-11-02, docs/migrations.md).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runMigrations } from "../src/scripts/migrate.ts";
import { startTestDb, type TestDb } from "../test-support/test-env.ts";

const TABLE = `lock_probe_${Math.random().toString(36).slice(2, 9)}`;
const WHEN = Date.now() + 3_650 * 86_400_000;
const LIMITS = { lockTimeoutMs: 200, attempts: 3, retryDelayMs: 100 };

let env: TestDb;
let admin: pg.Client;
let folder: string;

/** A session holding a read lock inside an open transaction, as a stuck request would. */
async function holdLock(): Promise<pg.Client> {
  const holder = new pg.Client({ connectionString: env.superUrl });
  await holder.connect();
  await holder.query("BEGIN");
  await holder.query(`SELECT * FROM ${TABLE}`);
  return holder;
}

beforeAll(async () => {
  env = await startTestDb();
  admin = new pg.Client({ connectionString: env.superUrl });
  await admin.connect();
  await admin.query(`CREATE TABLE ${TABLE} (id int)`);
  await admin.query(`ALTER TABLE ${TABLE} OWNER TO app_owner`);
  folder = mkdtempSync(join(tmpdir(), "migrate-lock-"));
  mkdirSync(join(folder, "meta"));
  writeFileSync(join(folder, "9999_probe.sql"), `ALTER TABLE ${TABLE} ADD COLUMN extra int;`);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: WHEN, tag: "9999_probe", breakpoints: true }] }));
}, 120_000);

afterAll(async () => {
  await admin?.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await admin?.query(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1`, [WHEN]);
  await admin?.end();
  if (folder) rmSync(folder, { recursive: true, force: true });
  await env?.stop();
});

describe("migrations and table locks", () => {
  it("gives up on a held lock instead of waiting, and leaves the table usable", async () => {
    const holder = await holdLock();
    try {
      const started = Date.now();
      await expect(runMigrations(env.as("app_owner"), folder, LIMITS)).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
      await admin.query("SET statement_timeout = 2000");
      await expect(admin.query(`SELECT * FROM ${TABLE}`)).resolves.toBeDefined();
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
    const cols = await admin.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [TABLE]);
    expect(cols.rows.map((r: { column_name: string }) => r.column_name)).toEqual(["id"]);
  }, 30_000);

  it("retries and succeeds once the lock is free", async () => {
    const holder = await holdLock();
    const release = setTimeout(() => void holder.query("ROLLBACK"), 300);
    try {
      await runMigrations(env.as("app_owner"), folder, { ...LIMITS, attempts: 5 });
    } finally {
      clearTimeout(release);
      await holder.end();
    }
    const cols = await admin.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [TABLE]);
    expect(cols.rows.map((r: { column_name: string }) => r.column_name).sort()).toEqual(["extra", "id"]);
  }, 30_000);
});
