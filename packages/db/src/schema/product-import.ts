import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";

/**
 * Product import runs (docs/PRODUCT-BULK-IO-PLAN.md section 4). One row per CSV import: the screen polls it for
 * progress (rows, images downloaded) and for the error list, and the worker updates it as image jobs finish.
 * `errors` is capped by the domain layer (the first 1,000 problems); `counts.errorsTruncated` says when it was cut.
 */
export const productImportRuns = tenantTable(
  "product_import_runs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    /** previewed | running | completed | completed_with_errors | failed */
    status: text("status").notNull().default("previewed"),
    /** What to do when a product (URL handle) or SKU already exists: skip | update | replace. */
    conflictPolicy: text("conflict_policy").notNull().default("update"),
    /** create_only | update_only | create_and_update */
    mode: text("mode").notNull().default("create_and_update"),
    fileName: text("file_name"),
    productsTotal: integer("products_total").notNull().default(0),
    productsDone: integer("products_done").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    imagesTotal: integer("images_total").notNull().default(0),
    imagesDone: integer("images_done").notNull().default(0),
    imagesFailed: integer("images_failed").notNull().default(0),
    /** [{ row, handle, kind: "row" | "conflict" | "image", message }] */
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    errorsTruncated: integer("errors_truncated").notNull().default(0),
    requestedBy: uuid("requested_by"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check("product_import_runs_status_chk", sql`${t.status} in ('previewed', 'running', 'completed', 'completed_with_errors', 'failed')`),
    check("product_import_runs_policy_chk", sql`${t.conflictPolicy} in ('skip', 'update', 'replace')`),
    check("product_import_runs_mode_chk", sql`${t.mode} in ('create_only', 'update_only', 'create_and_update')`),
    index("product_import_runs_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);
