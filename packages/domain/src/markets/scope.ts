import { sql } from "drizzle-orm";
import { withTenant, type Db } from "@bs/db";

/**
 * Like `withTenant`, and when the shopper is in a market also sets the transaction-local `app.market_id`. From then on the
 * SQL functions from migration 0089 return that market's prices and hide products the market does not sell (ADR-040).
 * Storefront reads use this; admin paths never do.
 */
export function withMarketScope<T>(db: Db, ctx: { tenantId: string; marketId?: string | null | undefined }, fn: (tx: Db) => Promise<T>): Promise<T> {
  return withTenant(db, ctx.tenantId, async (tx) => {
    if (ctx.marketId) await tx.execute(sql`select set_config('app.market_id', ${ctx.marketId}, true)`);
    return fn(tx);
  });
}

/** The market the current transaction is scoped to (set by `withMarketScope`), or null for the base market and admin paths. */
export async function getScopedMarketId(tx: Db): Promise<string | null> {
  const res = await tx.execute<{ m: string | null }>(sql`select nullif(current_setting('app.market_id', true), '') as m`);
  return res?.rows?.[0]?.m ?? null;
}
