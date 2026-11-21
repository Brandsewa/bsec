import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronRight, Minus } from "lucide-react";
import { ANALYTICS_CATEGORIES, ANALYTICS_REPORTS, type AnalyticsOverview } from "@bs/contracts";
import { formatMoney } from "@bs/contracts/money";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageContainer, PageHeader, PageSkeleton, Skeleton } from "@bs/ui";
import { RangeControls } from "../../components/analytics/range-controls.tsx";
import { change, rangeInput, resolveRange, validateAnalyticsSearch, type AnalyticsSearch } from "../../lib/analytics-range.ts";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

// Recharts is loaded only when this screen draws (docs/ANALYTICS-PLAN.md).
const charts = () => import("../../components/analytics/overview-charts.tsx");
const KpiSparkline = lazy(() => charts().then((m) => ({ default: m.KpiSparkline })));
const SalesOverTimeChart = lazy(() => charts().then((m) => ({ default: m.SalesOverTimeChart })));
const SessionsOverTimeChart = lazy(() => charts().then((m) => ({ default: m.SessionsOverTimeChart })));
const ChannelDonut = lazy(() => charts().then((m) => ({ default: m.ChannelDonut })));
const ProductBars = lazy(() => charts().then((m) => ({ default: m.ProductBars })));

export const Route = createFileRoute("/_store/analytics")({
  validateSearch: validateAnalyticsSearch,
  pendingComponent: () => <PageSkeleton />,
  component: AnalyticsPage,
});

type Metric = { value: number; previous: number | null };

function Delta({ metric, invert = false }: { metric: Metric; invert?: boolean }) {
  const c = change(metric.value, metric.previous);
  if (!c) return null;
  const Icon = c.trend === "up" ? ArrowUpRight : c.trend === "down" ? ArrowDownRight : Minus;
  // For discounts and returns a rise is not good news, so the colour is flipped.
  const good = invert ? c.trend === "down" : c.trend === "up";
  const tone = c.trend === "neutral" ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
      <Icon className="size-3.5" aria-hidden />
      {c.text}
    </span>
  );
}

function Kpi({ label, value, metric, spark }: { label: string; value: string; metric: Metric; spark?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-card p-4 shadow-xs">
      <div className="min-w-0">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tabular-nums text-foreground">
          {value}
          <Delta metric={metric} />
        </p>
      </div>
      {spark ? <Suspense fallback={<Skeleton className="h-8 w-24" />}>{spark}</Suspense> : null}
    </div>
  );
}

