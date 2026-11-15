import { sql, type SQL } from "drizzle-orm";
import { withTenant, type Db } from "@bs/db";
import {
  ANALYTICS_REPORTS,
  type AnalyticsColumn,
  type AnalyticsOverview,
  type AnalyticsRangeInput,
  type AnalyticsReport,
  type AnalyticsReportId,
} from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

/**
 * Merchant analytics reports (docs/ANALYTICS-PLAN.md, ADR-047).
 *
 * Definitions, shared by every report:
 * - An order counts when it is not cancelled, on the store-local day it was placed (store timezone, never UTC or the browser's).
 * - Money reports cover one currency at a time (default: the store currency); nothing is summed across currencies.
 *   Sales by market is the exception: it lists every market with its own currency.
 * - Gross sales = order subtotals. Discounts = order discounts. Returns = refunds issued in the period.
 *   Net sales = gross - discounts - returns. Total sales = order grand totals - returns.
 * - Sessions are measured visits from the cookieless collector (daily rollup; today can be up to an hour behind).
 *   Bots, Do Not Track and blocked beacons are not counted, so conversion is a floor, not an exact figure.
 * - A customer is the order's customer id, or its email for guest orders.
 */

type Row = Record<string, string | number | null>;
type Gran = "day" | "week" | "month";
interface P {
  tenantId: string;
  tz: string;
  from: string;
  to: string;
  currency: string;
  gran: Gran;
  days: number;
}
interface Built {
  columns: AnalyticsColumn[];
  rows: Row[];
  chart: AnalyticsReport["chart"];
  note?: string;
}

const MAX_RANGE_DAYS = 800;
const TRAFFIC_NOTE = "Measured visits only: bots, Do Not Track and blocked requests are not counted. Today can be up to an hour behind.";

const c = (key: string, label: string, kind: AnalyticsColumn["kind"] = "number"): AnalyticsColumn => ({ key, label, kind });
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

const lo = (p: P): SQL => sql`(${p.from}::date::timestamp AT TIME ZONE ${p.tz})`;
const hi = (p: P): SQL => sql`((${p.to}::date + 1)::timestamp AT TIME ZONE ${p.tz})`;
const within = (col: SQL, p: P): SQL => sql`${col} >= ${lo(p)} AND ${col} < ${hi(p)}`;
/** Orders that count, in the selected currency. */
const ordersIn = (p: P): SQL =>
  sql`o.tenant_id = ${p.tenantId} AND o.status <> 'cancelled' AND o.currency = ${p.currency} AND ${within(sql`o.placed_at`, p)}`;
/** Orders that count, in any currency (conversion and stock, where money is not summed). */
const ordersAnyCurrency = (p: P): SQL => sql`o.tenant_id = ${p.tenantId} AND o.status <> 'cancelled' AND ${within(sql`o.placed_at`, p)}`;
const custKey = (alias: string): SQL => sql.raw(`COALESCE(${alias}.customer_id::text, lower(${alias}.email::text))`);
/** Bucket label for a timestamp column, in the store timezone. `gran` is a validated enum, so sql.raw is safe. */
const bucketOf = (col: SQL, p: P): SQL => sql`to_char(date_trunc(${sql.raw(`'${p.gran}'`)}, ${col} AT TIME ZONE ${p.tz}), 'YYYY-MM-DD')`;
const dayBucket = (p: P): SQL => sql`to_char(date_trunc(${sql.raw(`'${p.gran}'`)}, day::timestamp), 'YYYY-MM-DD')`;
const trafficIn = (p: P, dimension: string): SQL =>
  sql`tenant_id = ${p.tenantId} AND dimension = ${dimension} AND day >= ${p.from}::date AND day <= ${p.to}::date`;
const priorOrder = (p: P, before: SQL, key: SQL): SQL => sql`EXISTS (
  SELECT 1 FROM orders pr WHERE pr.tenant_id = ${p.tenantId} AND pr.status <> 'cancelled' AND ${custKey("pr")} = ${key} AND pr.placed_at < ${before})`;

async function q(tx: Db, query: SQL): Promise<Row[]> {
  const res = await tx.execute(query);
  return res.rows as Row[];
}

/** Runs `inner` (must select `bucket` plus `cols`) and returns one row per bucket of the range, zero-filled. */
async function overTime<K extends string>(tx: Db, p: P, inner: SQL, cols: K[]): Promise<Array<Record<K, number> & { bucket: string }>> {
  const picks = sql.raw(cols.map((k) => `COALESCE(s.${k}, 0) AS ${k}`).join(", "));
  const rows = await q(
    tx,
    sql`WITH b AS (
          SELECT to_char(g, 'YYYY-MM-DD') AS bucket
          FROM generate_series(date_trunc(${sql.raw(`'${p.gran}'`)}, ${p.from}::date::timestamp), ${p.to}::date::timestamp, ${sql.raw(`'1 ${p.gran}'`)}::interval) g
        ), s AS (${inner})
        SELECT b.bucket, ${picks} FROM b LEFT JOIN s USING (bucket) ORDER BY b.bucket`,
  );
  return rows.map((r) => {
    const out: Record<string, number | string> = { bucket: String(r.bucket) };
    for (const k of cols) out[k] = num(r[k]);
    return out as Record<K, number> & { bucket: string };
  });
}

