import { createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BarChart3, Download } from "lucide-react";
import { ANALYTICS_REPORTS, type AnalyticsReport, type AnalyticsReportId } from "@bs/contracts";
import { Button, Card, CardContent, EmptyState, PageContainer, PageHeader, PageSkeleton, Skeleton } from "@bs/ui";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { RangeControls } from "../../components/analytics/range-controls.tsx";
import { formatCell, rangeInput, resolveRange, validateAnalyticsSearch, type AnalyticsSearch } from "../../lib/analytics-range.ts";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

const ReportChart = lazy(() => import("../../components/analytics/overview-charts.tsx").then((m) => ({ default: m.ReportChart })));

export const Route = createFileRoute("/_store/analytics_/reports/$reportId")({
  validateSearch: validateAnalyticsSearch,
  pendingComponent: () => <PageSkeleton />,
  component: AnalyticsReportPage,
});

type Row = AnalyticsReport["rows"][number] & { __id: string };

/** The table as shown, as a CSV file. Built in the browser from rows the user can already see. */
function downloadCsv(report: AnalyticsReport, from: string, to: string) {
  const esc = (v: string) => {
    // A leading =, +, - or @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const lines = [
    report.columns.map((c) => esc(c.label)).join(","),
    ...report.rows.map((r) =>
      report.columns
        .map((c) => {
          const v = r[c.key];
          if (v === null || v === undefined) return "";
          return c.kind === "text" || c.kind === "date" ? esc(String(v)) : esc(formatCell(v, c.kind, r["currency"] ? String(r["currency"]) : report.currency));
        })
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.id}-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AnalyticsReportPage() {
  const { reportId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { store } = useRouteContext({ from: "/_store" });
  const permissions = store?.permissions ?? [];
  const allowed = permissions.includes("analytics.read");
  const meta = ANALYTICS_REPORTS.find((r) => r.id === reportId);
  // A live report (visitors right now) ignores the date range and refreshes by itself.
  const live = Boolean(meta && "live" in meta && meta.live);
  const range = resolveRange({ ...search, compare: "none" });
  const setSearch = (patch: AnalyticsSearch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const back = { href: "/analytics", label: "Analytics" };

  const query = useQuery({
    ...orpc.admin.analytics.report.queryOptions({ input: { ...rangeInput(range), id: (meta?.id ?? "sales_over_time") as AnalyticsReportId } }),
    enabled: allowed && Boolean(meta),
    placeholderData: (prev) => prev,
    refetchInterval: live ? 15_000 : false,
  });
  const report = query.data;

  if (!meta || !allowed) {
    return (
      <PageContainer>
        <PageHeader back={back} title={meta?.title ?? "Report"} />
        <EmptyState
          icon={BarChart3}
          title={meta ? "You do not have access to analytics" : "This report does not exist"}
          description={meta ? "Ask the store owner if you need to see these reports." : "Pick a report from the Analytics page."}
        />
      </PageContainer>
    );
  }

  const columns: Column<Row>[] = (report?.columns ?? []).map((c) => ({
    id: c.key,
    header: c.label,
    className: c.kind === "text" || c.kind === "date" ? undefined : "text-right tabular-nums",
    cell: (row) => formatCell(row[c.key], c.kind, row["currency"] ? String(row["currency"]) : (report?.currency ?? "INR")),
  })) as Column<Row>[];
  const rows: Row[] = (report?.rows ?? []).map((r, i) => ({ ...r, __id: String(i) }));

  return (
    <PageContainer>
      <PageHeader
        back={back}
        title={meta.title}
        description={meta.description}
        aside={
          permissions.includes("exports.run") ? (
            <Button variant="outline" size="sm" disabled={!report || report.rows.length === 0} onClick={() => report && downloadCsv(report, range.from, range.to)}>
              <Download className="mr-1.5 size-4" aria-hidden />
              Export CSV
            </Button>
          ) : null
        }
      />
      {live ? null : <RangeControls range={range} onChange={setSearch} showCompare={false} />}
      {report?.note ? <p className="text-sm text-muted-foreground">{report.note}</p> : null}

      {report?.chart && report.rows.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <ReportChart report={report} />
            </Suspense>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.__id}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.isError ? { message: errorMessage(query.error), onRetry: () => void query.refetch() } : null}
        empty={<EmptyState icon={BarChart3} title="Nothing to show for these dates" description="Try a longer date range." />}
      />
    </PageContainer>
  );
}
