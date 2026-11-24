/**
 * Integration: real PostgreSQL 18. Runtime roles get statement / idle-in-transaction / lock timeouts so one runaway query
 * or stuck transaction cannot stall every store (docs/BACKUP-DR-PLAN.md G8, outage of 2026-11-02). app_owner is exempt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ROLE_TIMEOUTS } from "../src/sql/roles.ts";
import { startTestDb, type TestDb } from "../test-support/test-env.ts";

let env: TestDb;

beforeAll(async () => {
  env = await startTestDb();
}, 120_000);

afterAll(async () => {
  await env?.stop();
});

async function show(role: "app_owner" | "app_rw" | "app_platform" | "app_saas", setting: string): Promise<string> {
  const c = new pg.Client({ connectionString: env.as(role) });
  await c.connect();
  try {
    return (await c.query(`SHOW ${setting}`)).rows[0][setting] as string;
  } finally {
    await c.end();
  }
}

describe("role timeouts", () => {
  it.each(["app_rw", "app_saas", "app_platform"] as const)("%s has the configured limits", async (role) => {
    const t = ROLE_TIMEOUTS[role]!;
    expect(await show(role, "statement_timeout")).toBe(t.statement);
    expect(await show(role, "idle_in_transaction_session_timeout")).toBe(t.idleInTransaction);
    expect(await show(role, "lock_timeout")).toBe(t.lock);
  });

  it("app_owner (migrations) has no timeouts", async () => {
    expect(await show("app_owner", "statement_timeout")).toBe("0");
    expect(await show("app_owner", "lock_timeout")).toBe("0");
  });

  it("cancels an over-long statement for app_rw but a shorter session override still works", async () => {
    const c = new pg.Client({ connectionString: env.as("app_rw") });
    await c.connect();
    try {
      await c.query("SET statement_timeout = '300ms'");
      await expect(c.query("SELECT pg_sleep(2)")).rejects.toThrow(/statement timeout/);
      // The connection stays usable after a cancelled statement.
      expect((await c.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      await c.end();
    }
  });

  it("lets a job opt out with SET LOCAL inside its transaction", async () => {
    const c = new pg.Client({ connectionString: env.as("app_rw") });
    await c.connect();
    try {
      await c.query("SET statement_timeout = '300ms'");
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout = '5s'");
      await expect(c.query("SELECT pg_sleep(1)")).resolves.toBeDefined();
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
  });
});
