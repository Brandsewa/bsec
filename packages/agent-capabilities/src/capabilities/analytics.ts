import { z } from "zod";
import { getAnalyticsReport } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability } from "../types.ts";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const MAX_DAYS = 92;
const MAX_ROWS = 40;

const REPORTS = ["sales_over_time", "sales_by_product", "orders_over_time", "aov_over_time", "sales_by_channel", "sales_new_vs_returning"] as const;

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export const getSalesSummaryCap = defineCapability({
  name: "get_sales_summary",
  title: "Sales summary",
  description:
    "Sales for a date range (at most 92 days). report: sales_over_time (gross, discounts, returns, net and total sales by day, week or month), sales_by_product, orders_over_time, aov_over_time (average order value), sales_by_channel, sales_new_vs_returning. Money is in minor units of the store currency (paise). Days are store-local.",
  resource: "analytics",
  action: "read",
  kind: "report",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    report: z.enum(REPORTS).default("sales_over_time"),
    from: Day,
    to: Day,
    granularity: z.enum(["day", "week", "month"]).optional(),
  }),
  async handler({ rt, session }, input) {
    const span = days(input.from, input.to);
    if (!Number.isFinite(span) || span < 1) throw new CapabilityError("invalid_input", "The end date must be on or after the start date.");
    if (span > MAX_DAYS) throw new CapabilityError("invalid_input", `Ask for at most ${MAX_DAYS} days at a time.`);
    const r = await getAnalyticsReport(rt, session.ctx, { id: input.report, from: input.from, to: input.to, ...(input.granularity ? { granularity: input.granularity } : {}) });
    return {
      report: r.title,
      currency: r.currency,
      timezone: r.timezone,
      columns: r.columns.map((c) => ({ key: c.key, label: c.label, kind: c.kind })),
      rows: r.rows.slice(0, MAX_ROWS),
      rowsOmitted: Math.max(0, r.rows.length - MAX_ROWS),
      note: r.note,
    };
  },
});

export const analyticsCapabilities = [getSalesSummaryCap];