const salesInner = (p: P): SQL => sql`
  SELECT ${bucketOf(sql`o.placed_at`, p)} AS bucket, count(*) AS orders, sum(o.subtotal) AS gross, sum(o.discount_total) AS discounts,
         sum(o.shipping_total + o.cod_fee) AS shipping, sum(o.tax_total) AS taxes, sum(o.grand_total) AS grand
  FROM orders o WHERE ${ordersIn(p)} GROUP BY 1`;
const refundsFrom = (p: P): SQL => sql`
  FROM refunds r JOIN orders o ON o.tenant_id = r.tenant_id AND o.id = r.order_id
  WHERE r.tenant_id = ${p.tenantId} AND r.status IN ('succeeded', 'processed') AND o.currency = ${p.currency} AND ${within(sql`r.created_at`, p)}`;
const refundsInner = (p: P): SQL =>
  sql`SELECT ${bucketOf(sql`r.created_at`, p)} AS bucket, count(*) AS refunds, sum(r.amount) AS returns ${refundsFrom(p)} GROUP BY 1`;
const itemsInner = (p: P): SQL => sql`
  SELECT ${bucketOf(sql`o.placed_at`, p)} AS bucket, count(DISTINCT o.id) AS orders, COALESCE(sum(oi.quantity), 0) AS items
  FROM orders o LEFT JOIN order_items oi ON oi.tenant_id = o.tenant_id AND oi.order_id = o.id
  WHERE ${ordersIn(p)} GROUP BY 1`;
const trafficInner = (p: P): SQL => sql`
  SELECT ${dayBucket(p)} AS bucket, sum(sessions) AS sessions, sum(pageviews) AS pageviews, sum(product_views) AS product_views,
         sum(carts) AS carts, sum(checkouts) AS checkouts, sum(bounces) AS bounces
  FROM analytics_traffic_daily WHERE ${trafficIn(p, "total")} GROUP BY 1`;

const SOCIAL = /(^|\.)(instagram|facebook|fb|twitter|x|t|youtube|youtu|pinterest|linkedin|lnkd|reddit|threads|tiktok|whatsapp|wa|telegram|snapchat)\.(com|me|be|in|co|net|org)$/;
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave)\./;
function referrerType(host: string): string {
  if (host === "(direct)") return "Direct";
  if (SOCIAL.test(host)) return "Social";
  if (SEARCH.test(host)) return "Search";
  return "Other site";
}

async function byDimension(tx: Db, p: P, dimension: string, label: string): Promise<Built> {
  const rows = await q(
    tx,
    sql`SELECT key, sum(sessions)::int AS sessions, sum(pageviews)::int AS pageviews, sum(carts)::int AS carts, sum(checkouts)::int AS checkouts
        FROM analytics_traffic_daily WHERE ${trafficIn(p, dimension)} GROUP BY key ORDER BY 2 DESC, key LIMIT 200`,
  );
  return {
    columns: [c("key", label, "text"), c("sessions", "Sessions"), c("pageviews", "Page views"), c("carts", "Added to cart"), c("checkouts", "Reached checkout")],
    rows,
    chart: { type: "bar", x: "key", series: ["sessions"] },
    note: TRAFFIC_NOTE,
  };
}

