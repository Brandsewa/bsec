import type { AnalyticsOverview, AnalyticsReport } from "@bs/contracts";
import { formatMoney } from "@bs/contracts/money";
import { BarsChart, DonutChart, LinesChart, Sparkline } from "@bs/ui/charts";
import { bucketLabel, compactMoney, formatCell } from "../../lib/analytics-range.ts";

/**
 * Everything that needs Recharts lives in this file so the analytics routes can load it lazily
 * (docs/ANALYTICS-PLAN.md: other admin pages must not pay for the chart library).
 */

export function KpiSparkline({ values, previous }: { values: number[]; previous: number[] | null }) {
  return <Sparkline values={values} previous={previous} />;
}

export function SalesOverTimeChart({ data }: { data: AnalyticsOverview }) {
  const rows = data.series.map((p, i) => ({ bucket: p.bucket, total: p.total, previous: data.previousSeries?.[i]?.total ?? null }));
  return (
    <LinesChart
      data={rows}
      x="bucket"
      series={[
        { key: "total", label: "This period" },
        ...(data.previousSeries ? [{ key: "previous", label: "Comparison", dashed: true }] : []),
      ]}
      format={(v) => formatMoney(v, data.currency)}
      axisFormat={(v) => compactMoney(v, data.currency)}
      xFormat={(l) => bucketLabel(l, data.granularity)}
    />
  );
}

export function SessionsOverTimeChart({ data }: { data: AnalyticsOverview }) {
  const rows = data.series.map((p, i) => ({ bucket: p.bucket, sessions: p.sessions, previous: data.previousSeries?.[i]?.sessions ?? null }));
  return (
    <LinesChart
      data={rows}
      x="bucket"
      series={[
        { key: "sessions", label: "Sessions" },
        ...(data.previousSeries ? [{ key: "previous", label: "Comparison", dashed: true }] : []),
      ]}
      xFormat={(l) => bucketLabel(l, data.granularity)}
      className="h-56 w-full"
    />
  );
}

export function ChannelDonut({ data }: { data: AnalyticsOverview }) {
  const total = data.byChannel.reduce((s, c) => s + c.total, 0);
  return (
    <DonutChart
      data={data.byChannel.map((c) => ({ label: c.channel, value: c.total }))}
      format={(v) => formatMoney(v, data.currency)}
      center={compactMoney(total, data.currency)}
    />
  );
}

export function ProductBars({ data }: { data: AnalyticsOverview }) {
  return (
    <BarsChart
      data={data.byProduct.map((p) => ({ label: p.title, value: p.total }))}
      seriesLabel="Sales"
      format={(v) => formatMoney(v, data.currency)}
      axisFormat={(v) => compactMoney(v, data.currency)}
    />
  );
}

/** Draws a report's chart from its chart hint. Bars show the top 12 rows; the table below has them all. */
export function ReportChart({ report }: { report: AnalyticsReport }) {
  const chart = report.chart;
  if (!chart || report.rows.length === 0) return null;
  const col = (key: string) => report.columns.find((c) => c.key === key);
  const first = col(chart.series[0] ?? "");
  if (!first) return null;
  const fmt = (v: number) => formatCell(v, first.kind, report.currency);
  const axis = (v: number) => (first.kind === "money" ? compactMoney(v, report.currency) : fmt(v));
  if (chart.type === "line") {
    return (
      <LinesChart
        data={report.rows}
        x={chart.x}
        series={chart.series.map((key) => ({ key, label: col(key)?.label ?? key }))}
        format={fmt}
        axisFormat={axis}
        xFormat={(l) => bucketLabel(l)}
        className="h-72 w-full"
      />
    );
  }
  return (
    <BarsChart
      data={report.rows.slice(0, 12).map((r) => ({ label: String(r[chart.x] ?? ""), value: Number(r[first.key] ?? 0) }))}
      seriesLabel={first.label}
      format={fmt}
      axisFormat={axis}
    />
  );
}
