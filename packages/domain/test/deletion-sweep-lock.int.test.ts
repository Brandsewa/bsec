import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, runDueTenantDeletions, type Runtime } from "../src/index.ts";

/**
 * The deletion sweep takes an advisory lock so two instances take turns. The lock must be taken and released on one
 * connection: through a connection pool, a session-level lock is unlocked on whichever connection comes next, which
 * leaves it held on the first one and makes every later sweep skip silently (a stalled data-deletion workflow).
 */

let env: TestDb;
let rt: Runtime;
const SWEEP_LOCK_KEY = 0x62_73_64_6c;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

async function advisoryLocksHeld() {
  const res = await rt._db.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${SWEEP_LOCK_KEY} AND granted`,
  );
  return res.rows[0]?.n ?? -1;
}

describe("deletion sweep advisory lock", () => {
  it("releases the lock when a sweep ends, so later sweeps are not skipped", async () => {
    expect(await advisoryLocksHeld()).toBe(0);
    for (let i = 0; i < 6; i++) {
      await runDueTenantDeletions(rt);
      expect(await advisoryLocksHeld()).toBe(0);
    }
  });

  it("never leaves the lock held after concurrent sweeps (each sweep releases it on the connection that took it)", async () => {
    for (let i = 0; i < 25; i++) {
      const results = await Promise.all([runDueTenantDeletions(rt), runDueTenantDeletions(rt), runDueTenantDeletions(rt)]);
      expect(results.every((r) => r.completed === 0 && r.failed === 0)).toBe(true);
      expect(await advisoryLocksHeld(), `lock leaked after round ${i}`).toBe(0);
    }
  });
});
