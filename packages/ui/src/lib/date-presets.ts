import {
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subYears,
} from "date-fns";

/** A calendar range with both ends inclusive. Dates are local-calendar days, never instants. */
export interface DayRange {
  from: Date;
  to: Date;
}

export interface DatePreset {
  id: string;
  label: string;
  /** `today` is passed in (the store's today, not the browser's) so a late-evening sale lands on the right day. */
  range: (today: Date) => DayRange;
}

const day = (from: Date, to: Date): DayRange => ({ from, to });

/** Presets for analytics and reports: the Shopify set minus the merchant-event ones (Black Friday etc.), which can be added later. */
export const ANALYTICS_PRESETS: ReadonlyArray<DatePreset> = [
  { id: "today", label: "Today", range: (t) => day(t, t) },
  { id: "yesterday", label: "Yesterday", range: (t) => day(subDays(t, 1), subDays(t, 1)) },
  { id: "last-7", label: "Last 7 days", range: (t) => day(subDays(t, 6), t) },
  { id: "last-30", label: "Last 30 days", range: (t) => day(subDays(t, 29), t) },
  { id: "last-90", label: "Last 90 days", range: (t) => day(subDays(t, 89), t) },
  { id: "this-month", label: "This month", range: (t) => day(startOfMonth(t), t) },
  { id: "last-month", label: "Last month", range: (t) => day(startOfMonth(subMonths(t, 1)), endOfMonth(subMonths(t, 1))) },
  { id: "this-quarter", label: "This quarter", range: (t) => day(startOfQuarter(t), t) },
  { id: "last-quarter", label: "Last quarter", range: (t) => day(startOfQuarter(subQuarters(t, 1)), endOfQuarter(subQuarters(t, 1))) },
  { id: "year-to-date", label: "Year to date", range: (t) => day(startOfYear(t), t) },
  { id: "last-year", label: "Last year", range: (t) => day(startOfYear(subYears(t, 1)), endOfYear(subYears(t, 1))) },
];

export type ComparisonMode = "none" | "previous-period" | "previous-year";

export const COMPARISON_LABELS: Record<ComparisonMode, string> = {
  none: "No comparison",
  "previous-period": "Previous period",
  "previous-year": "Same period last year",
};

/**
 * The range to draw as the dashed comparison series.
 * - previous-period: the same number of days immediately before `range`.
 * - previous-year: the same dates one year earlier (a leap day is clamped by date-fns).
 * Returns null for "none".
 */
export function comparisonRange(range: DayRange, mode: ComparisonMode): DayRange | null {
  if (mode === "none") return null;
  if (mode === "previous-year") return day(subYears(range.from, 1), subYears(range.to, 1));
  const days = differenceInCalendarDays(range.to, range.from) + 1;
  return day(subDays(range.from, days), subDays(range.from, 1));
}

export type Granularity = "day" | "week" | "month";

/** Bucket size that keeps a chart readable: up to 31 days by day, up to ~6 months by week, longer by month. */
export function autoGranularity(range: DayRange): Granularity {
  const days = differenceInCalendarDays(range.to, range.from) + 1;
  if (days <= 31) return "day";
  if (days <= 190) return "week";
  return "month";
}
