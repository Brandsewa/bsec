import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Merchant analytics contracts (docs/ANALYTICS-PLAN.md, ADR-047). Mounted under admin.analytics.*
 * Money is always in minor units (paise) of the report's currency; amounts are never summed across currencies.
 */

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-MM-dd");

export const ANALYTICS_CATEGORIES = ["Sales", "Orders", "Customers", "Acquisition", "Behavior", "Inventory"] as const;
export type AnalyticsCategory = (typeof ANALYTICS_CATEGORIES)[number];

/** The report catalogue. Adding a report = one entry here plus one builder in packages/domain/src/analytics/reports.ts. */
export const ANALYTICS_REPORTS = [
  { id: "sales_over_time", category: "Sales", title: "Sales over time", description: "Gross sales, discounts, returns, net sales, shipping, taxes and total sales." },
  { id: "sales_by_product", category: "Sales", title: "Total sales by product", description: "Units and sales for each product." },
  { id: "aov_over_time", category: "Sales", title: "Average order value over time", description: "Total sales divided by orders." },
  { id: "sales_by_discount", category: "Sales", title: "Sales by discount code", description: "Orders, discount given and sales for each discount." },
  { id: "sales_by_channel", category: "Sales", title: "Sales by sales channel", description: "Where orders came from: online store, admin, quotes." },
  { id: "sales_by_market", category: "Sales", title: "Sales by market", description: "Orders and sales for each market, each in its own currency." },
  { id: "sales_by_referrer", category: "Sales", title: "Sales by referrer", description: "Orders and sales by the site or app the visitor came from." },
  { id: "sales_by_campaign", category: "Sales", title: "Sales by campaign", description: "Orders and sales by utm source, medium and campaign." },
  { id: "items_sold_by_referrer", category: "Sales", title: "Items sold by referrer", description: "Units and sales of each product, by where the visitor came from." },
  { id: "sales_new_vs_returning", category: "Sales", title: "New vs returning customer sales", description: "Sales from first-time buyers and repeat buyers." },
  { id: "sales_reversals_over_time", category: "Sales", title: "Sales reversals over time", description: "Refunds issued." },
  { id: "orders_over_time", category: "Orders", title: "Orders over time", description: "Orders placed and items ordered." },
  { id: "orders_fulfilled_over_time", category: "Orders", title: "Orders fulfilled and time to fulfil", description: "Orders shipped and the average hours from order to shipping." },
  { id: "reversed_quantity_over_time", category: "Orders", title: "Returned quantity over time", description: "Items returned and the return rate." },
  { id: "items_reversed_by_product", category: "Orders", title: "Items returned by product", description: "Ordered and returned quantity for each product." },
  { id: "orders_by_location", category: "Orders", title: "Order hotspots by shipping location", description: "Orders and sales by state and city." },
  { id: "customers_new_vs_returning", category: "Customers", title: "New vs returning customers", description: "New customers, returning customers and the returning customer rate over time." },
  { id: "customers_one_time_vs_repeat", category: "Customers", title: "One-time and repeat customers", description: "Customers who bought once and those who bought again." },
  { id: "customers_returning", category: "Customers", title: "Returning customers", description: "Customers who ordered in this period and had ordered before." },
  { id: "customers_by_location", category: "Customers", title: "Customers by location", description: "Buying customers by state." },
  { id: "sessions_over_time", category: "Acquisition", title: "Sessions over time", description: "Measured visits and page views." },
  { id: "visitors_right_now", category: "Acquisition", title: "Visitors right now", description: "Who is on the store in the last 5 minutes, by page. Refreshes by itself.", live: true },
  { id: "sessions_by_referrer", category: "Acquisition", title: "Sessions by referrer", description: "Which sites sent visits, with social and search grouped." },
  { id: "sessions_by_source", category: "Acquisition", title: "Sessions by campaign source", description: "Visits by utm_source." },
  { id: "sessions_by_location", category: "Acquisition", title: "Sessions by location", description: "Visits by country." },
  { id: "conversion_over_time", category: "Behavior", title: "Conversion rate over time", description: "Visits, carts, checkouts, orders and the conversion rate." },
  { id: "conversion_funnel", category: "Behavior", title: "Conversion rate breakdown", description: "How many visits reach each step: product, cart, checkout, order." },
  { id: "bounce_rate_over_time", category: "Behavior", title: "Bounce rate over time", description: "Visits that viewed a single page." },
  { id: "sessions_by_device", category: "Behavior", title: "Sessions by device type", description: "Desktop, mobile and tablet visits." },
  { id: "sessions_by_landing", category: "Behavior", title: "Sessions by landing page", description: "The first page of each visit." },
  { id: "searches_by_query", category: "Behavior", title: "Searches by search query", description: "What shoppers search for in the store." },
  { id: "searches_no_results", category: "Behavior", title: "Searches with no results", description: "Searches that found nothing." },
  { id: "inventory_sold_by_product", category: "Inventory", title: "Inventory sold by product", description: "Units sold and the daily average for each variant." },
  { id: "inventory_days_remaining", category: "Inventory", title: "Products by days of inventory remaining", description: "Stock on hand divided by the recent daily sales rate." },
] as const satisfies ReadonlyArray<{ id: string; category: AnalyticsCategory; title: string; description: string; live?: true }>;

