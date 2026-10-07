import { createFileRoute } from "@tanstack/react-router";
import {
  Clock,
  Download,
  MoreHorizontal,
  Send,
  ShoppingCart,
} from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import {
  EmptyState,
  MetricCard,
  MetricCardSkeleton,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AbandonedCheckoutItem } from "@bs/contracts";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bs/ui";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import {
  compactSearch,
  day,
  dayAfterIso,
  dayStartIso,
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
} from "../../components/data-table/use-table-state.ts";
import { money } from "../../components/order-parts.tsx";
import { DateRangePicker, ScrollTabs, SimpleSelect } from "@bs/ui";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

type AbandonedView = "all" | "open" | "recovered";
type AbandonedSort = "abandoned_desc" | "abandoned_asc" | "total_desc" | "total_asc";
type EmailStatusFilter = "all" | "not_sent" | "sent" | "failed" | "not_applicable";

const VIEWS: ReadonlyArray<{ id: AbandonedView; label: string }> = [
  { id: "all", label: "All checkouts" },
  { id: "open", label: "Open" },
  { id: "recovered", label: "Recovered" },
];

const SORTS: ReadonlyArray<{ id: AbandonedSort; label: string }> = [
  { id: "abandoned_desc", label: "Abandoned date (newest first)" },
  { id: "abandoned_asc", label: "Abandoned date (oldest first)" },
  { id: "total_desc", label: "Total (high to low)" },
  { id: "total_asc", label: "Total (low to high)" },
];

const EMAIL_FILTERS: ReadonlyArray<{ value: EmailStatusFilter; label: string }> = [
  { value: "all", label: "All email statuses" },
  { value: "sent", label: "Sent" },
  { value: "not_sent", label: "Not sent" },
  { value: "not_applicable", label: "No email" },
];

export interface AbandonedCheckoutsSearch {
  view: AbandonedView;
  q?: string | undefined;
  emailStatus: EmailStatusFilter;
  from?: string | undefined;
  to?: string | undefined;
  sort: AbandonedSort;
  page: number;
  size: number;
}

