import { and, desc, ilike, isNull, sql, inArray } from "drizzle-orm";
import { LISTED_PRODUCT_STATUSES } from "./product-status.ts";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { isFeatureEnabled } from "../features.ts";
import { buildProductSummaries, type StorefrontProductSummary } from "./catalog.ts";

export interface SearchProductsOptions {
  page?: number | undefined;
  limit?: number | undefined;
}

export interface SearchProductsResult {
  items: StorefrontProductSummary[];
  total: number;
}

export interface SearchSuggestion {
  title: string;
  slug: string;
}

/**
 * Searches published products using full-text search (websearch_to_tsquery) OR trigram match,
 * logs the search query to `search_queries`, and returns matching products ranked by relevance.
 */
export async function searchStorefrontProducts(
  rt: Runtime,
  ctx: TenantContext,
  rawQuery: string,
  opts?: SearchProductsOptions,
): Promise<SearchProductsResult> {
  const normalizedQuery = rawQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return { items: [], total: 0 };
  }

  const catalogEnabled = await isFeatureEnabled(rt._db.db, ctx.tenantId, "catalog");
  if (!catalogEnabled) {
    return { items: [], total: 0 };
  }

  const db = rt._db.db;
  const escapedQuery = normalizedQuery.replace(/[%_\\]/g, "\\$&");

  const searchResult = await withTenant(db, ctx.tenantId, async (tx) => {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 24));
    const offset = (page - 1) * limit;

    // Search condition:
    // FTS on searchVector using websearch_to_tsquery OR trigram / ILIKE similarity on title
    const searchFilter = sql`(
      ${schema.products.searchVector} @@ websearch_to_tsquery('english', ${normalizedQuery})
      OR ${schema.products.title} % ${normalizedQuery}
      OR ${schema.products.title} ILIKE ${`%${escapedQuery}%`}
    )`;

    const baseWhere = and(
      searchFilter,
      inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
      isNull(schema.products.deletedAt),
    );

    // Rank expression: ts_rank_cd + trigram similarity bonus
    const rankExpr = sql`ts_rank_cd(${schema.products.searchVector}, websearch_to_tsquery('english', ${normalizedQuery})) + similarity(${schema.products.title}, ${normalizedQuery})`;

    const rows = await tx
      .select()
      .from(schema.products)
      .where(baseWhere)
      .orderBy(desc(rankExpr), desc(schema.products.createdAt))
      .limit(limit)
      .offset(offset);

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(baseWhere);

    const total = Number(countRows[0]?.count ?? rows.length);
    const productIds = rows.map((r) => r.id);
    const items = await buildProductSummaries(tx, productIds, rows);

    return {
      items,
      total,
    };
  });

  // Log query into search_queries table with daily aggregation in an isolated tenant transaction
  // so any logging failure or db issue never fails the search response or aborts the search tx
  try {
    await withTenant(db, ctx.tenantId, async (tx) => {
      await tx
        .insert(schema.searchQueries)
        .values({
          tenantId: ctx.tenantId,
          query: rawQuery.trim(),
          normalizedQuery,
          resultsCount: searchResult.total,
          day: sql`CURRENT_DATE`,
          count: 1,
        })
        .onConflictDoUpdate({
          target: [
            schema.searchQueries.tenantId,
            schema.searchQueries.normalizedQuery,
            schema.searchQueries.day,
          ],
          set: {
            count: sql`${schema.searchQueries.count} + 1`,
            resultsCount: sql`excluded.results_count`,
          },
        });
    });
  } catch {
    // Non-blocking: search logging must never break search operations
  }

  return searchResult;
}

/**
 * Returns typeahead search suggestions matching a partial query string.
 */
export async function getSearchSuggestions(
  rt: Runtime,
  ctx: TenantContext,
  partial: string,
  limit = 5,
): Promise<SearchSuggestion[]> {
  const catalogEnabled = await isFeatureEnabled(rt._db.db, ctx.tenantId, "catalog");
  if (!catalogEnabled) return [];

  const normalized = partial.trim().toLowerCase();
  if (!normalized) return [];

  const escaped = normalized.replace(/[%_\\]/g, "\\$&");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        title: schema.products.title,
        slug: schema.products.slug,
      })
      .from(schema.products)
      .where(
        and(
          ilike(schema.products.title, `%${escaped}%`),
          inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
          isNull(schema.products.deletedAt),
        ),
      )
      .limit(limit);

    return rows.map((r) => ({
      title: r.title,
      slug: r.slug,
    }));
  });
}
