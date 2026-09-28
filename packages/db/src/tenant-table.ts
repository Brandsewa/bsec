import { sql, type SQL } from "drizzle-orm";
import type { BuildColumns, BuildExtraConfigColumns } from "drizzle-orm/column-builder";
import {
  foreignKey,
  pgPolicy,
  pgTable,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  type ForeignKeyBuilder,
  type PgUUIDBuilderInitial,
  type PgTableWithColumns,
} from "drizzle-orm/pg-core";
import { tenants } from "./schema/tenants.ts";

/**
 * Tenant table helper (PLAN §4, §13 M1).
 *
 * Guarantees for every table declared through it:
 *  - `tenant_id uuid not null` referencing `tenants.id` with `onDelete: "restrict"`
 *  - RLS enabled + the `tenant_isolation` policy using nullif() (PLAN §4)
 *  - Extra config support for unique constraints, indexes, and composite FKs
 *  - Registration in `tenantTableNames` for migration and test assertion
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

export interface TenantForeignKeyOptions {
  tableTenantId: AnyPgColumn;
  column: AnyPgColumn;
  target: { tenantId: AnyPgColumn; id: AnyPgColumn };
  name?: string;
  onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
}

/**
 * Composite foreign key helper for references between tenant tables:
 * creates FOREIGN KEY (tenant_id, column) REFERENCES target (tenant_id, id).
 * Prevents referencing another tenant's row even if IDs match.
 */
export function tenantForeignKey(opts: TenantForeignKeyOptions): ForeignKeyBuilder {
  const fkConfig: {
    columns: [AnyPgColumn, AnyPgColumn];
    foreignColumns: [AnyPgColumn, AnyPgColumn];
    name?: string;
  } = {
    columns: [opts.tableTenantId, opts.column],
    foreignColumns: [opts.target.tenantId, opts.target.id],
  };
  if (opts.name) {
    fkConfig.name = opts.name;
  }
  const fk = foreignKey(fkConfig);
  return opts.onDelete ? fk.onDelete(opts.onDelete) : fk;
}

export type TenantColumns<TColumns extends Record<string, PgColumnBuilderBase>> = {
  tenantId: PgUUIDBuilderInitial<"tenant_id">;
} & TColumns;

export type TenantTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
> = Omit<
  PgTableWithColumns<{
    name: TName;
    schema: undefined;
    columns: BuildColumns<TName, TenantColumns<TColumns>, "pg">;
    dialect: "pg";
  }>,
  "enableRLS"
>;

export function tenantTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
  TExtra extends readonly PgTableExtraConfigValue[] | Record<string, PgTableExtraConfigValue> = readonly PgTableExtraConfigValue[],
>(
  name: TName,
  columns: TColumns,
  extraConfig?: (
    table: BuildExtraConfigColumns<TName, TenantColumns<TColumns>, "pg">,
  ) => TExtra,
): TenantTable<TName, TColumns> {
  tenantTableNames.add(name);
  const fullColumns: TenantColumns<TColumns> = {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    ...columns,
  };
  const table = pgTable(
    name,
    fullColumns,
    (t: BuildExtraConfigColumns<TName, TenantColumns<TColumns>, "pg">) => {
      const extra = extraConfig ? extraConfig(t) : [];
      const extraList = Array.isArray(extra) ? extra : Object.values(extra);
      return [
        pgPolicy("tenant_isolation", {
          as: "permissive",
          for: "all",
          using: tenantPredicate,
          withCheck: tenantPredicate,
        }),
        ...extraList,
      ];
    },
  );
  return table.enableRLS() as unknown as TenantTable<TName, TColumns>;
}

/** SQL every tenant-table migration must contain (drizzle-kit only emits ENABLE). */
export function forceRlsSql(table: string): string {
  const t = `"${table.replaceAll('"', '""')}"`;
  return `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\nALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`;
}