export function parseAbandonedCheckoutsSearch(raw: Record<string, unknown>): AbandonedCheckoutsSearch {
  return {
    view: oneOf(raw["view"], VIEWS.map((v) => v.id)) ?? "all",
    q: text(raw["q"]),
    emailStatus: oneOf(raw["emailStatus"], EMAIL_FILTERS.map((f) => f.value)) ?? "all",
    from: day(raw["from"]),
    to: day(raw["to"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "abandoned_desc",
    ...parsePaging(raw),
  };
}

export const Route = createFileRoute("/_store/abandoned-checkouts")({
  validateSearch: (raw: Record<string, unknown>): Partial<AbandonedCheckoutsSearch> =>
    compactSearch(parseAbandonedCheckoutsSearch(raw), {
      view: "all",
      emailStatus: "all",
      sort: "abandoned_desc",
      page: 1,
      size: 25,
    }),
  pendingComponent: () => <PageSkeleton />,
  component: AbandonedCheckoutsPage,
});

function formatRelativeTime(dateStr: string): string {
  const diffSec = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.round(diffHr / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

function AbandonedCheckoutsStatsStrip() {
  const statsQuery = useQuery(orpc.admin.abandonedCheckouts.stats.queryOptions({}));
  const stats = statsQuery.data;

  if (statsQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <MetricCard
        label="Abandoned checkouts"
        value={stats?.abandoned.toLocaleString("en-IN") ?? "0"}
      />
      <MetricCard
        label="Open"
        value={stats?.open.toLocaleString("en-IN") ?? "0"}
      />
      <MetricCard
        label="Recovered"
        value={stats?.recovered.toLocaleString("en-IN") ?? "0"}
      />
      <MetricCard
        label="Recovery emails sent"
        value={stats?.emailsSent.toLocaleString("en-IN") ?? "0"}
      />
      <MetricCard
        label="Potential revenue"
        value={money(stats?.potentialRevenue ?? 0)}
      />
    </div>
  );
}

function AbandonedCheckoutsPage() {
  const [s, update] = useUrlTableState(parseAbandonedCheckoutsSearch);
  const [exporting, setExporting] = useState(false);

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (val) =>
    update({ q: val.trim() || undefined, page: undefined }),
  );

  const queryArgs = useMemo(
    () => ({
      view: s.view,
      search: s.q || undefined,
      dateFrom: s.from ? dayStartIso(s.from) : undefined,
      dateTo: s.to ? dayAfterIso(s.to) : undefined,
      emailStatus: s.emailStatus,
      sort: s.sort,
      limit: s.size,
      offset: (s.page - 1) * s.size,
    }),
    [s.view, s.q, s.from, s.to, s.emailStatus, s.sort, s.size, s.page],
  );

  const listQuery = useQuery({
    ...orpc.admin.abandonedCheckouts.list.queryOptions({ input: queryArgs }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AbandonedCheckoutItem>[] = useMemo(
    () => [
      {
        id: "customer",
        header: "Customer",
        cell: (row) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">
              {row.customer.name || <span className="text-muted-foreground">Guest</span>}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.customer.email || row.customer.phone || "No contact info"}
            </span>
          </div>
        ),
      },
      {
        id: "products",
        header: "Products",
        cell: (row) => {
          if (!row.itemsSummary.firstTitle) {
            return <span className="text-muted-foreground">—</span>;
          }
          const words = row.itemsSummary.firstTitle.split(/\s+/);
          const shortTitle = words.slice(0, 2).join(" ");
          const extraCount = row.itemsSummary.count > 1 ? row.itemsSummary.count - 1 : 0;

          return (
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground" title={row.itemsSummary.firstTitle}>
                {shortTitle}
              </span>
              {extraCount > 0 && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                  +{extraCount} more
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "abandonedAt",
        header: "Abandoned",
        cell: (row) => (
          <div className="flex flex-col">
            <span className="text-foreground">
              {new Date(row.abandonedAt).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatRelativeTime(row.abandonedAt)}
            </span>
          </div>
        ),
      },
      {
        id: "total",
        header: "Total",
        cell: (row) => (
          <span className="font-medium tabular-nums text-foreground">
            {money(row.total)}
          </span>
        ),
      },
      {
        id: "emailStatus",
        header: "Email",
        cell: (row) => {
          if (row.emailStatus === "sent") {
            return <Badge variant="default">Sent</Badge>;
          }
          if (row.emailStatus === "not_applicable") {
            return <Badge variant="outline">No email</Badge>;
          }
          if (row.emailStatus === "failed") {
            return <Badge variant="destructive">Failed</Badge>;
          }
          return <Badge variant="secondary">Not sent</Badge>;
        },
      },
      {
        id: "recovery",
        header: "Recovery",
        cell: (row) =>
          row.recovered ? (
            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white">
              Recovered
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Not recovered
            </Badge>
          ),
      },
    ],
    [],
  );

  const visibility = useColumnVisibility("abandoned_checkouts", columns);
  const shownColumns = useMemo(
    () => columns.filter((c) => !c.optional || visibility.isVisible(c.id)),
    [columns, visibility],
  );

  const rowMenu = (_row: AbandonedCheckoutItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled
          title="Email delivery is deferred pending platform transactional email service"
          className="opacity-50 cursor-not-allowed"
        >
          <Send className="mr-2 h-4 w-4" />
          Send recovery email
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          title="Restoring an abandoned cart link requires storefront recovery endpoint"
          className="opacity-50 cursor-not-allowed"
        >
          <Clock className="mr-2 h-4 w-4" />
          Copy recovery link
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          title="Checkout restoration link requires storefront recovery endpoint"
          className="opacity-50 cursor-not-allowed"
        >
          <ShoppingCart className="mr-2 h-4 w-4" />
          Open checkout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  const sel = useTableSelection({
    rows,
    getId: (r) => r.id,
    total,
    resetKey: JSON.stringify([s.view, s.sort, s.emailStatus, s.from, s.to, s.q]),
  });

  const bulk = useBulkRunner();

  const filterChips: FilterChip[] = useMemo(() => {
    const chips: FilterChip[] = [];
    if (s.q) {
      chips.push({
        key: "q",
        label: `Search: ${s.q}`,
        onRemove: () => update({ q: undefined, page: undefined }),
      });
    }
    if (s.from || s.to) {
      chips.push({
        key: "date",
        label: `Abandoned: ${s.from ?? "…"} to ${s.to ?? "…"}`,
        onRemove: () => update({ from: undefined, to: undefined, page: undefined }),
      });
    }
    if (s.emailStatus !== "all") {
      const match = EMAIL_FILTERS.find((f) => f.value === s.emailStatus);
      chips.push({
        key: "emailStatus",
        label: `Email: ${match?.label ?? s.emailStatus}`,
        onRemove: () => update({ emailStatus: undefined, page: undefined }),
      });
    }
    return chips;
  }, [s.emailStatus, s.from, s.to, s.q, update]);

  async function handleExportCsv(scope: "all" | "selection" = "all") {
    setExporting(true);
    try {
      const headers = [
        "Cart ID",
        "Customer Name",
        "Customer Email",
        "Customer Phone",
        "First Product",
        "Total Quantity",
        "Abandoned Date",
        "Total (INR)",
        "Email Status",
        "Recovery Status",
        "Recovered At",
      ];

      const toRow = (it: AbandonedCheckoutItem) => [
        it.id,
        it.customer.name ?? "",
        it.customer.email ?? "",
        it.customer.phone ?? "",
        it.itemsSummary.firstTitle ?? "",
        String(it.itemsSummary.count),
        it.abandonedAt,
        (it.total / 100).toFixed(2),
        it.emailStatus,
        it.recovered ? "Recovered" : "Not recovered",
        it.recoveredAt ?? "",
      ];

      if (scope === "selection" && !sel.allResults) {
        const csvRows = sel.picked.map(toRow);
        downloadCsv(`abandoned-checkouts-selection-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, csvRows));
        toast.success(`Exported ${sel.picked.length} abandoned checkout${sel.picked.length === 1 ? "" : "s"}`);
        return;
      }

      const { rows: allRows } = await fetchAllPages<AbandonedCheckoutItem>(
        (offset, limit) =>
          client.admin.abandonedCheckouts.list({
            view: s.view,
            search: s.q || undefined,
            dateFrom: s.from ? dayStartIso(s.from) : undefined,
            dateTo: s.to ? dayAfterIso(s.to) : undefined,
            emailStatus: s.emailStatus,
            sort: s.sort,
            limit,
            offset,
          }),
        { cap: 5000 },
      );

      const csvRows = allRows.map(toRow);
      downloadCsv(`abandoned-checkouts-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, csvRows));
      toast.success(`Exported ${allRows.length} abandoned checkout${allRows.length === 1 ? "" : "s"}`);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageContainer size="full">
      <PageHeader
        title="Abandoned checkouts"
        description="Shoppers who started checkout and left before completing payment."
      />

      <PageSection>
        <Suspense
          fallback={
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </div>
          }
        >
          <AbandonedCheckoutsStatsStrip />
        </Suspense>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-1 gap-3">
          <ScrollTabs
            tabs={VIEWS}
            value={s.view}
            onChange={(v) => update({ view: v as AbandonedView, page: undefined })}
          />

          <TableToolbar
            searchLabel="Search abandoned checkouts"
            searchPlaceholder="Search customer, email, phone, product..."
            searchText={searchText}
            onSearchText={setSearchText}
            filters={
              <div className="flex items-center gap-2">
                <SimpleSelect
                  ariaLabel="Email status filter"
                  value={s.emailStatus}
                  onChange={(v) => update({ emailStatus: v as EmailStatusFilter, page: undefined })}
                  options={EMAIL_FILTERS}
                />
                <DateRangePicker
                  className="w-full justify-start md:w-auto"
                  emptyLabel="Abandoned: any date"
                  from={s.from}
                  to={s.to}
                  onChange={(from, to) => update({ from, to, page: undefined })}
                />
              </div>
            }
            resultCount={total}
            noun="checkouts"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="abandoned_desc"
            onSort={(v) => update({ sort: v as AbandonedSort, page: undefined })}
            trailing={
              <div className="flex items-center gap-2">
                <ColumnsMenu
                  columns={columns as unknown as Column<unknown>[]}
                  isVisible={visibility.isVisible}
                  onToggle={visibility.toggle}
                  onReset={visibility.reset}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExportCsv("all")}
                  disabled={exporting || total === 0}
                  className="h-8 gap-1.5 text-xs font-medium"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting ? "Export CSV" : "Export CSV"}
                </Button>
              </div>
            }
          />

          {filterChips.length > 0 && (
            <FilterChips
              chips={filterChips}
              onClear={() => update({ q: undefined, from: undefined, to: undefined, emailStatus: "all", page: undefined })}
            />
          )}

          <BulkBar
            count={sel.count}
            noun="checkout"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note={sel.allResults ? "Export covers every matching abandoned checkout." : undefined}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void handleExportCsv("selection")}
            >
              <Download className="mr-1.5 size-3.5" /> Export
            </Button>
            {bulk.progress ? (
              <span role="status" className="text-muted-foreground text-xs">
                {bulk.progress.label}… {bulk.progress.done}/{bulk.progress.total}
              </span>
            ) : null}
          </BulkBar>

          <DataTable
            columns={shownColumns}
            rows={rows}
            getRowId={(r) => r.id}
            isLoading={listQuery.isLoading}
            isFetching={listQuery.isFetching}
            error={listQuery.isError ? { message: errorMessage(listQuery.error), onRetry: () => void listQuery.refetch() } : null}
            empty={
              <EmptyState
                icon={ShoppingCart}
                title="No abandoned checkouts"
                description="Abandoned checkouts will show here after a customer starts checkout and leaves before payment."
              />
            }
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            rowActions={(r) => rowMenu(r)}
            renderCard={(r, ctx) => (
              <div className="flex items-start gap-3 p-3">
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select checkout ${r.id}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground text-xs">{r.customer.name || "Guest"}</span>
                    {r.recovered ? <Badge variant="outline">Recovered</Badge> : <Badge variant="outline">Open</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.customer.email || r.customer.phone || "No contact info"}</div>
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-muted-foreground">{r.itemsSummary.firstTitle || "Cart"}</span>
                    <span className="font-medium text-foreground">{money(r.total)}</span>
                  </div>
                </div>
              </div>
            )}
          />

          {total > s.size && (
            <Pagination
              page={s.page}
              pageSize={s.size}
              total={total}
              onPageChange={(p: number) => update({ page: p })}
              onPageSizeChange={(sz: number) => update({ size: sz, page: 1 })}
            />
          )}
        </div>
      </PageSection>
    </PageContainer>
  );
}
