import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index.ts";

export { schema };
export * from "./schema/index.ts";
export { tenantTable, forceRlsSql, tenantPredicate, TENANT_SETTING, tenantForeignKey } from "./tenant-table.ts";
export * from "./queues.ts";

export type Db = NodePgDatabase<typeof schema>;

/** Which credentials a process uses. Each container gets exactly one (PLAN §14). */
export type DbRole = "rw" | "platform";

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(url: string, opts: { max?: number; applicationName?: string } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? "bsec",
    // A DB outage or bad host should fail requests fast, not hang the process indefinitely.
    connectionTimeoutMillis: 5000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** Readiness probe used by every app's /health. */
export async function ping(db: Db): Promise<{ ok: true; role: string }> {
  const res = await db.execute<{ role: string }>(sql`select current_user as role`);
  return { ok: true, role: res.rows[0]?.role ?? "unknown" };
}

/**
 * withTenant(db, tenantId, fn) opens a transaction, sets app.tenant_id via parameterized
 * set_config(..., true) (SET LOCAL), and passes tx to fn (PLAN §4, §13 M1).
 * After commit/rollback, connection resets app.tenant_id to '' which nullif() turns to NULL.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  });
}

/**
 * withUser(db, userId, fn): sets app.user_id (SET LOCAL) so a signed-in user can list their OWN
 * memberships across stores (policy memberships_self_read). It grants no access to any other row.
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}
