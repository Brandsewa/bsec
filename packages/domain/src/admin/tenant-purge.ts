import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";

/** Rows that must survive a data purge: the tenant row itself and tax invoices (kept 8 years, PLAN §6.4). */
const KEEP_TABLES = new Set(["tenants", "platform_invoices", "platform_audit_logs"]);

export interface PurgeResult {
  /** Rows deleted per table, only tables where something was removed. */
  deleted: Record<string, number>;
}

/**
 * Deletes every row that belongs to one tenant, across all tables that carry a tenant_id column, in
 * foreign-key order (children before parents). It never touches other tenants' rows and keeps the tenant
 * row itself. Used by the demo-store remover and reusable for the tenant deletion workflow (PLAN §6.4).
 *
 * Must run with a role that can see and delete every row of the tenant (app_platform, BYPASSRLS); with a
 * tenant-scoped role it simply deletes what RLS allows.
 */
export async function purgeTenantData(db: Db, tenantId: string): Promise<PurgeResult> {
  return db.transaction(async (tx) => {
    const tablesRes = await tx.execute<{ table_name: string }>(sql`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
    `);
    const tables = new Set(tablesRes.rows.map((r) => r.table_name).filter((t) => !KEEP_TABLES.has(t)));

    // child -> parents among the tenant tables (a table may reference itself; that is fine in one statement)
    const fkRes = await tx.execute<{ child: string; parent: string }>(sql`
      SELECT cl.relname AS child, pl.relname AS parent
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_class pl ON pl.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = 'public'
       WHERE con.contype = 'f'
    `);
    const parentsOf = new Map<string, Set<string>>();
    for (const t of tables) parentsOf.set(t, new Set());
    for (const { child, parent } of fkRes.rows) {
      if (child !== parent && tables.has(child) && tables.has(parent)) parentsOf.get(child)?.add(parent);
    }

    // Delete order: a table is deleted only after every table that references it has been deleted.
    const remaining = new Set(tables);
    const order: string[] = [];
    while (remaining.size > 0) {
      const ready = [...remaining].filter((t) => {
        for (const other of remaining) {
          if (other !== t && parentsOf.get(other)?.has(t)) return false; // `other` still references `t`
        }
        return true;
      });
      const batch = ready.length > 0 ? ready : [...remaining].slice(0, 1); // cycle: break it deterministically
      for (const t of batch) {
        order.push(t);
        remaining.delete(t);
      }
    }

    const deleted: Record<string, number> = {};
    for (const table of order) {
      const res = await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`);
      const n = res.rowCount ?? 0;
      if (n > 0) deleted[table] = n;
    }
    return { deleted };
  });
}