export type AnalyticsReportId = (typeof ANALYTICS_REPORTS)[number]["id"];
const REPORT_IDS = ANALYTICS_REPORTS.map((r) => r.id) as [AnalyticsReportId, ...AnalyticsReportId[]];

export const AnalyticsRangeInput = z.object({
  from: Day,
  to: Day,
  /** Optional comparison range (previous period or same period last year), resolved by the client. */
  compareFrom: Day.optional(),
  compareTo: Day.optional(),
  /** ISO currency. Default: the store currency. */
  currency: z.string().length(3).optional(),
  granularity: z.enum(["day", "week", "month"]).optional(),
});
export type AnalyticsRangeInput = z.infer<typeof AnalyticsRangeInput>;

const Metric = z.object({ value: z.number(), previous: z.number().nullable() });
const SeriesPoint = z.object({ bucket: z.string(), total: z.number(), orders: z.number(), sessions: z.number() });

export const AnalyticsOverview = z.object({
  currency: z.string(),
  /** Currencies that have orders in the range; more than one means the store sells in several markets. */
  currencies: z.array(z.string()),
  timezone: z.string(),
  granularity: z.enum(["day", "week", "month"]),
  kpis: z.object({
    totalSales: Metric,
    grossSales: Metric,
    netSales: Metric,
    orders: Metric,
    ordersFulfilled: Metric,
    averageOrderValue: Metric,
    /** Percent, 0 to 100. */
    returningCustomerRate: Metric,
    sessions: Metric,
    /** Percent, 0 to 100: orders divided by measured visits. */
    conversionRate: Metric,
  }),
  breakdown: z.object({
    grossSales: Metric,
    discounts: Metric,
    returns: Metric,
    netSales: Metric,
    shipping: Metric,
    taxes: Metric,
    totalSales: Metric,
  }),
  series: z.array(SeriesPoint),
  /** Same length as `series` when a comparison range was asked for (aligned by position), otherwise null. */
  previousSeries: z.array(SeriesPoint).nullable(),
  byChannel: z.array(z.object({ channel: z.string(), total: z.number(), orders: z.number() })),
  byProduct: z.array(z.object({ title: z.string(), total: z.number(), quantity: z.number() })),
  byMarket: z.array(z.object({ market: z.string(), currency: z.string(), total: z.number(), orders: z.number() })),
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverview>;

export const AnalyticsColumn = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["text", "date", "number", "money", "percent", "hours"]),
});
export type AnalyticsColumn = z.infer<typeof AnalyticsColumn>;

export const AnalyticsReport = z.object({
  id: z.enum(REPORT_IDS),
  title: z.string(),
  category: z.enum(ANALYTICS_CATEGORIES),
  currency: z.string(),
  timezone: z.string(),
  columns: z.array(AnalyticsColumn),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  /** How to draw it: x is a column key, series are column keys. null = table only. */
  chart: z.object({ type: z.enum(["line", "bar"]), x: z.string(), series: z.array(z.string()) }).nullable(),
  /** A plain-language caveat shown under the title, when the numbers need one. */
  note: z.string().nullable(),
});
export type AnalyticsReport = z.infer<typeof AnalyticsReport>;

export const analyticsContract = {
  overview: oc.route({ method: "GET", path: "/admin/analytics/overview" }).input(AnalyticsRangeInput).output(AnalyticsOverview),
  report: oc
    .route({ method: "GET", path: "/admin/analytics/report" })
    .input(AnalyticsRangeInput.extend({ id: z.enum(REPORT_IDS) }))
    .output(AnalyticsReport),
};
