import { sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";

/** Raw events are kept 90 days; rollups (aggregate counts only) 26 months so "same period last year" always has data (ADR-046). */
export const ANALYTICS_EVENT_RETENTION_DAYS = 90;
export const ANALYTICS_ROLLUP_RETENTION_MONTHS = 26;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rebuilds `analytics_traffic_daily` for one store from its raw events, for the given store-local days (default: yesterday and
 * today in the store timezone). Idempotent: the days are deleted and written again in one transaction.
 */
export async function rollupTrafficForTenant(
  db: Db,
  tenantId: string,
  range?: { from: string; to: string },
): Promise<{ rows: number }> {
  if (range && (!DAY.test(range.from) || !DAY.test(range.to))) throw new Error("Bad Request: days must be yyyy-MM-dd");
  return withTenant(db, tenantId, async (tx) => {
    const tzRes = await tx.execute<{ tz: string; today: string }>(sql`
      SELECT s.tz, to_char((now() AT TIME ZONE s.tz)::date, 'YYYY-MM-DD') AS today
      FROM (SELECT COALESCE((SELECT timezone FROM store_settings WHERE tenant_id = ${tenantId} LIMIT 1), 'Asia/Kolkata') AS tz) s`);
    const { tz, today } = tzRes.rows[0]!;
    const to = range?.to ?? today;
    const from = range?.from ?? sql`(${today}::date - 1)`;

    await tx.execute(sql`
      DELETE FROM analytics_traffic_daily
      WHERE tenant_id = ${tenantId} AND day >= ${from}::date AND day <= ${to}::date`);

    const res = await tx.execute(sql`
      WITH ev AS (
        SELECT visitor_hash, (occurred_at AT TIME ZONE ${tz})::date AS day, occurred_at, event_type, path, product_slug,
               referrer_host, utm_source, country, device
        FROM analytics_events
        WHERE tenant_id = ${tenantId}
          AND occurred_at >= (${from}::date::timestamp AT TIME ZONE ${tz})
          AND occurred_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})
      ), visits AS (
        SELECT day, visitor_hash,
          count(*) FILTER (WHERE event_type = 'pageview') AS pv,
          bool_or(event_type = 'pageview' AND product_slug IS NOT NULL) AS viewed,
          bool_or(event_type = 'add_to_cart') AS carted,
          bool_or(event_type = 'begin_checkout' OR (event_type = 'pageview' AND path ~ '(^|/)checkout$')) AS checkout,
          (array_agg(referrer_host ORDER BY occurred_at) FILTER (WHERE event_type = 'pageview'))[1] AS referrer,
          (array_agg(utm_source ORDER BY occurred_at) FILTER (WHERE event_type = 'pageview'))[1] AS source,
          (array_agg(path ORDER BY occurred_at) FILTER (WHERE event_type = 'pageview'))[1] AS landing,
          max(country) AS country,
          max(device) AS device
        FROM ev GROUP BY day, visitor_hash
      ), dims AS (
        SELECT day, 'total' AS dimension, '' AS key, pv, viewed, carted, checkout FROM visits
        UNION ALL SELECT day, 'referrer', COALESCE(referrer, '(direct)'), pv, viewed, carted, checkout FROM visits
        UNION ALL SELECT day, 'source', COALESCE(source, '(none)'), pv, viewed, carted, checkout FROM visits
        UNION ALL SELECT day, 'country', COALESCE(country, '(unknown)'), pv, viewed, carted, checkout FROM visits
        UNION ALL SELECT day, 'device', COALESCE(device, '(unknown)'), pv, viewed, carted, checkout FROM visits
        UNION ALL SELECT day, 'landing', COALESCE(landing, '(unknown)'), pv, viewed, carted, checkout FROM visits
      )
      INSERT INTO analytics_traffic_daily (tenant_id, day, dimension, key, sessions, pageviews, product_views, carts, checkouts, bounces)
      SELECT ${tenantId}, day, dimension, key,
        count(*)::int, COALESCE(sum(pv), 0)::int,
        (count(*) FILTER (WHERE viewed))::int, (count(*) FILTER (WHERE carted))::int, (count(*) FILTER (WHERE checkout))::int,
        (count(*) FILTER (WHERE pv <= 1 AND NOT carted AND NOT checkout))::int
      FROM dims GROUP BY day, dimension, key`);
    return { rows: res.rowCount ?? 0 };
  });
}

/** Hourly worker pass: rebuild yesterday and today for every store, then apply retention. One store failing never stops the rest. */
export async function runAnalyticsMaintenance(db: Db): Promise<{ tenants: number; rolledUp: number; failed: number; prunedEvents: number }> {
  const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  let rolledUp = 0;
  let failed = 0;
  let prunedEvents = 0;
  for (const t of tenants) {
    try {
      rolledUp += (await rollupTrafficForTenant(db, t.id)).rows;
      prunedEvents += await withTenant(db, t.id, async (tx) => {
        const del = await tx.execute(sql`
          DELETE FROM analytics_events
          WHERE tenant_id = ${t.id} AND occurred_at < now() - make_interval(days => ${ANALYTICS_EVENT_RETENTION_DAYS})`);
        await tx.execute(sql`
          DELETE FROM analytics_traffic_daily
          WHERE tenant_id = ${t.id} AND day < (now() - make_interval(months => ${ANALYTICS_ROLLUP_RETENTION_MONTHS}))::date`);
        return del.rowCount ?? 0;
      });
    } catch {
      failed += 1;
    }
  }
  return { tenants: tenants.length, rolledUp, failed, prunedEvents };
}
