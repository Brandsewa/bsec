import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { products } from "./catalog.ts";

/**
 * Search Queries (PLAN §5.5 / M3).
 * Aggregates storefront search terms per day for discovery and analytics.
 */
export const searchQueries = tenantTable(
  "search_queries",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    resultsCount: integer("results_count").notNull().default(0),
    clickedProductId: uuid("clicked_product_id"),
    day: date("day").notNull().default(sql`CURRENT_DATE`),
    count: integer("count").notNull().default(1),
  },
  (t) => [
    unique("search_queries_tenant_norm_day_uniq").on(t.tenantId, t.normalizedQuery, t.day),
    index("search_queries_tenant_day_idx").on(t.tenantId, t.day),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.clickedProductId,
      target: products,
      name: "search_queries_clicked_product_fk",
      onDelete: "set null",
    }),
  ],
);
