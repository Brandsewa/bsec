import { sql, type SQL } from "drizzle-orm";
import { pgPolicy, pgTable, uuid, type PgColumnBuilderBase } from "drizzle-orm/pg-core";

/**
 * M0 STUB of the tenant table helper (full version lands in M1, PLAN §13).
 *
 * What it already guarantees for every table declared through it:
 *  - `tenant_id uuid not null` column
 *  - RLS enabled + the `tenant_isolation` policy using nullif() (PLAN §4)
 * Not yet: composite (tenant_id, x_id) FKs, the tenants FK, and tenant-first index helpers.
 *
 * drizzle-kit cannot emit FORCE ROW LEVEL SECURITY, so every migration that creates a
 * tenant table must also include `forceRlsSql(name)` (a custom migration). The M1 isolation
 * suite asserts `relforcerowsecurity` for every table in `tenantTableNames`.
 */
export const TENANT_SETTING = "app.tenant_id";

/** The policy predicate. nullif() is required: a reset SET LOCAL reads back as '' on pooled connections. */
export const tenantPredicate: SQL = sql.raw(
  `tenant_id = nullif(current_setting('${TENANT_SETTING}', true), '')::uuid`,
);

export const tenantTableNames = new Set<string>();

export function tenantTable<TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  name: TName,
  columns: TColumns,
) {
  tenantTableNames.add(name);
  return pgTable(name, { tenantId: uuid("tenant_id").notNull(), ...columns }, () => [
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      using: tenantPredicate,
      withCheck: tenantPredicate,
    }),
  ]).enableRLS();
}

/** SQL every tenant-table migration must contain (drizzle-kit only emits ENABLE). */
export function forceRlsSql(table: string): string {
  const t = `"${table.replaceAll('"', '""')}"`;
  return `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\nALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`;
}
