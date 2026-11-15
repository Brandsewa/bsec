import { ANALYTICS_PRESETS, COMPARISON_LABELS, DateRangePicker, SimpleSelect, type ComparisonMode } from "@bs/ui";
import { rangeLabel, type AnalyticsSearch, type ResolvedRange } from "../../lib/analytics-range.ts";

const COMPARE_OPTIONS = (Object.keys(COMPARISON_LABELS) as ComparisonMode[]).map((value) => ({ value, label: COMPARISON_LABELS[value] }));

/** Date range, comparison period and (for stores selling in several currencies) currency. Every analytics screen uses this. */
export function RangeControls({
  range,
  currencies,
  currency,
  onChange,
  showCompare = true,
}: {
  range: ResolvedRange;
  /** Currencies with orders in the range; the selector only shows when there is more than one. */
  currencies?: readonly string[] | undefined;
  currency?: string | undefined;
  onChange: (patch: AnalyticsSearch) => void;
  showCompare?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          from={range.from}
          to={range.to}
          presets={ANALYTICS_PRESETS}
          emptyLabel="Last 30 days"
          onChange={(from, to) => onChange({ from, to })}
        />
        {showCompare ? (
          <SimpleSelect
            ariaLabel="Compare with"
            className="w-52"
            value={range.compare}
            options={COMPARE_OPTIONS}
            onChange={(v) => onChange({ compare: v as ComparisonMode })}
          />
        ) : null}
        {currencies && currencies.length > 1 && currency ? (
          <SimpleSelect
            ariaLabel="Currency"
            className="w-28"
            value={currency}
            options={currencies.map((c) => ({ value: c, label: c }))}
            onChange={(v) => onChange({ currency: v })}
          />
        ) : null}
      </div>
      {showCompare && range.compareFrom && range.compareTo ? (
        <p className="text-xs text-muted-foreground">
          {rangeLabel(range.from, range.to)}, compared with {rangeLabel(range.compareFrom, range.compareTo)}
        </p>
      ) : null}
    </div>
  );
}
