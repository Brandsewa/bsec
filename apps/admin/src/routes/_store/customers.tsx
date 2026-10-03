import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Ban, Copy, Download, ExternalLink, MoreHorizontal, ShieldCheck, ShoppingBag, Tag, UserCheck, Users, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
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
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type View = "all" | "accounts" | "guests" | "blocked";
type Sort = "created_desc" | "created_asc" | "name_asc" | "name_desc" | "spent_desc" | "spent_asc" | "orders_desc" | "orders_asc";
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "all", label: "All" },
  { id: "accounts", label: "Customers" },
  { id: "guests", label: "Guests" },
  { id: "blocked", label: "Blocked" },
];
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
const MARKETING_STATES = [
  ["subscribed", "Subscribed"],
  ["unsubscribed", "Unsubscribed"],
  ["not_subscribed", "Not subscribed"],
  ["invalid", "Invalid"],
] as const;
const MARKETING_SELECT = [
  { value: "any", label: "Marketing: any" },
  ...MARKETING_STATES.map(([value, label]) => ({ value, label })),
];

export interface CustomersSearch {
  view: View;
  q?: string | undefined;
  tag?: string | undefined;
  mkt?: (typeof MARKETING_STATES)[number][0] | undefined;
  loc?: string | undefined;
  repeat?: true | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Reserved for the Phase 2 segment filter; parsed so the param stays stable until then. */
  segment?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

/** Coerces whatever is in the address bar into a valid state. */
export function parseCustomersSearch(raw: Record<string, unknown>): CustomersSearch {
  return {
    view: oneOf(raw["view"], VIEWS.map((v) => v.id)) ?? "all",
    q: text(raw["q"]),
    tag: text(raw["tag"]),
    mkt: oneOf(raw["mkt"], MARKETING_STATES.map(([k]) => k)),
    loc: text(raw["loc"]),
    repeat: flag(raw["repeat"]),
    from: day(raw["from"]),
    to: day(raw["to"]),
    segment: text(raw["segment"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "created_desc",
    ...parsePaging(raw),
  };
}

/** The API request for a URL state (also the query key, so tests can build it). */
export function customersListInput(s: CustomersSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    view: s.view,
    sort: s.sort,
    ...(s.q ? { search: s.q } : {}),
    ...(s.tag ? { tag: s.tag } : {}),
    ...(s.mkt ? { marketingState: s.mkt } : {}),
    ...(s.loc ? { location: s.loc } : {}),
    ...(s.repeat ? { repeat: true } : {}),
    ...(s.from ? { createdFrom: dayStartIso(s.from) } : {}),
    ...(s.to ? { createdTo: dayAfterIso(s.to) } : {}),
    ...paging,
  };
}

type CustomerRow = Awaited<ReturnType<typeof client.admin.customers.list>>["items"][number];

const MARKETING_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  subscribed: { label: "Subscribed", variant: "default" },
  unsubscribed: { label: "Unsubscribed", variant: "outline" },
  not_subscribed: { label: "Not subscribed", variant: "secondary" },
  invalid: { label: "Invalid", variant: "destructive" },
};

const EXPORT_HEADER = ["Name", "Email", "Phone", "Status", "Orders", "Total spent (INR)", "Last order", "Marketing state", "Consent updated", "Tags", "Joined"];
const exportRow = (c: CustomerRow) => [
  c.name,
  c.email,
  c.phone,
  c.status,
  c.ordersCount,
  (c.totalSpent / 100).toFixed(2),
  c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : "",
  MARKETING_BADGE[c.marketingState]?.label ?? c.marketingState,
  c.marketingUpdatedAt ? new Date(c.marketingUpdatedAt).toISOString() : "",
  c.tags.join("; "),
  new Date(c.createdAt).toISOString(),
];
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// Stats strip: its own query and its own boundary, independent of the list filters.
// ---------------------------------------------------------------------------------------------------------------

function CustomerStatsStrip() {
  const stats = useQuery(orpc.admin.customers.stats.queryOptions());
  if (stats.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }
  const d = stats.data ?? { total: 0, newThisMonth: 0, repeat: 0, subscribers: 0, totalSpend: 0, averageOrderValue: 0 };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
      <MetricCard label="Total customers" value={d.total.toLocaleString("en-IN")} icon={Users} />
      <MetricCard label="New this month" value={d.newThisMonth.toLocaleString("en-IN")} icon={UsersRound} />
      <MetricCard label="Repeat customers" value={d.repeat.toLocaleString("en-IN")} icon={UserCheck} />
      <MetricCard label="Marketing subscribers" value={d.subscribers.toLocaleString("en-IN")} icon={ShieldCheck} />
      <MetricCard label="Total spend" value={money(d.totalSpend)} icon={ShoppingBag} />
      <MetricCard label="Average order value" value={money(d.averageOrderValue)} />
    </div>
  );
}

