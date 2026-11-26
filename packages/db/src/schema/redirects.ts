import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";

/**
 * Store redirects (ADR-051): an old address that must keep working. `from_path` is stored normalised (leading slash, no trailing
 * slash, no query string; compared case-insensitively). `to_path` is a path on the store or an https URL. The storefront gate
 * answers them before any page renders.
 */
export const tenantRedirects = tenantTable(
  "tenant_redirects",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    fromPath: citext("from_path").notNull(),
    toPath: text("to_path").notNull(),
    statusCode: integer("status_code").notNull().default(308),
    /** manual (typed in the admin), import (CSV) or auto (a product, collection, category or page slug changed). */
    source: text("source").notNull().default("manual"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("tenant_redirects_tenant_from_uniq").on(t.tenantId, t.fromPath),
    unique("tenant_redirects_tenant_id_uniq").on(t.tenantId, t.id),
    index("tenant_redirects_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("tenant_redirects_status_chk", sql`${t.statusCode} in (301, 302, 307, 308)`),
    check("tenant_redirects_source_chk", sql`${t.source} in ('manual', 'import', 'auto')`),
  ],
);
