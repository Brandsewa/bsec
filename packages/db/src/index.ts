import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index.ts";

export { schema };
export { tenantTable, forceRlsSql, tenantPredicate, TENANT_SETTING } from "./tenant-table.ts";

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
 * M1: withTenant(ctx, fn) opens a transaction, runs SET LOCAL app.tenant_id, and passes tx to fn.
 * Declared now so domain code can be written against the final signature.
 */
export async function withTenant<T>(_db: Db, _tenantId: string, _fn: (tx: Db) => Promise<T>): Promise<T> {
  throw new Error("withTenant() is implemented in M1");
}