const BUILDERS: Record<AnalyticsReportId, (tx: Db, p: P) => Promise<Built>> = {
  async sales_over_time(tx, p) {
    const sales = await overTime(tx, p, salesInner(p), ["orders", "gross", "discounts", "shipping", "taxes", "grand"]);
    const refunds = await overTime(tx, p, refundsInner(p), ["returns"]);
    const rows = sales.map((s, i) => {
      const returns = refunds[i]?.returns ?? 0;
      return {
        bucket: s.bucket, orders: s.orders, gross: s.gross, discounts: s.discounts, returns,
        net: s.gross - s.discounts - returns, shipping: s.shipping, taxes: s.taxes, total: s.grand - returns,
      };
    });
    return {
      columns: [c("bucket", "Date", "date"), c("orders", "Orders"), c("gross", "Gross sales", "money"), c("discounts", "Discounts", "money"), c("returns", "Returns", "money"), c("net", "Net sales", "money"), c("shipping", "Shipping", "money"), c("taxes", "Taxes", "money"), c("total", "Total sales", "money")],
      rows,
      chart: { type: "line", x: "bucket", series: ["total"] },
    };
  },

  async sales_by_product(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT oi.product_title AS product, sum(oi.quantity)::int AS quantity, sum(oi.total)::float8 AS total
          FROM order_items oi JOIN orders o ON o.tenant_id = oi.tenant_id AND o.id = oi.order_id
          WHERE ${ordersIn(p)} GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 200`,
    );
    return { columns: [c("product", "Product", "text"), c("quantity", "Units sold"), c("total", "Sales", "money")], rows, chart: { type: "bar", x: "product", series: ["total"] } };
  },

  async aov_over_time(tx, p) {
    const sales = await overTime(tx, p, salesInner(p), ["orders", "grand"]);
    const rows = sales.map((s) => ({ bucket: s.bucket, orders: s.orders, total: s.grand, aov: s.orders > 0 ? Math.round(s.grand / s.orders) : 0 }));
    return {
      columns: [c("bucket", "Date", "date"), c("orders", "Orders"), c("total", "Sales", "money"), c("aov", "Average order value", "money")],
      rows,
      chart: { type: "line", x: "bucket", series: ["aov"] },
    };
  },

  async sales_by_discount(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT COALESCE(a.code, a.title) AS discount, count(DISTINCT a.order_id)::int AS orders,
                 sum(a.amount + a.shipping_amount)::float8 AS given, sum(o.grand_total)::float8 AS total
          FROM order_discount_applications a JOIN orders o ON o.tenant_id = a.tenant_id AND o.id = a.order_id
          WHERE a.tenant_id = ${p.tenantId} AND ${ordersIn(p)} GROUP BY 1 ORDER BY 4 DESC, 1 LIMIT 200`,
    );
    return {
      columns: [c("discount", "Discount", "text"), c("orders", "Orders"), c("given", "Discount given", "money"), c("total", "Sales", "money")],
      rows,
      chart: { type: "bar", x: "discount", series: ["total"] },
      note: "Orders placed before discounts were recorded per order (November 2026) are not listed.",
    };
  },

  async sales_by_channel(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT o.source AS channel, count(*)::int AS orders, sum(o.grand_total)::float8 AS total
          FROM orders o WHERE ${ordersIn(p)} GROUP BY 1 ORDER BY 3 DESC, 1`,
    );
    return { columns: [c("channel", "Sales channel", "text"), c("orders", "Orders"), c("total", "Sales", "money")], rows, chart: { type: "bar", x: "channel", series: ["total"] } };
  },

  async sales_by_market(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT COALESCE(m.name, 'Default') AS market, o.currency AS currency, count(*)::int AS orders, sum(o.grand_total)::float8 AS total
          FROM orders o LEFT JOIN markets m ON m.tenant_id = o.tenant_id AND m.id = o.market_id
          WHERE ${ordersAnyCurrency(p)} GROUP BY 1, 2 ORDER BY 3 DESC, 1`,
    );
    return {
      columns: [c("market", "Market", "text"), c("currency", "Currency", "text"), c("orders", "Orders"), c("total", "Sales", "money")],
      rows,
      chart: { type: "bar", x: "market", series: ["orders"] },
      note: "Each market is shown in its own currency. Amounts in different currencies are never added together.",
    };
  },

  async sales_new_vs_returning(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT CASE WHEN ${priorOrder(p, sql`o.placed_at`, custKey("o"))} THEN 'Returning' ELSE 'New' END AS customer_type,
                 count(*)::int AS orders, sum(o.grand_total)::float8 AS total
          FROM orders o WHERE ${ordersIn(p)} GROUP BY 1 ORDER BY 1`,
    );
    return { columns: [c("customer_type", "Customer type", "text"), c("orders", "Orders"), c("total", "Sales", "money")], rows, chart: { type: "bar", x: "customer_type", series: ["total"] } };
  },

  async sales_reversals_over_time(tx, p) {
    const rows = await overTime(tx, p, refundsInner(p), ["refunds", "returns"]);
    return {
      columns: [c("bucket", "Date", "date"), c("refunds", "Refunds"), c("returns", "Amount refunded", "money")],
      rows,
      chart: { type: "line", x: "bucket", series: ["returns"] },
    };
  },

  async orders_over_time(tx, p) {
    const rows = await overTime(tx, p, itemsInner(p), ["orders", "items"]);
    return { columns: [c("bucket", "Date", "date"), c("orders", "Orders"), c("items", "Items ordered")], rows, chart: { type: "line", x: "bucket", series: ["orders"] } };
  },

  async orders_fulfilled_over_time(tx, p) {
    const rows = await overTime(
      tx,
      p,
      sql`SELECT ${bucketOf(sql`f.shipped_at`, p)} AS bucket, count(DISTINCT f.order_id) AS fulfilled,
                 round((avg(extract(epoch FROM (f.shipped_at - o.placed_at))) / 3600)::numeric, 1) AS hours
          FROM fulfillments f JOIN orders o ON o.tenant_id = f.tenant_id AND o.id = f.order_id
          WHERE f.tenant_id = ${p.tenantId} AND o.status <> 'cancelled' AND o.currency = ${p.currency} AND ${within(sql`f.shipped_at`, p)}
          GROUP BY 1`,
      ["fulfilled", "hours"],
    );
    return {
      columns: [c("bucket", "Date", "date"), c("fulfilled", "Orders shipped"), c("hours", "Average time to ship", "hours")],
      rows,
      chart: { type: "line", x: "bucket", series: ["fulfilled"] },
    };
  },

  async reversed_quantity_over_time(tx, p) {
    const ordered = await overTime(tx, p, itemsInner(p), ["items"]);
    const returned = await overTime(
        tx,
        p,
        sql`SELECT ${bucketOf(sql`ri.created_at`, p)} AS bucket, sum(ri.quantity) AS returned
            FROM return_items ri
            JOIN returns rt ON rt.tenant_id = ri.tenant_id AND rt.id = ri.return_id
            JOIN orders o ON o.tenant_id = rt.tenant_id AND o.id = rt.order_id
            WHERE ri.tenant_id = ${p.tenantId} AND rt.status NOT IN ('rejected', 'cancelled') AND o.currency = ${p.currency} AND ${within(sql`ri.created_at`, p)}
            GROUP BY 1`,
        ["returned"],
      );
    const rows = ordered.map((o, i) => {
      const r = returned[i]?.returned ?? 0;
      return { bucket: o.bucket, ordered: o.items, returned: r, rate: pct(r, o.items) };
    });
    return {
      columns: [c("bucket", "Date", "date"), c("ordered", "Items ordered"), c("returned", "Items returned"), c("rate", "Return rate", "percent")],
      rows,
      chart: { type: "line", x: "bucket", series: ["returned"] },
      note: "Returns are counted on the day they were requested; rejected and cancelled returns are left out.",
    };
  },

  async items_reversed_by_product(tx, p) {
    const raw = await q(
      tx,
      sql`SELECT oi.product_title AS product, sum(oi.quantity)::int AS ordered, sum(oi.returned_qty)::int AS returned
          FROM order_items oi JOIN orders o ON o.tenant_id = oi.tenant_id AND o.id = oi.order_id
          WHERE ${ordersIn(p)} GROUP BY 1 HAVING sum(oi.returned_qty) > 0 ORDER BY 3 DESC, 1 LIMIT 200`,
    );
    const rows = raw.map((r) => ({ ...r, rate: pct(num(r.returned), num(r.ordered)) }));
    return {
      columns: [c("product", "Product", "text"), c("ordered", "Ordered"), c("returned", "Returned"), c("rate", "Return rate", "percent")],
      rows,
      chart: { type: "bar", x: "product", series: ["returned"] },
      note: "For orders placed in this period.",
    };
  },

  async orders_by_location(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT COALESCE(NULLIF(o.shipping_address->>'state', ''), 'Unknown') AS state,
                 COALESCE(NULLIF(o.shipping_address->>'city', ''), 'Unknown') AS city,
                 count(*)::int AS orders, sum(o.grand_total)::float8 AS total
          FROM orders o WHERE ${ordersIn(p)} GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2 LIMIT 200`,
    );
    return { columns: [c("state", "State", "text"), c("city", "City", "text"), c("orders", "Orders"), c("total", "Sales", "money")], rows, chart: { type: "bar", x: "city", series: ["orders"] } };
  },

  async customers_new_vs_returning(tx, p) {
    const raw = await overTime(
      tx,
      p,
      sql`SELECT bucket, count(DISTINCT k) FILTER (WHERE NOT ret) AS new_customers, count(DISTINCT k) FILTER (WHERE ret) AS returning_customers
          FROM (SELECT ${bucketOf(sql`o.placed_at`, p)} AS bucket, ${custKey("o")} AS k, ${priorOrder(p, sql`o.placed_at`, custKey("o"))} AS ret
                FROM orders o WHERE ${ordersIn(p)}) x
          GROUP BY 1`,
      ["new_customers", "returning_customers"],
    );
    const rows = raw.map((r) => ({ ...r, rate: pct(r.returning_customers ?? 0, (r.new_customers ?? 0) + (r.returning_customers ?? 0)) }));
    return {
      columns: [c("bucket", "Date", "date"), c("new_customers", "New customers"), c("returning_customers", "Returning customers"), c("rate", "Returning customer rate", "percent")],
      rows,
      chart: { type: "line", x: "bucket", series: ["new_customers", "returning_customers"] },
    };
  },

  async customers_one_time_vs_repeat(tx, p) {
    const raw = await q(
      tx,
      sql`WITH cu AS (SELECT ${custKey("o")} AS k FROM orders o WHERE ${ordersIn(p)} GROUP BY 1),
               life AS (SELECT cu.k, (SELECT count(*) FROM orders pr WHERE pr.tenant_id = ${p.tenantId} AND pr.status <> 'cancelled'
                                        AND ${custKey("pr")} = cu.k AND pr.placed_at < ${hi(p)}) AS n FROM cu)
          SELECT CASE WHEN n <= 1 THEN 'One-time' ELSE 'Repeat' END AS customer_type, count(*)::int AS customers FROM life GROUP BY 1 ORDER BY 1`,
    );
    const total = raw.reduce((s, r) => s + num(r.customers), 0);
    const rows = raw.map((r) => ({ ...r, share: pct(num(r.customers), total) }));
    return {
      columns: [c("customer_type", "Customer type", "text"), c("customers", "Customers"), c("share", "Share", "percent")],
      rows,
      chart: { type: "bar", x: "customer_type", series: ["customers"] },
      note: "Customers who ordered in this period, by how many orders they have placed in total.",
    };
  },

  async customers_returning(tx, p) {
    const rows = await q(
      tx,
      sql`WITH cu AS (SELECT ${custKey("o")} AS k, sum(o.grand_total) AS spent FROM orders o WHERE ${ordersIn(p)} GROUP BY 1),
               life AS (SELECT cu.k, cu.spent, (SELECT count(*) FROM orders pr WHERE pr.tenant_id = ${p.tenantId} AND pr.status <> 'cancelled'
                                        AND ${custKey("pr")} = cu.k AND pr.placed_at < ${hi(p)}) AS n FROM cu)
          SELECT CASE WHEN n >= 5 THEN '5 or more' ELSE n::text END AS lifetime_orders, count(*)::int AS customers, sum(spent)::float8 AS total
          FROM life WHERE n >= 2 GROUP BY 1 ORDER BY 1`,
    );
    return {
      columns: [c("lifetime_orders", "Orders placed in total", "text"), c("customers", "Customers"), c("total", "Sales in this period", "money")],
      rows,
      chart: { type: "bar", x: "lifetime_orders", series: ["customers"] },
      note: "Counts only. Individual customers are listed on the Customers page.",
    };
  },

  async customers_by_location(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT COALESCE(NULLIF(o.shipping_address->>'state', ''), 'Unknown') AS state, count(DISTINCT ${custKey("o")})::int AS customers,
                 count(*)::int AS orders, sum(o.grand_total)::float8 AS total
          FROM orders o WHERE ${ordersIn(p)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200`,
    );
    return { columns: [c("state", "State", "text"), c("customers", "Customers"), c("orders", "Orders"), c("total", "Sales", "money")], rows, chart: { type: "bar", x: "state", series: ["customers"] } };
  },

  async sessions_over_time(tx, p) {
    const rows = await overTime(tx, p, trafficInner(p), ["sessions", "pageviews"]);
    return { columns: [c("bucket", "Date", "date"), c("sessions", "Sessions"), c("pageviews", "Page views")], rows, chart: { type: "line", x: "bucket", series: ["sessions"] }, note: TRAFFIC_NOTE };
  },

  async sessions_by_referrer(tx, p) {
    const built = await byDimension(tx, p, "referrer", "Referrer");
    return {
      ...built,
      columns: [c("key", "Referrer", "text"), c("type", "Type", "text"), ...built.columns.slice(1)],
      rows: built.rows.map((r) => ({ ...r, type: referrerType(String(r.key)) })),
    };
  },
  sessions_by_source: (tx, p) => byDimension(tx, p, "source", "Campaign source"),
  sessions_by_location: (tx, p) => byDimension(tx, p, "country", "Country"),
  sessions_by_device: (tx, p) => byDimension(tx, p, "device", "Device"),
  sessions_by_landing: (tx, p) => byDimension(tx, p, "landing", "Landing page"),

  async conversion_over_time(tx, p) {
    const traffic = await overTime(tx, p, trafficInner(p), ["sessions", "carts", "checkouts"]);
    const orders = await overTime(tx, p, sql`SELECT ${bucketOf(sql`o.placed_at`, p)} AS bucket, count(*) AS orders FROM orders o WHERE ${ordersAnyCurrency(p)} AND o.source = 'web' GROUP BY 1`, ["orders"]);
    const rows = traffic.map((t, i) => {
      const o = orders[i]?.orders ?? 0;
      return { bucket: t.bucket, sessions: t.sessions, carts: t.carts, checkouts: t.checkouts, orders: o, rate: pct(o, t.sessions), checkout_rate: pct(o, t.checkouts) };
    });
    return {
      columns: [c("bucket", "Date", "date"), c("sessions", "Sessions"), c("carts", "Added to cart"), c("checkouts", "Reached checkout"), c("orders", "Online orders"), c("rate", "Conversion rate", "percent"), c("checkout_rate", "Checkout conversion", "percent")],
      rows,
      chart: { type: "line", x: "bucket", series: ["rate"] },
      note: TRAFFIC_NOTE,
    };
  },

  async conversion_funnel(tx, p) {
    const [t] = await q(
      tx,
      sql`SELECT COALESCE(sum(sessions), 0)::int AS sessions, COALESCE(sum(product_views), 0)::int AS product_views,
                 COALESCE(sum(carts), 0)::int AS carts, COALESCE(sum(checkouts), 0)::int AS checkouts
          FROM analytics_traffic_daily WHERE ${trafficIn(p, "total")}`,
    );
    const [o] = await q(tx, sql`SELECT count(*)::int AS orders FROM orders o WHERE ${ordersAnyCurrency(p)} AND o.source = 'web'`);
    const sessions = num(t?.sessions);
    const steps: Array<[string, number]> = [
      ["Sessions", sessions],
      ["Viewed a product", num(t?.product_views)],
      ["Added to cart", num(t?.carts)],
      ["Reached checkout", num(t?.checkouts)],
      ["Placed an order", num(o?.orders)],
    ];
    return {
      columns: [c("step", "Step", "text"), c("sessions", "Sessions"), c("rate", "Of all sessions", "percent")],
      rows: steps.map(([step, n]) => ({ step, sessions: n, rate: pct(n, sessions) })),
      chart: { type: "bar", x: "step", series: ["sessions"] },
      note: TRAFFIC_NOTE,
    };
  },

  async bounce_rate_over_time(tx, p) {
    const raw = await overTime(tx, p, trafficInner(p), ["sessions", "bounces"]);
    const rows = raw.map((r) => ({ ...r, rate: pct(r.bounces ?? 0, r.sessions ?? 0) }));
    return {
      columns: [c("bucket", "Date", "date"), c("sessions", "Sessions"), c("bounces", "Single-page sessions"), c("rate", "Bounce rate", "percent")],
      rows,
      chart: { type: "line", x: "bucket", series: ["rate"] },
      note: TRAFFIC_NOTE,
    };
  },

  async searches_by_query(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT normalized_query AS query, sum(count)::int AS searches, min(results_count)::int AS results
          FROM search_queries WHERE tenant_id = ${p.tenantId} AND day >= ${p.from}::date AND day <= ${p.to}::date
          GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200`,
    );
    return { columns: [c("query", "Search", "text"), c("searches", "Searches"), c("results", "Products found")], rows, chart: { type: "bar", x: "query", series: ["searches"] } };
  },

  async searches_no_results(tx, p) {
    const rows = await q(
      tx,
      sql`SELECT normalized_query AS query, sum(count)::int AS searches
          FROM search_queries WHERE tenant_id = ${p.tenantId} AND results_count = 0 AND day >= ${p.from}::date AND day <= ${p.to}::date
          GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200`,
    );
    return { columns: [c("query", "Search", "text"), c("searches", "Searches")], rows, chart: { type: "bar", x: "query", series: ["searches"] } };
  },

  async inventory_sold_by_product(tx, p) {
    const raw = await q(
      tx,
      sql`SELECT oi.product_title AS product, COALESCE(oi.variant_title, '') AS variant, COALESCE(oi.sku, '') AS sku, sum(oi.quantity)::int AS sold
          FROM order_items oi JOIN orders o ON o.tenant_id = oi.tenant_id AND o.id = oi.order_id
          WHERE ${ordersAnyCurrency(p)} GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1, 2 LIMIT 200`,
    );
    const rows = raw.map((r) => ({ ...r, per_day: Math.round((num(r.sold) / p.days) * 100) / 100 }));
    return {
      columns: [c("product", "Product", "text"), c("variant", "Variant", "text"), c("sku", "SKU", "text"), c("sold", "Units sold"), c("per_day", "Sold per day")],
      rows,
      chart: { type: "bar", x: "product", series: ["sold"] },
    };
  },

  async inventory_days_remaining(tx, p) {
    const rows = await q(
      tx,
      sql`WITH sold AS (
            SELECT oi.variant_id, sum(oi.quantity) AS qty
            FROM order_items oi JOIN orders o ON o.tenant_id = oi.tenant_id AND o.id = oi.order_id
            WHERE ${ordersAnyCurrency(p)} GROUP BY 1
          ), stock AS (
            SELECT variant_id, sum(on_hand - reserved) AS available FROM inventory_levels WHERE tenant_id = ${p.tenantId} GROUP BY 1
          )
          SELECT pd.title AS product, v.title AS variant, v.sku AS sku, stock.available::int AS available, COALESCE(sold.qty, 0)::int AS sold,
                 CASE WHEN COALESCE(sold.qty, 0) > 0 THEN round(stock.available / (sold.qty::numeric / ${p.days}))::int END AS days_remaining
          FROM stock
          JOIN variants v ON v.tenant_id = ${p.tenantId} AND v.id = stock.variant_id
          JOIN products pd ON pd.tenant_id = v.tenant_id AND pd.id = v.product_id
          LEFT JOIN sold ON sold.variant_id = stock.variant_id
          WHERE v.track_inventory
          ORDER BY 6 ASC NULLS LAST, 1, 2 LIMIT 200`,
    );
    return {
      columns: [c("product", "Product", "text"), c("variant", "Variant", "text"), c("sku", "SKU", "text"), c("available", "Available"), c("sold", "Sold in period"), c("days_remaining", "Days of stock left")],
      rows,
      chart: null,
      note: "Stock available now divided by the daily sales rate of the selected period. Empty means nothing sold in the period.",
    };
  },
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function autoGran(days: number): Gran {
  if (days <= 31) return "day";
  if (days <= 190) return "week";
  return "month";
}

