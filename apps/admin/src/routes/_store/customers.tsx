import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, Download, ExternalLink, MoreHorizontal, UserCheck, Users } from "lucide-react";
import { useMemo } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import {
  compactSearch,
  dayAfterIso,
  dayStartIso,
  day,
  flag,
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
} from "../../components/data-table/use-table-state.ts";
import { DateRangePicker } from "../../components/date-range-picker.tsx";
import { money } from "../../components/order-parts.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type Sort = "created_desc" | "created_asc" | "name_asc" | "name_desc" | "spent_desc" | "spent_asc" | "orders_desc" | "orders_asc";
const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "name_asc", label: "Name (A to Z)" },
  { id: "name_desc", label: "Name (Z to A)" },
  { id: "spent_desc", label: "Highest spend" },
  { id: "spent_asc", label: "Lowest spend" },
  { id: "orders_desc", label: "Most orders" },
  { id: "orders_asc", label: "Fewest orders" },
];
const MARKETING = [
  { value: "any", label: "Marketing: any" },
  { value: "yes", label: "Accepts marketing" },
  { value: "no", label: "Does not accept" },
] as const;

export interface CustomersSearch {
  q?: string | undefined;
  repeat?: true | undefined;
  mkt?: "yes" | "no" | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

/** Coerces whatever is in the address bar into a valid state. */
export function parseCustomersSearch(raw: Record<string, unknown>): CustomersSearch {
  return {
    q: text(raw["q"]),
    repeat: flag(raw["repeat"]),
    mkt: oneOf(raw["mkt"], ["yes", "no"] as const),
    from: day(raw["from"]),
    to: day(raw["to"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "created_desc",
    ...parsePaging(raw),
  };
}

/** The API request for a URL state (also the query key, so tests can build it). */
export function customersListInput(s: CustomersSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    sort: s.sort,
    ...(s.q ? { search: s.q } : {}),
    ...(s.repeat ? { repeat: true } : {}),
    ...(s.mkt ? { acceptsMarketing: s.mkt === "yes" } : {}),
    ...(s.from ? { createdFrom: dayStartIso(s.from) } : {}),
    ...(s.to ? { createdTo: dayAfterIso(s.to) } : {}),
    ...paging,
  };
}

type CustomerRow = Awaited<ReturnType<typeof client.admin.customers.list>>["items"][number];

const useCount = (extra: { repeat?: boolean; acceptsMarketing?: boolean }) =>
  useQuery(orpc.admin.customers.list.queryOptions({ input: { limit: 1, ...extra } })).data?.total;

export const Route = createFileRoute("/_store/customers")({
  validateSearch: (raw: Record<string, unknown>): Partial<CustomersSearch> =>
    compactSearch(parseCustomersSearch(raw), { sort: "created_desc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={5} />
    </PageSkeleton>
  ),
  component: CustomersPage,
});

const EXPORT_HEADER = ["Name", "Email", "Phone", "Orders", "Total spent (INR)", "Tags", "Joined"];
const exportRow = (c: CustomerRow) => [c.name, c.email, c.phone, c.ordersCount, (c.totalSpent / 100).toFixed(2), c.tags.join("; "), new Date(c.createdAt).toISOString()];

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function CustomersPage() {
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parseCustomersSearch);
  const bulk = useBulkRunner();

  const go = (customerId: string) => void navigate({ to: "/customers/$customerId", params: { customerId } });
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.customers.list.queryOptions({ input: customersListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  // Cards: server counts, independent of the filters in use.
  const totalAll = useCount({});
  const totalRepeat = useCount({ repeat: true });
  const totalMarketing = useCount({ acceptsMarketing: true });

  const hasFilters = Boolean(s.q || s.repeat || s.mkt || s.from || s.to);
  const activeFilterCount = [s.repeat, s.mkt, s.from || s.to].filter(Boolean).length;
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, repeat: undefined, mkt: undefined, from: undefined, to: undefined, page: undefined });
  };

  const sel = useTableSelection({ rows, getId: (c: CustomerRow) => c.id, total, resetKey: JSON.stringify([s.q, s.repeat, s.mkt, s.from, s.to]) });

  async function exportCustomers(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} customer${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.customers.list(customersListInput(s, { limit, offset })), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting customers", done, total: of }),
      });
      downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} customers.` : `Exported ${all.length.toLocaleString("en-IN")} customers.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  const columns: Column<CustomerRow>[] = [
    {
      id: "customer",
      header: "Customer",
      sort: { asc: "name_asc", desc: "name_desc" },
      cell: (c) => (
        <div className="flex max-w-60 flex-col">
          <span className="truncate font-medium text-foreground">{c.name || "Unnamed"}</span>
          <span className="truncate text-muted-foreground">{c.email}</span>
        </div>
      ),
    },
    { id: "phone", header: "Phone", optional: true, className: "text-muted-foreground", cell: (c) => c.phone },
    { id: "orders", header: "Orders", sort: { asc: "orders_asc", desc: "orders_desc" }, className: "font-medium text-foreground", cell: (c) => `${c.ordersCount} orders` },
    { id: "spent", header: "Total spent", sort: { asc: "spent_asc", desc: "spent_desc" }, className: "text-right font-medium text-foreground", cell: (c) => money(c.totalSpent) },
    {
      id: "tags",
      header: "Tags",
      optional: true,
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "joined",
      header: "Joined",
      optional: true,
      defaultHidden: true,
      sort: { asc: "created_asc", desc: "created_desc" },
      className: "text-muted-foreground",
      cell: (c) => new Date(c.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    },
  ];
  const visibility = useColumnVisibility("customers", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.repeat ? [{ key: "repeat", label: "Repeat customers", onRemove: () => setFilter({ repeat: undefined }) }] : []),
    ...(s.mkt ? [{ key: "mkt", label: s.mkt === "yes" ? "Accepts marketing" : "Does not accept marketing", onRemove: () => setFilter({ mkt: undefined }) }] : []),
    ...(s.from || s.to
      ? [{ key: "joined", label: `Joined: ${s.from ? fmtDay(s.from) : "…"} – ${s.to ? fmtDay(s.to) : "…"}`, onRemove: () => setFilter({ from: undefined, to: undefined }) }]
      : []),
  ];

  const filterControls = (
    <>
      <Button variant={s.repeat ? "default" : "outline"} size="sm" className="justify-start md:justify-center" aria-pressed={Boolean(s.repeat)} onClick={() => setFilter({ repeat: s.repeat ? undefined : true })}>
        Repeat customers
      </Button>
      <SimpleSelect ariaLabel="Marketing consent" className="w-full md:w-auto md:min-w-40" value={s.mkt ?? "any"} options={MARKETING} onChange={(v) => setFilter({ mkt: v === "any" ? undefined : v })} />
      <DateRangePicker className="w-full justify-start md:w-auto" emptyLabel="Joined: any date" from={s.from} to={s.to} onChange={(from, to) => setFilter({ from, to })} />
    </>
  );

  const rowMenu = (c: CustomerRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${c.name || c.email}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => go(c.id)}>
          <ExternalLink /> Open customer
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(c.email);
            toast.success(`Copied ${c.email}`);
          }}
        >
          <Copy /> Copy email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty = hasFilters ? (
    <div className="grid justify-items-center gap-1">
      <p className="text-sm font-medium text-foreground">No customers match</p>
      <p className="text-muted-foreground">Try a different search or remove some filters.</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
        Clear filters
      </Button>
    </div>
  ) : (
    <div className="grid justify-items-center gap-1">
      <p className="text-sm font-medium text-foreground">No customers yet</p>
      <p className="text-muted-foreground">Customers appear here after their first order.</p>
    </div>
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Customers"
        description="View customer profiles, order history, shipping addresses, and marketing preferences."
        aside={
          <Button variant="outline" size="sm" disabled={bulk.busy || total === 0} onClick={() => void exportCustomers("matching")}>
            <Download className="mr-1.5 size-3.5" aria-hidden />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard label="Total Customers" value={totalAll ?? "—"} icon={Users} />
        <MetricCard label="Repeat Customers" value={totalRepeat ?? "—"} icon={UserCheck} />
        <MetricCard label="Accept Marketing" value={totalMarketing ?? "—"} />
      </div>

      <PageSection>
        <div className="grid gap-3">
          <TableToolbar
            searchLabel="Search customers"
            searchPlaceholder="Search name, email, phone"
            searchText={searchText}
            onSearchText={setSearchText}
            filters={filterControls}
            activeFilterCount={activeFilterCount}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            resultCount={total}
            noun="customers"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="created_desc"
            onSort={(v) => setFilter({ sort: v })}
            trailing={<ColumnsMenu columns={columns} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />}
          />

          <FilterChips chips={chips} onClear={clearFilters} />

          <BulkBar
            count={sel.count}
            noun="customer"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy} onClick={() => void exportCustomers("selection")}>
              <Download className="mr-1.5" /> Export
            </Button>
            {bulk.progress ? (
              <span role="status" className="text-muted-foreground">
                {bulk.progress.label}… {bulk.progress.done}/{bulk.progress.total}
              </span>
            ) : null}
          </BulkBar>

          <DataTable
            columns={shown}
            rows={rows}
            getRowId={(c) => c.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            sort={s.sort}
            onSortChange={(v) => setFilter({ sort: v === "created_desc" ? undefined : v })}
            onRowClick={(c) => go(c.id)}
            rowActions={rowMenu}
            renderCard={(c, ctx) => (
              <div className="flex items-start gap-3 p-3" onClick={() => go(c.id)}>
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${c.name || c.email}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{c.name || "Unnamed"}</span>
                    <span className="font-medium text-foreground">{money(c.totalSpent)}</span>
                  </div>
                  <p className="truncate text-muted-foreground">{c.email}</p>
                  <p className="text-muted-foreground">
                    {c.ordersCount} orders · {c.phone}
                  </p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>{rowMenu(c)}</div>
              </div>
            )}
          />

          <Pagination
            page={s.page}
            pageSize={s.size}
            total={total}
            disabled={list.isFetching}
            onPageChange={(p) => update({ page: p === 1 ? undefined : p })}
            onPageSizeChange={(n) => update({ size: n === 25 ? undefined : n, page: undefined })}
          />
        </div>
      </PageSection>
    </PageContainer>
  );
}
export default CustomersPage;