function ChartCard({ title, description, total, metric, children, className }: { title: string; description?: string; total?: string; metric?: Metric; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {total ? (
          <p className="flex items-baseline gap-2 text-xl font-semibold tabular-nums text-foreground">
            {total}
            {metric ? <Delta metric={metric} /> : null}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>{children}</Suspense>
      </CardContent>
    </Card>
  );
}

function Breakdown({ data }: { data: AnalyticsOverview }) {
  const money = (v: number) => formatMoney(v, data.currency);
  const b = data.breakdown;
  const rows: Array<{ label: string; metric: Metric; sign?: "-"; strong?: boolean; invert?: boolean }> = [
    { label: "Gross sales", metric: b.grossSales },
    { label: "Discounts", metric: b.discounts, sign: "-", invert: true },
    { label: "Returns", metric: b.returns, sign: "-", invert: true },
    { label: "Net sales", metric: b.netSales, strong: true },
    { label: "Shipping charges", metric: b.shipping },
    { label: "Taxes", metric: b.taxes },
    { label: "Total sales", metric: b.totalSales, strong: true },
  ];
  return (
    <dl className="divide-y divide-border-soft">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 py-2.5">
          <dt className={r.strong ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground"}>{r.label}</dt>
          <dd className="flex items-center gap-2 text-sm tabular-nums text-foreground">
            <span className={r.strong ? "font-semibold" : undefined}>
              {r.sign && r.metric.value > 0 ? "-" : ""}
              {money(r.metric.value)}
            </span>
            <span className="w-12 text-right">
              <Delta metric={r.metric} invert={r.invert ?? false} />
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AnalyticsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { store } = useRouteContext({ from: "/_store" });
  const allowed = (store?.permissions ?? []).includes("analytics.read");
  const range = resolveRange(search);
  const setSearch = (patch: AnalyticsSearch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const query = useQuery({ ...orpc.admin.analytics.overview.queryOptions({ input: rangeInput(range) }), enabled: allowed, placeholderData: (prev) => prev });
  const data = query.data;

  if (!allowed) {
    return (
      <PageContainer>
        <PageHeader title="Analytics" />
        <EmptyState icon={BarChart3} title="You do not have access to analytics" description="Ask the store owner if you need to see these reports." />
      </PageContainer>
    );
  }

  const money = (v: number) => formatMoney(v, data?.currency ?? "INR");
  const pctText = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  const series = data?.series ?? [];
  const prev = data?.previousSeries ?? null;
  const reportSearch = { from: range.from, to: range.to, ...(range.currency ? { currency: range.currency } : {}) };

  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description={data ? `Days follow the store timezone (${data.timezone}).` : "Sales, orders, customers and store traffic."}
      />
      <RangeControls range={range} currencies={data?.currencies} currency={data?.currency} onChange={setSearch} />

      {query.isError ? (
        <EmptyState
          icon={BarChart3}
          title="Analytics could not be loaded"
          description={errorMessage(query.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <PageSkeleton />
      ) : (
        <div className={`flex flex-col gap-4 ${query.isFetching ? "opacity-70 transition-opacity" : ""}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Total sales" value={money(data.kpis.totalSales.value)} metric={data.kpis.totalSales} spark={<KpiSparkline values={series.map((p) => p.total)} previous={prev?.map((p) => p.total) ?? null} />} />
            <Kpi label="Orders" value={data.kpis.orders.value.toLocaleString()} metric={data.kpis.orders} spark={<KpiSparkline values={series.map((p) => p.orders)} previous={prev?.map((p) => p.orders) ?? null} />} />
            <Kpi label="Sessions" value={data.kpis.sessions.value.toLocaleString()} metric={data.kpis.sessions} spark={<KpiSparkline values={series.map((p) => p.sessions)} previous={prev?.map((p) => p.sessions) ?? null} />} />
            <Kpi label="Conversion rate" value={pctText(data.kpis.conversionRate.value)} metric={data.kpis.conversionRate} />
            <Kpi label="Average order value" value={money(data.kpis.averageOrderValue.value)} metric={data.kpis.averageOrderValue} />
            <Kpi label="Returning customer rate" value={pctText(data.kpis.returningCustomerRate.value)} metric={data.kpis.returningCustomerRate} />
            <Kpi label="Orders fulfilled" value={data.kpis.ordersFulfilled.value.toLocaleString()} metric={data.kpis.ordersFulfilled} />
            <Kpi label="Net sales" value={money(data.kpis.netSales.value)} metric={data.kpis.netSales} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <ChartCard className="xl:col-span-2" title="Total sales over time" total={money(data.kpis.totalSales.value)} metric={data.kpis.totalSales}>
              <SalesOverTimeChart data={data} />
            </ChartCard>
            <Card>
              <CardHeader>
                <CardTitle>Total sales breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <Breakdown data={data} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <ChartCard title="Total sales by sales channel">
              {data.byChannel.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No sales in this period.</p> : <ChannelDonut data={data} />}
              <ul className="mt-2 flex flex-col gap-1">
                {data.byChannel.map((c) => (
                  <li key={c.channel} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-muted-foreground">{c.channel}</span>
                    <span className="tabular-nums text-foreground">{money(c.total)}</span>
                  </li>
                ))}
              </ul>
            </ChartCard>
            <ChartCard title="Sessions over time" description="Measured visits to the storefront." total={data.kpis.sessions.value.toLocaleString()} metric={data.kpis.sessions}>
              <SessionsOverTimeChart data={data} />
            </ChartCard>
            <ChartCard title="Total sales by product">
              {data.byProduct.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No sales in this period.</p> : <ProductBars data={data} />}
            </ChartCard>
          </div>

          {data.byMarket.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Sales by market</CardTitle>
                <CardDescription>Each market is shown in its own currency. Amounts in different currencies are never added together.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border-soft">
                  {data.byMarket.map((m) => (
                    <li key={`${m.market}-${m.currency}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="text-foreground">{m.market}</span>
                      <span className="flex items-center gap-4 tabular-nums">
                        <span className="text-muted-foreground">{m.orders.toLocaleString()} orders</span>
                        <span className="font-medium text-foreground">{formatMoney(m.total, m.currency)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="analytics-reports-heading">
        <h2 id="analytics-reports-heading" className="text-base font-semibold text-foreground">
          Reports
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ANALYTICS_CATEGORIES.map((category) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{category}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col">
                  {ANALYTICS_REPORTS.filter((r) => r.category === category).map((r) => (
                    <li key={r.id}>
                      <Link
                        to="/analytics/reports/$reportId"
                        params={{ reportId: r.id }}
                        search={reportSearch}
                        className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
                      >
                        {r.title}
                        <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