async function resolveParams(tx: Db, tenantId: string, input: AnalyticsRangeInput, from = input.from, to = input.to): Promise<P> {
  const days = daysBetween(from, to);
  if (!Number.isFinite(days) || days < 1) throw new Error("Bad Request: the end date must be on or after the start date.");
  if (days > MAX_RANGE_DAYS) throw new Error(`Bad Request: choose a range of ${MAX_RANGE_DAYS} days or less.`);
  const [s] = await q(tx, sql`SELECT timezone, currency FROM store_settings WHERE tenant_id = ${tenantId} LIMIT 1`);
  return {
    tenantId,
    tz: String(s?.timezone ?? "Asia/Kolkata"),
    from,
    to,
    currency: (input.currency ?? String(s?.currency ?? "INR")).toUpperCase(),
    // The comparison range uses the main range's bucket size so the two lines can be drawn together.
    gran: input.granularity ?? autoGran(daysBetween(input.from, input.to)),
    days,
  };
}

interface Totals {
  orders: number; gross: number; discounts: number; shipping: number; taxes: number; grand: number; returns: number;
  fulfilled: number; customers: number; returning: number; sessions: number; webOrders: number;
}

async function totals(tx: Db, p: P): Promise<Totals> {
  const [o] = await q(tx, sql`SELECT count(*) AS orders, COALESCE(sum(o.subtotal), 0) AS gross, COALESCE(sum(o.discount_total), 0) AS discounts,
                     COALESCE(sum(o.shipping_total + o.cod_fee), 0) AS shipping, COALESCE(sum(o.tax_total), 0) AS taxes, COALESCE(sum(o.grand_total), 0) AS grand
              FROM orders o WHERE ${ordersIn(p)}`);
  const [r] = await q(tx, sql`SELECT COALESCE(sum(r.amount), 0) AS returns ${refundsFrom(p)}`);
  const [f] = await q(tx, sql`SELECT count(DISTINCT f.order_id) AS fulfilled FROM fulfillments f JOIN orders o ON o.tenant_id = f.tenant_id AND o.id = f.order_id
              WHERE f.tenant_id = ${p.tenantId} AND o.status <> 'cancelled' AND o.currency = ${p.currency} AND ${within(sql`f.shipped_at`, p)}`);
  const [cu] = await q(tx, sql`WITH cu AS (SELECT DISTINCT ${custKey("o")} AS k FROM orders o WHERE ${ordersIn(p)})
              SELECT count(*) AS customers, count(*) FILTER (WHERE ${priorOrder(p, lo(p), sql`cu.k`)}) AS returning FROM cu`);
  const [t] = await q(tx, sql`SELECT COALESCE(sum(sessions), 0) AS sessions FROM analytics_traffic_daily WHERE ${trafficIn(p, "total")}`);
  const [w] = await q(tx, sql`SELECT count(*) AS orders FROM orders o WHERE ${ordersAnyCurrency(p)} AND o.source = 'web'`);
  return {
    orders: num(o?.orders), gross: num(o?.gross), discounts: num(o?.discounts), shipping: num(o?.shipping), taxes: num(o?.taxes), grand: num(o?.grand),
    returns: num(r?.returns), fulfilled: num(f?.fulfilled), customers: num(cu?.customers), returning: num(cu?.returning),
    sessions: num(t?.sessions), webOrders: num(w?.orders),
  };
}

