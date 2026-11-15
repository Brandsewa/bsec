import { format, parse, startOfToday, subDays } from "date-fns";
import { comparisonRange, type ComparisonMode } from "@bs/ui";
import { formatMoney, toMajorUnits } from "@bs/contracts/money";
import type { AnalyticsColumn } from "@bs/contracts";

/** URL state shared by the analytics dashboard and every report, so a range survives moving between them. */
export interface AnalyticsSearch {
  from?: string | undefined;
  to?: string | undefined;
  compare?: ComparisonMode | undefined;
  currency?: string | undefined;
}

const ISO = "yyyy-MM-dd";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MODES: readonly ComparisonMode[] = ["none", "previous-period", "previous-year"];

export function validateAnalyticsSearch(raw: Record<string, unknown>): AnalyticsSearch {
  const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : undefined);
  const compare = raw["compare"];
  const currency = raw["currency"];
  return {
    from: day(raw["from"]),
    to: day(raw["to"]),
    compare: typeof compare === "string" && (MODES as readonly string[]).includes(compare) ? (compare as ComparisonMode) : undefined,
    currency: typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : undefined,
  };
}

export interface ResolvedRange {
  from: string;
  to: string;
  compare: ComparisonMode;
  compareFrom?: string;
  compareTo?: string;
  currency?: string;
}

/** Fills the defaults (last 30 days, compared with the previous period) and works out the comparison dates. */
export function resolveRange(search: AnalyticsSearch): ResolvedRange {
  const today = startOfToday();
  const from = search.from ?? format(subDays(today, 29), ISO);
  const to = search.to ?? format(today, ISO);
  const compare = search.compare ?? "previous-period";
  const cmp = comparisonRange({ from: parse(from, ISO, today), to: parse(to, ISO, today) }, compare);
  return {
    from,
    to,
    compare,
    ...(cmp ? { compareFrom: format(cmp.from, ISO), compareTo: format(cmp.to, ISO) } : {}),
    ...(search.currency ? { currency: search.currency } : {}),
  };
}

/** The oRPC input for a resolved range. */
export function rangeInput(r: ResolvedRange) {
  return {
    from: r.from,
    to: r.to,
    ...(r.compareFrom && r.compareTo ? { compareFrom: r.compareFrom, compareTo: r.compareTo } : {}),
    ...(r.currency ? { currency: r.currency } : {}),
  };
}

export function rangeLabel(from: string, to: string): string {
  const f = parse(from, ISO, new Date());
  const t = parse(to, ISO, new Date());
  return `${format(f, "d MMM yyyy")} to ${format(t, "d MMM yyyy")}`;
}

export function bucketLabel(bucket: string, granularity: "day" | "week" | "month" = "day"): string {
  if (!DAY.test(bucket)) return bucket;
  const d = parse(bucket, ISO, new Date());
  return granularity === "month" ? format(d, "MMM yyyy") : format(d, "d MMM");
}

export function compactMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(toMajorUnits(minor, currency));
  } catch {
    return formatMoney(minor, currency);
  }
}

/** Formats one cell of a report by its column kind. */
export function formatCell(value: string | number | null | undefined, kind: AnalyticsColumn["kind"], currency: string): string {
  if (value === null || value === undefined || value === "") return "-";
  switch (kind) {
    case "money":
      return formatMoney(Number(value), currency);
    case "percent":
      return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case "hours":
      return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
    case "number":
      return Number(value).toLocaleString();
    case "date":
      return bucketLabel(String(value));
    default:
      return String(value);
  }
}

/** Percent change against the comparison period; null when there is nothing to compare with. */
export function change(value: number, previous: number | null): { text: string; trend: "up" | "down" | "neutral" } | null {
  if (previous === null) return null;
  if (previous === 0) return value === 0 ? { text: "0%", trend: "neutral" } : { text: "New", trend: "up" };
  const pct = ((value - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(pct);
  return { text: `${Math.abs(rounded)}%`, trend: rounded > 0 ? "up" : rounded < 0 ? "down" : "neutral" };
}
