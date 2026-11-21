"use client";

/**
 * Chart kit for dashboards (docs/ANALYTICS-PLAN.md). A separate entry point (`@bs/ui/charts`) so Recharts is only loaded by
 * screens that draw charts; import it from a lazily loaded component. Colours come from the `--chart-1..5` tokens.
 */
import { Bar, BarChart, CartesianGrid, Cell, Label, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./components/ui/chart.tsx";

export type ValueFormat = (value: number) => string;
const plain: ValueFormat = (v) => v.toLocaleString();
const PALETTE = ["var(--chart-2)", "var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const colourAt = (i: number): string => PALETTE[i % PALETTE.length] ?? "var(--chart-2)";

function tooltipRow(format: ValueFormat, labels: Record<string, string>) {
  return (value: unknown, name: unknown) => (
    <div className="flex w-full items-center justify-between gap-4">
      <span className="text-muted-foreground">{labels[String(name)] ?? String(name)}</span>
      <span className="font-medium tabular-nums text-foreground">{format(Number(value))}</span>
    </div>
  );
}

export interface LinesChartProps {
  /** One object per point; `x` names the label key, each series names a numeric key. */
  data: ReadonlyArray<Record<string, string | number | null>>;
  x: string;
  /** `dashed` draws the comparison period. */
  series: ReadonlyArray<{ key: string; label: string; dashed?: boolean }>;
  format?: ValueFormat;
  /** Short axis label for large numbers, e.g. compact money. Defaults to `format`. */
  axisFormat?: ValueFormat;
  xFormat?: (label: string) => string;
  className?: string;
}

/** Line chart over time, with an optional dashed comparison series. */
export function LinesChart({ data, x, series, format = plain, axisFormat, xFormat, className = "h-64 w-full" }: LinesChartProps) {
  const config: ChartConfig = {};
  const labels: Record<string, string> = {};
  let colour = 0;
  series.forEach((s) => {
    // A dashed comparison line shares the colour of the line before it, drawn lighter.
    const color = s.dashed && colour > 0 ? colourAt(colour - 1) : colourAt(colour++);
    config[s.key] = { label: s.label, color };
    labels[s.key] = s.label;
  });
  return (
    <ChartContainer config={config} className={`aspect-auto ${className}`}>
      <LineChart data={data as Array<Record<string, string | number | null>>} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={x} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(v: string) => (xFormat ? xFormat(String(v)) : String(v))} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (axisFormat ?? format)(Number(v))} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => (xFormat ? xFormat(String(l)) : String(l))} formatter={tooltipRow(format, labels)} />} />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            {...(s.dashed ? { strokeDasharray: "4 4", strokeOpacity: 0.55 } : {})}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export interface BarsChartProps {
  data: ReadonlyArray<{ label: string; value: number }>;
  seriesLabel: string;
  format?: ValueFormat;
  axisFormat?: ValueFormat;
  className?: string;
}

/** Horizontal bars for a ranked list (top products, referrers, locations). Shows the rows it is given; cap them in the caller. */
export function BarsChart({ data, seriesLabel, format = plain, axisFormat, className }: BarsChartProps) {
  const config: ChartConfig = { value: { label: seriesLabel, color: colourAt(0) } };
  const height = Math.max(120, data.length * 34 + 24);
  return (
    <ChartContainer config={config} className={`aspect-auto w-full ${className ?? ""}`} style={{ height }}>
      <BarChart data={data as Array<{ label: string; value: number }>} layout="vertical" margin={{ left: 4, right: 16 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => (axisFormat ?? format)(Number(v))} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={132} tickFormatter={(v: string) => (String(v).length > 20 ? `${String(v).slice(0, 19)}…` : String(v))} />
        <ChartTooltip content={<ChartTooltipContent formatter={tooltipRow(format, { value: seriesLabel })} />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export interface DonutChartProps {
  data: ReadonlyArray<{ label: string; value: number }>;
  format?: ValueFormat;
  /** Text in the middle, e.g. the total. */
  center?: string;
  className?: string;
}

/** Donut for a small number of parts (sales by channel). */
export function DonutChart({ data, format = plain, center, className = "h-56 w-full" }: DonutChartProps) {
  const config: ChartConfig = {};
  const labels: Record<string, string> = {};
  data.forEach((d, i) => {
    config[`p${i}`] = { label: d.label, color: colourAt(i) };
    labels[d.label] = d.label;
  });
  return (
    <ChartContainer config={config} className={`aspect-auto ${className}`}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel formatter={tooltipRow(format, labels)} />} />
        <Pie data={data as Array<{ label: string; value: number }>} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="90%" strokeWidth={2} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={colourAt(i)} />
          ))}
          {center ? (
            <Label
              position="center"
              content={({ viewBox }) => {
                const vb = viewBox as { cx?: number; cy?: number } | undefined;
                return (
                  <text x={vb?.cx} y={vb?.cy} textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-base font-semibold">
                    {center}
                  </text>
                );
              }}
            />
          ) : null}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

/** A tiny trend line for a KPI tile. Plain SVG, no chart library. */
export function Sparkline({ values, previous, className = "h-8 w-24" }: { values: ReadonlyArray<number>; previous?: ReadonlyArray<number> | null; className?: string }) {
  const all = [...values, ...(previous ?? [])];
  const max = Math.max(1, ...all);
  const path = (v: ReadonlyArray<number>) =>
    v.length < 2 ? "" : v.map((y, i) => `${i === 0 ? "M" : "L"}${((i / (v.length - 1)) * 100).toFixed(1)},${(30 - (y / max) * 28).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={className} aria-hidden>
      {previous ? <path d={path(previous)} fill="none" stroke="var(--chart-2)" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
      <path d={path(values)} fill="none" stroke="var(--chart-2)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