async function series(tx: Db, p: P): Promise<AnalyticsOverview["series"]> {
  const sales = await overTime(tx, p, salesInner(p), ["orders", "grand"]);
  const traffic = await overTime(tx, p, trafficInner(p), ["sessions"]);
  return sales.map((s, i) => ({ bucket: s.bucket, total: s.grand ?? 0, orders: s.orders ?? 0, sessions: traffic[i]?.sessions ?? 0 }));
}

/** The analytics dashboard: KPI tiles, sales over time, the sales breakdown, and the top channels, products and markets. */
export async function getAnalyticsOverview(rt: Runtime, ctx: TenantContext, input: AnalyticsRangeInput): Promise<AnalyticsOverview> {
  assertPermission(ctx, "analytics.read");
  if ((input.compareFrom === undefined) !== (input.compareTo === undefined)) throw new Error("Bad Request: give both comparison dates or neither.");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const p = await resolveParams(tx, ctx.tenantId, input);
    const pp = input.compareFrom && input.compareTo ? await resolveParams(tx, ctx.tenantId, input, input.compareFrom, input.compareTo) : null;
    // Queries run one after another: a transaction is a single connection.
    const cur = await totals(tx, p);
    const prev = pp ? await totals(tx, pp) : null;
    const curSeries = await series(tx, p);
    const prevSeries = pp ? await series(tx, pp) : null;
    const currencies = (await q(tx, sql`SELECT DISTINCT o.currency AS currency FROM orders o WHERE ${ordersAnyCurrency(p)} ORDER BY 1`)).map((r) => String(r.currency));
    const channel = await BUILDERS.sales_by_channel(tx, p);
    const product = await BUILDERS.sales_by_product(tx, p);
    const market = await BUILDERS.sales_by_market(tx, p);

    const m = (pick: (t: Totals) => number) => ({ value: pick(cur), previous: prev ? pick(prev) : null });
    const net = (t: Totals) => t.gross - t.discounts - t.returns;
    const total = (t: Totals) => t.grand - t.returns;
    return {
      currency: p.currency,
      currencies: currencies.includes(p.currency) ? currencies : [p.currency, ...currencies],
      timezone: p.tz,
      granularity: p.gran,
      kpis: {
        totalSales: m(total),
        grossSales: m((t) => t.gross),
        netSales: m(net),
        orders: m((t) => t.orders),
        ordersFulfilled: m((t) => t.fulfilled),
        averageOrderValue: m((t) => (t.orders > 0 ? Math.round(t.grand / t.orders) : 0)),
        returningCustomerRate: m((t) => pct(t.returning, t.customers)),
        sessions: m((t) => t.sessions),
        conversionRate: m((t) => pct(t.webOrders, t.sessions)),
      },
      breakdown: {
        grossSales: m((t) => t.gross),
        discounts: m((t) => t.discounts),
        returns: m((t) => t.returns),
        netSales: m(net),
        shipping: m((t) => t.shipping),
        taxes: m((t) => t.taxes),
        totalSales: m(total),
      },
      series: curSeries,
      previousSeries: prevSeries ? curSeries.map((_, i) => prevSeries[i] ?? { bucket: "", total: 0, orders: 0, sessions: 0 }) : null,
      byChannel: channel.rows.map((r) => ({ channel: String(r.channel), total: num(r.total), orders: num(r.orders) })),
      byProduct: product.rows.slice(0, 8).map((r) => ({ title: String(r.product), total: num(r.total), quantity: num(r.quantity) })),
      byMarket: market.rows.map((r) => ({ market: String(r.market), currency: String(r.currency), total: num(r.total), orders: num(r.orders) })),
    };
  });
}

/** One report from the catalogue, as a generic table plus a chart hint. */
export async function getAnalyticsReport(rt: Runtime, ctx: TenantContext, input: AnalyticsRangeInput & { id: AnalyticsReportId }): Promise<AnalyticsReport> {
  assertPermission(ctx, "analytics.read");
  const meta = ANALYTICS_REPORTS.find((r) => r.id === input.id);
  const build = BUILDERS[input.id];
  if (!meta || !build) throw new Error("Not Found: unknown report.");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const p = await resolveParams(tx, ctx.tenantId, input);
    const built = await build(tx, p);
    return {
      id: meta.id,
      title: meta.title,
      category: meta.category,
      currency: p.currency,
      timezone: p.tz,
      columns: built.columns,
      rows: built.rows.map((r) => {
        const out: Row = {};
        for (const col of built.columns) {
          const v = r[col.key];
          out[col.key] = v === null || v === undefined ? null : col.kind === "text" || col.kind === "date" ? String(v) : Number(v);
        }
        return out;
      }),
      chart: built.chart,
      note: built.note ?? null,
    };
  });
}