export const Route = createFileRoute("/_store/customers")({
  validateSearch: (raw: Record<string, unknown>): Partial<CustomersSearch> =>
    compactSearch(parseCustomersSearch(raw), { view: "all", sort: "created_desc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: CustomersPage,
});

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function CustomersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parseCustomersSearch);
  const bulk = useBulkRunner();

  const go = (customerId: string) => void navigate({ to: "/customers/$customerId", params: { customerId } });
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.customers.list.queryOptions({ input: customersListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const options = useQuery(orpc.admin.customers.tags.queryOptions());

  const hasFilters = Boolean(s.q || s.tag || s.mkt || s.loc || s.repeat || s.from || s.to);
  const activeFilterCount = [s.tag, s.mkt, s.loc, s.repeat, s.from || s.to].filter(Boolean).length;
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, tag: undefined, mkt: undefined, loc: undefined, repeat: undefined, from: undefined, to: undefined, page: undefined });
  };

  const sel = useTableSelection({
    rows,
    getId: (c: CustomerRow) => c.id,
    total,
    resetKey: JSON.stringify([s.view, s.q, s.tag, s.mkt, s.loc, s.repeat, s.from, s.to]),
  });

  // ----- bulk and row actions -----
  const [tagAsk, setTagAsk] = useState<"add" | "remove" | null>(null);
  const [tagValue, setTagValue] = useState("");
  const [blockAsk, setBlockAsk] = useState<CustomerRow[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [subscribedOnly, setSubscribedOnly] = useState(true);

  const refresh = (succeeded: Iterable<string>) => {
    sel.release(succeeded);
    void queryClient.invalidateQueries({ queryKey: orpc.admin.customers.key() });
  };

  const runTags = (mode: "add" | "remove", tag: string, targets: CustomerRow[]) =>
    bulk.run({
      rows: targets,
      getId: (c) => c.id,
      getLabel: (c) => c.name || c.email,
      verb: mode === "add" ? "Adding tag to" : "Removing tag from",
      done: mode === "add" ? "tagged" : "untagged",
      noun: "customer",
      action: (c) => {
        const next = mode === "add" ? (c.tags.includes(tag) ? c.tags : [...c.tags, tag]) : c.tags.filter((t) => t !== tag);
        return client.admin.customers.setTags({ id: c.id, tags: next });
      },
      onFinished: refresh,
    });

  const runStatus = (status: "active" | "blocked", targets: CustomerRow[]) =>
    bulk.run({
      rows: targets,
      getId: (c) => c.id,
      getLabel: (c) => c.name || c.email,
      verb: status === "blocked" ? "Blocking" : "Unblocking",
      done: status === "blocked" ? "blocked" : "unblocked",
      noun: "customer",
      eligible: (c) => c.status !== status,
      action: (c) => client.admin.customers.setStatus({ id: c.id, status }),
      onFinished: refresh,
    });

  async function exportCustomers(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`customers-${stamp()}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} customer${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const exportInput = (offset: number, limit: number) => ({
        ...customersListInput(s, { limit, offset }),
        ...(source === "matching" && subscribedOnly ? { marketingState: "subscribed" as const } : {}),
      });
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.customers.list(exportInput(offset, limit)), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting customers", done, total: of }),
      });
      downloadCsv(`customers-${stamp()}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} customers.` : `Exported ${all.length.toLocaleString("en-IN")} customers.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  // ----- columns -----
  const columns: Column<CustomerRow>[] = [
    {
      id: "customer",
      header: "Customer",
      sort: { asc: "name_asc", desc: "name_desc" },
      cell: (c) => (
        <div className="flex max-w-60 flex-col">
          <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
            <span className="truncate">{c.name || "Unnamed"}</span>
            {c.isGuest ? <Badge variant="outline">Guest</Badge> : null}
            {c.status === "blocked" ? <Badge variant="destructive">Blocked</Badge> : null}
          </span>
          <span className="truncate text-muted-foreground">{c.email}</span>
        </div>
      ),
    },
    { id: "phone", header: "Phone", optional: true, defaultHidden: true, className: "text-muted-foreground", cell: (c) => c.phone },
    { id: "orders", header: "Orders", sort: { asc: "orders_asc", desc: "orders_desc" }, className: "font-medium text-foreground", cell: (c) => `${c.ordersCount} orders` },
    { id: "spent", header: "Total spent", sort: { asc: "spent_asc", desc: "spent_desc" }, className: "text-right font-medium text-foreground", cell: (c) => money(c.totalSpent) },
    {
      id: "lastOrder",
      header: "Last order",
      className: "text-muted-foreground",
      cell: (c) => (c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"),
    },
    {
      id: "marketing",
      header: "Marketing",
      cell: (c) => {
        const b = MARKETING_BADGE[c.marketingState] ?? { label: c.marketingState, variant: "outline" as const };
        return <Badge variant={b.variant}>{b.label}</Badge>;
      },
    },
    {
      id: "tags",
      header: "Tags",
      optional: true,
      cell: (c) => (
        <div className="flex flex-wrap items-center gap-1">
          {c.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
          {c.tags.length > 2 ? <span className="text-muted-foreground">+{c.tags.length - 2}</span> : null}
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

  // ----- filter chips -----
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const mktLabel = MARKETING_STATES.find(([k]) => k === s.mkt)?.[1];
  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.tag ? [{ key: "tag", label: `Tag: ${s.tag}`, onRemove: () => setFilter({ tag: undefined }) }] : []),
    ...(s.mkt ? [{ key: "mkt", label: `Marketing: ${mktLabel}`, onRemove: () => setFilter({ mkt: undefined }) }] : []),
    ...(s.loc ? [{ key: "loc", label: `Location: ${s.loc}`, onRemove: () => setFilter({ loc: undefined }) }] : []),
    ...(s.repeat ? [{ key: "repeat", label: "Repeat customers", onRemove: () => setFilter({ repeat: undefined }) }] : []),
    ...(s.from || s.to
      ? [{ key: "joined", label: `Joined: ${s.from ? fmtDay(s.from) : "…"} – ${s.to ? fmtDay(s.to) : "…"}`, onRemove: () => setFilter({ from: undefined, to: undefined }) }]
      : []),
  ];

  const locationSelect = [
    { value: "any", label: "Location: any" },
    ...(options.data?.locationStates ?? []).map((st) => ({ value: st, label: st })),
  ];
  const tagSelect = [
    { value: "any", label: "Tag: any" },
    ...(options.data?.tags ?? []).map((t) => ({ value: t, label: t })),
  ];

  const filterControls = (
    <>
      <SimpleSelect ariaLabel="Tag" className="w-full md:w-auto md:min-w-32" value={s.tag ?? "any"} options={tagSelect} onChange={(v) => setFilter({ tag: v === "any" ? undefined : v })} />
      <SimpleSelect ariaLabel="Marketing consent" className="w-full md:w-auto md:min-w-40" value={s.mkt ?? "any"} options={MARKETING_SELECT} onChange={(v) => setFilter({ mkt: v === "any" ? undefined : (v as CustomersSearch["mkt"]) })} />
      <SimpleSelect ariaLabel="Location" className="w-full md:w-auto md:min-w-32" value={s.loc ?? "any"} options={locationSelect} onChange={(v) => setFilter({ loc: v === "any" ? undefined : v })} />
      <Button variant={s.repeat ? "default" : "outline"} size="sm" className="justify-start md:justify-center" aria-pressed={Boolean(s.repeat)} onClick={() => setFilter({ repeat: s.repeat ? undefined : true })}>
        Repeat customers
      </Button>
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
        <DropdownMenuSeparator />
        {c.status === "blocked" ? (
          <DropdownMenuItem disabled={bulk.busy} onClick={() => void runStatus("active", [c])}>
            <ShieldCheck /> Unblock customer
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" disabled={bulk.busy} onClick={() => setBlockAsk([c])}>
            <Ban /> Block customer
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty =
    hasFilters || s.view !== "all" ? (
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

  const blockedTargets = blockAsk ?? [];
  return (
    <PageContainer size="full">
      <PageHeader
        title="Customers"
        description="Profiles, order history, addresses, tags and marketing consent for everyone who bought or signed up."
        aside={
          <Popover open={exportOpen} onOpenChange={setExportOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" disabled={bulk.busy || total === 0} />}>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export CSV
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={subscribedOnly} onCheckedChange={(v) => setSubscribedOnly(v === true)} aria-label="Subscribed only" />
                Marketing subscribers only
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Off exports every matching customer.</p>
              <Button size="sm" className="mt-3 w-full" disabled={bulk.busy} onClick={() => { setExportOpen(false); void exportCustomers("matching"); }}>
                <Download className="mr-1.5 size-3.5" aria-hidden /> Export filtered list
              </Button>
            </PopoverContent>
          </Popover>
        }
      />

      <CustomerStatsStrip />

      <ScrollTabs value={s.view} onChange={(v) => setFilter({ view: v === "all" ? undefined : v })} tabs={VIEWS} />

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
            note={sel.allResults ? "Bulk actions work on customers you tick yourself. Export covers every matching customer." : undefined}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => { setTagValue(""); setTagAsk("add"); }}>
              <Tag className="mr-1.5" /> Add tag
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => { setTagValue(""); setTagAsk("remove"); }}>
              <Tag className="mr-1.5" /> Remove tag
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void runStatus("active", sel.picked)}>
              <ShieldCheck className="mr-1.5" /> Set active
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => setBlockAsk(sel.picked)}>
              <Ban className="mr-1.5" /> Block
            </Button>
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">{c.name || "Unnamed"}</span>
                      {c.isGuest ? <Badge variant="outline">Guest</Badge> : null}
                    </span>
                    <span className="font-medium text-foreground">{money(c.totalSpent)}</span>
                  </div>
                  <p className="truncate text-muted-foreground">{c.email}</p>
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

      <ConfirmDialog
        open={tagAsk !== null}
        onOpenChange={(open) => !open && setTagAsk(null)}
        title={tagAsk === "add" ? "Add tag to customers" : "Remove tag from customers"}
        description={`${sel.picked.length} selected customer${sel.picked.length === 1 ? "" : "s"} will be updated. Customers missing the tag are skipped.`}
        confirmLabel={tagAsk === "add" ? "Add tag" : "Remove tag"}
        onConfirm={() => {
          const tag = tagValue.trim();
          setTagAsk(null);
          if (tag) void runTags(tagAsk ?? "add", tag, sel.picked);
        }}
      >
        <Input aria-label="Tag" value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder="e.g. VIP" autoFocus />
      </ConfirmDialog>

      <ConfirmDialog
        open={blockAsk !== null}
        onOpenChange={(open) => !open && setBlockAsk(null)}
        title={blockedTargets.length === 1 ? `Block ${blockedTargets[0]?.name || blockedTargets[0]?.email}?` : `Block ${blockedTargets.length} customers?`}
        description="Blocked customers cannot sign in or place orders. Their past orders are kept. You can unblock them at any time."
        confirmLabel={blockedTargets.length === 1 ? "Block customer" : "Block customers"}
        destructive
        onConfirm={() => {
          const targets = blockAsk ?? [];
          setBlockAsk(null);
          void runStatus("blocked", targets);
        }}
      />
    </PageContainer>
  );
}
export default CustomersPage;
