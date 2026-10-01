import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clock, Copy, Download, ExternalLink, FileText, MoreHorizontal, Package, Plus, RotateCcw, ShoppingBag, Truck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  day,
  dayAfterIso,
  dayStartIso,
  flag,
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
} from "../../components/data-table/use-table-state.ts";
import { DateRangePicker } from "../../components/date-range-picker.tsx";
import { StatusBadge, money } from "../../components/order-parts.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state (the source of truth for filters, sort, search and paging)
// ---------------------------------------------------------------------------------------------------------------

type SavedView = "all" | "unfulfilled" | "unpaid" | "cod_to_confirm" | "rto";
type Sort = "placed_desc" | "placed_asc" | "total_desc" | "total_asc" | "number_desc" | "number_asc";

const VIEWS: ReadonlyArray<{ id: SavedView; label: string }> = [
  { id: "all", label: "All orders" },
  { id: "unfulfilled", label: "Unfulfilled" },
  { id: "unpaid", label: "Unpaid" },
  { id: "cod_to_confirm", label: "COD to confirm" },
  { id: "rto", label: "RTO / Returns" },
];
const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "placed_desc", label: "Newest first" },
  { id: "placed_asc", label: "Oldest first" },
  { id: "total_desc", label: "Highest total" },
  { id: "total_asc", label: "Lowest total" },
  { id: "number_desc", label: "Order # (high to low)" },
  { id: "number_asc", label: "Order # (low to high)" },
];
const PAYMENT_OPTIONS = [
  ["pending", "Pending"],
  ["paid", "Paid"],
  ["cod_pending", "COD pending"],
  ["cod_collected", "COD collected"],
  ["failed", "Failed"],
  ["refunded", "Refunded"],
  ["cancelled", "Cancelled"],
] as const;
const FULFILLMENT_OPTIONS = [
  ["unfulfilled", "Unfulfilled"],
  ["partially_fulfilled", "Partially fulfilled"],
  ["fulfilled", "Fulfilled"],
  ["delivered", "Delivered"],
  ["rto", "RTO"],
] as const;
const STATUS_OPTIONS = [
  ["pending", "Pending"],
  ["confirmed", "Confirmed"],
  ["processing", "Processing"],
  ["partially_fulfilled", "Partially fulfilled"],
  ["fulfilled", "Fulfilled"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
  ["returned", "Returned"],
] as const;

const labelOf = (opts: ReadonlyArray<readonly [string, string]>, v: string) => opts.find(([k]) => k === v)?.[1] ?? v;
const withAny = (any: string, opts: ReadonlyArray<readonly [string, string]>) => [{ value: "any", label: any }, ...opts.map(([value, label]) => ({ value, label }))];
const PAYMENT_SELECT = withAny("Payment: any", PAYMENT_OPTIONS);
const FULFILLMENT_SELECT = withAny("Fulfillment: any", FULFILLMENT_OPTIONS);
const STATUS_SELECT = withAny("Status: any", STATUS_OPTIONS);

export interface OrdersSearch {
  view: SavedView;
  q?: string | undefined;
  pay?: string | undefined;
  ful?: string | undefined;
  st?: string | undefined;
  cod?: true | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

/** Coerces whatever is in the address bar into a valid state (bad values fall back to defaults). */
export function parseOrdersSearch(raw: Record<string, unknown>): OrdersSearch {
  return {
    view: oneOf(raw["view"], VIEWS.map((v) => v.id)) ?? "all",
    q: text(raw["q"]),
    pay: oneOf(raw["pay"], PAYMENT_OPTIONS.map(([k]) => k)),
    ful: oneOf(raw["ful"], FULFILLMENT_OPTIONS.map(([k]) => k)),
    st: oneOf(raw["st"], STATUS_OPTIONS.map(([k]) => k)),
    cod: flag(raw["cod"]),
    from: day(raw["from"]),
    to: day(raw["to"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "placed_desc",
    ...parsePaging(raw),
  };
}

/** The API request for a given URL state (also the query key, so it is exported for tests). */
export function ordersListInput(s: OrdersSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    view: s.view,
    sort: s.sort,
    ...(s.q ? { search: s.q } : {}),
    ...(s.st ? { status: s.st } : {}),
    ...(s.pay ? { paymentStatus: s.pay } : {}),
    ...(s.ful ? { fulfillmentStatus: s.ful } : {}),
    ...(s.cod ? { cod: true } : {}),
    ...(s.from ? { placedFrom: dayStartIso(s.from) } : {}),
    ...(s.to ? { placedTo: dayAfterIso(s.to) } : {}),
    ...paging,
  };
}

type OrderRow = Awaited<ReturnType<typeof client.admin.orders.list>>["items"][number];

function useOrderViewCount(view: SavedView): number {
  return useQuery(orpc.admin.orders.list.queryOptions({ input: { view, limit: 1 } })).data?.total ?? 0;
}

export const Route = createFileRoute("/_store/orders")({
  validateSearch: (raw: Record<string, unknown>): Partial<OrdersSearch> =>
    compactSearch(parseOrdersSearch(raw), { view: "all", sort: "placed_desc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: OrdersPage,
});

// ---------------------------------------------------------------------------------------------------------------
// Actions on orders (single and bulk share one runner)
// ---------------------------------------------------------------------------------------------------------------

type ActionKind = "fulfill" | "invoice" | "cancel";
const ACTIONS: Record<ActionKind, { verb: string; done: string; eligible: (o: OrderRow) => boolean; run: (o: OrderRow, reason?: string) => Promise<unknown> }> = {
  fulfill: {
    verb: "Fulfilling",
    done: "fulfilled",
    eligible: (o) => o.status !== "cancelled" && o.fulfillmentStatus !== "delivered",
    run: (o) => client.admin.orders.createFulfillment({ id: o.id }),
  },
  invoice: {
    verb: "Creating invoices for",
    done: "invoiced",
    eligible: (o) => o.status !== "cancelled",
    run: (o) => client.admin.orders.createInvoice({ id: o.id }),
  },
  cancel: {
    verb: "Cancelling",
    done: "cancelled",
    eligible: (o) => o.status !== "cancelled" && o.fulfillmentStatus !== "delivered",
    run: (o, reason) => client.admin.orders.cancel({ id: o.id, reason: reason?.trim() || "Cancelled by store staff" }),
  },
};

const EXPORT_HEADER = ["Order", "Placed at", "Customer name", "Customer email", "Phone", "Order status", "Payment", "Fulfillment", "Items", "Total (INR)"];
const exportRow = (o: OrderRow) => [
  o.number,
  new Date(o.placedAt).toISOString(),
  o.customerName ?? "",
  o.customerEmail,
  o.customerPhone,
  o.status,
  o.paymentStatus,
  o.fulfillmentStatus,
  o.itemsCount,
  (o.grandTotal / 100).toFixed(2),
];
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function OrdersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parseOrdersSearch);
  const bulk = useBulkRunner();
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });

  const go = (orderId: string) => void navigate({ to: "/orders/$orderId", params: { orderId } });

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.orders.list.queryOptions({ input: ordersListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  // Counts on the cards come from the server per saved view, independent of the filters in use.
  const allCount = useOrderViewCount("all");
  const unfulfilledCount = useOrderViewCount("unfulfilled");
  const unpaidCount = useOrderViewCount("unpaid");
  const rtoCount = useOrderViewCount("rto");

  const hasFilters = Boolean(s.q || s.pay || s.ful || s.st || s.cod || s.from || s.to);
  const activeFilterCount = [s.pay, s.ful, s.st, s.cod, s.from || s.to].filter(Boolean).length;
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, pay: undefined, ful: undefined, st: undefined, cod: undefined, from: undefined, to: undefined, page: undefined });
  };

  const sel = useTableSelection({
    rows,
    getId: (o: OrderRow) => o.id,
    total,
    resetKey: JSON.stringify([s.view, s.q, s.pay, s.ful, s.st, s.cod, s.from, s.to]),
  });

  // ----- actions -----
  const [confirm, setConfirm] = useState<{ kind: "fulfill" | "cancel"; orders: OrderRow[] } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const runAction = (kind: ActionKind, orders: OrderRow[], reason?: string) =>
    bulk.run({
      rows: orders,
      getId: (o) => o.id,
      getLabel: (o) => o.number,
      verb: ACTIONS[kind].verb,
      done: ACTIONS[kind].done,
      noun: "order",
      eligible: ACTIONS[kind].eligible,
      action: (o) => ACTIONS[kind].run(o, reason),
      onFinished: (ok) => {
        sel.release(ok);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.key() });
      },
    });

  async function exportOrders(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`orders-${stamp()}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} order${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.orders.list(ordersListInput(s, { limit, offset })), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting orders", done, total: of }),
      });
      downloadCsv(`orders-${stamp()}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} orders.` : `Exported ${all.length.toLocaleString("en-IN")} orders.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  function ask(kind: "fulfill" | "cancel", orders: OrderRow[]) {
    setCancelReason("");
    setConfirm({ kind, orders });
  }

  // ----- columns -----
  const columns: Column<OrderRow>[] = [
    {
      id: "number",
      header: "Order",
      sort: { asc: "number_asc", desc: "number_desc" },
      className: "font-medium text-foreground",
      cell: (o) => o.number,
    },
    {
      id: "date",
      header: "Date",
      sort: { asc: "placed_asc", desc: "placed_desc" },
      optional: true,
      className: "text-muted-foreground",
      cell: (o) => new Date(o.placedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (o) =>
        o.customerName ? (
          <div className="flex max-w-56 flex-col">
            <span className="truncate font-medium text-foreground">{o.customerName}</span>
            <span className="truncate text-muted-foreground">{o.customerEmail}</span>
          </div>
        ) : (
          <span className="block max-w-56 truncate text-foreground">{o.customerEmail}</span>
        ),
    },
    { id: "phone", header: "Phone", optional: true, defaultHidden: true, className: "text-muted-foreground", cell: (o) => o.customerPhone },
    { id: "status", header: "Status", optional: true, defaultHidden: true, cell: (o) => <StatusBadge status={o.status} /> },
    { id: "payment", header: "Payment", cell: (o) => <StatusBadge status={o.paymentStatus} /> },
    { id: "fulfillment", header: "Fulfillment", cell: (o) => <StatusBadge status={o.fulfillmentStatus} /> },
    { id: "items", header: "Items", optional: true, className: "text-muted-foreground", cell: (o) => o.itemsCount },
    {
      id: "total",
      header: "Total",
      sort: { asc: "total_asc", desc: "total_desc" },
      className: "text-right font-medium text-foreground",
      cell: (o) => money(o.grandTotal),
    },
  ];
  const visibility = useColumnVisibility("orders", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  // ----- filter chips -----
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.pay ? [{ key: "pay", label: `Payment: ${labelOf(PAYMENT_OPTIONS, s.pay)}`, onRemove: () => setFilter({ pay: undefined }) }] : []),
    ...(s.ful ? [{ key: "ful", label: `Fulfillment: ${labelOf(FULFILLMENT_OPTIONS, s.ful)}`, onRemove: () => setFilter({ ful: undefined }) }] : []),
    ...(s.st ? [{ key: "st", label: `Status: ${labelOf(STATUS_OPTIONS, s.st)}`, onRemove: () => setFilter({ st: undefined }) }] : []),
    ...(s.cod ? [{ key: "cod", label: "COD only", onRemove: () => setFilter({ cod: undefined }) }] : []),
    ...(s.from || s.to
      ? [{ key: "placed", label: `Placed: ${s.from ? fmtDay(s.from) : "…"} – ${s.to ? fmtDay(s.to) : "…"}`, onRemove: () => setFilter({ from: undefined, to: undefined }) }]
      : []),
  ];

  /** The filter controls: inline on tablet/desktop, stacked in the Filters sidebar on phones. */
  const filterControls = (
    <>
      <SimpleSelect ariaLabel="Payment status" className="w-full md:w-auto md:min-w-32" value={s.pay ?? "any"} options={PAYMENT_SELECT} onChange={(v) => setFilter({ pay: v === "any" ? undefined : v })} />
      <SimpleSelect ariaLabel="Fulfillment status" className="w-full md:w-auto md:min-w-36" value={s.ful ?? "any"} options={FULFILLMENT_SELECT} onChange={(v) => setFilter({ ful: v === "any" ? undefined : v })} />
      <SimpleSelect ariaLabel="Order status" className="w-full md:w-auto md:min-w-32" value={s.st ?? "any"} options={STATUS_SELECT} onChange={(v) => setFilter({ st: v === "any" ? undefined : v })} />
      <Button variant={s.cod ? "default" : "outline"} size="sm" className="justify-start md:justify-center" aria-pressed={Boolean(s.cod)} onClick={() => setFilter({ cod: s.cod ? undefined : true })}>
        COD only
      </Button>
      <DateRangePicker className="w-full justify-start md:w-auto" emptyLabel="Placed: any date" from={s.from} to={s.to} onChange={(from, to) => setFilter({ from, to })} />
    </>
  );

  const rowMenu = (o: OrderRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${o.number}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => go(o.id)}>
          <ExternalLink /> Open order
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(o.number);
            toast.success(`Copied ${o.number}`);
          }}
        >
          <Copy /> Copy order number
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!ACTIONS.fulfill.eligible(o) || bulk.busy} onClick={() => ask("fulfill", [o])}>
          <Truck /> Fulfill
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!ACTIONS.invoice.eligible(o) || bulk.busy} onClick={() => void runAction("invoice", [o])}>
          <FileText /> GST invoice
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={!ACTIONS.cancel.eligible(o) || bulk.busy} onClick={() => ask("cancel", [o])}>
          <XCircle /> Cancel order
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty =
    hasFilters || s.view !== "all" ? (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No orders match</p>
        <p className="text-muted-foreground">Try a different search or remove some filters.</p>
        {hasFilters ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    ) : (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No orders yet</p>
        <p className="text-muted-foreground">Orders from your storefront will show up here.</p>
        <Button size="sm" className="mt-2" nativeButton={false} render={<Link to="/orders/new" />}>
          <Plus className="mr-1.5 size-3.5" aria-hidden /> Create order
        </Button>
      </div>
    );

  const confirmOrders = confirm?.orders ?? [];
  const notEligible = confirm ? confirmOrders.filter((o) => !ACTIONS[confirm.kind].eligible(o)).length : 0;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Orders"
        description="Fulfill orders, track shipments, print GST tax invoices, process returns and refunds."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={bulk.busy || total === 0} onClick={() => void exportOrders("matching")}>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export
            </Button>
            <Button size="sm" nativeButton={false} render={<Link to="/orders/new" />}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Create order
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard label="Total Orders" value={allCount} icon={ShoppingBag} />
        <MetricCard label="Unfulfilled" value={unfulfilledCount} icon={Package} />
        <MetricCard label="Unpaid / COD" value={unpaidCount} icon={Clock} />
        <MetricCard label="RTO / Returns" value={rtoCount} icon={RotateCcw} />
      </div>

      <ScrollTabs value={s.view} onChange={(v) => setFilter({ view: v === "all" ? undefined : v })} tabs={VIEWS} />

      <PageSection>
        <div className="grid gap-3">
          <TableToolbar
            searchLabel="Search orders"
            searchPlaceholder="Search order #, name, email, phone"
            searchText={searchText}
            onSearchText={setSearchText}
            filters={filterControls}
            activeFilterCount={activeFilterCount}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            resultCount={total}
            noun="orders"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="placed_desc"
            onSort={(v) => setFilter({ sort: v })}
            trailing={<ColumnsMenu columns={columns} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />}
          />

          <FilterChips chips={chips} onClear={clearFilters} />

          <BulkBar
            count={sel.count}
            noun="order"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note={sel.allResults ? "Fulfill, invoice and cancel work on orders you tick yourself. Export covers every matching order." : undefined}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => ask("fulfill", sel.picked)}>
              <Truck className="mr-1.5" /> Fulfill
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void runAction("invoice", sel.picked)}>
              <FileText className="mr-1.5" /> GST invoices
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy} onClick={() => void exportOrders("selection")}>
              <Download className="mr-1.5" /> Export
            </Button>
            <Button variant="destructive" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => ask("cancel", sel.picked)}>
              <XCircle className="mr-1.5" /> Cancel
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
            getRowId={(o) => o.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            sort={s.sort}
            onSortChange={(v) => setFilter({ sort: v === "placed_desc" ? undefined : v })}
            onRowClick={(o) => go(o.id)}
            rowActions={rowMenu}
            renderCard={(o, ctx) => (
              <div className="flex items-start gap-3 p-3" onClick={() => go(o.id)}>
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${o.number}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{o.number}</span>
                    <span className="font-medium text-foreground">{money(o.grandTotal)}</span>
                  </div>
                  <p className="truncate text-foreground">{o.customerName ?? o.customerEmail}</p>
                  {o.customerName ? <p className="truncate text-muted-foreground">{o.customerEmail}</p> : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={o.paymentStatus} />
                    <StatusBadge status={o.fulfillmentStatus} />
                    <span className="text-muted-foreground">
                      {new Date(o.placedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · {o.itemsCount} items
                    </span>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>{rowMenu(o)}</div>
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
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`${confirm?.kind === "cancel" ? "Cancel" : "Fulfill"} ${confirmOrders.length === 1 ? (confirmOrders[0]?.number ?? "order") : `${confirmOrders.length} orders`}?`}
        description={
          <>
            {confirm?.kind === "cancel" ? "This stops fulfillment and releases reserved stock. It cannot be undone." : "A shipment is created for each order through your shipping provider."}
            {notEligible > 0 ? ` ${notEligible} selected order${notEligible === 1 ? " is" : "s are"} not eligible and will be skipped.` : ""}
          </>
        }
        confirmLabel={`${confirm?.kind === "cancel" ? "Cancel" : "Fulfill"} ${confirmOrders.length === 1 ? "order" : "orders"}`}
        destructive={confirm?.kind === "cancel"}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void runAction(c.kind, c.orders, cancelReason);
        }}
      >
        {confirm?.kind === "cancel" ? (
          <Input aria-label="Cancellation reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (optional): Cancelled by store staff" />
        ) : null}
      </ConfirmDialog>
    </PageContainer>
  );
}
export default OrdersPage;
