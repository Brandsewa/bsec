import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Calendar, Clock, Copy, Download, MoreHorizontal, PackageCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "../../components/field.tsx";
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
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
} from "../../components/data-table/use-table-state.ts";
import { StatusBadge, money } from "../../components/order-parts.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

type PreorderView = "all" | "waiting" | "ready" | "shipped" | "cancelled";
type Sort = "ships_asc" | "ships_desc" | "placed_asc" | "placed_desc";

const VIEWS: ReadonlyArray<{ id: PreorderView; label: string }> = [
  { id: "all", label: "All pre-orders" },
  { id: "waiting", label: "Waiting" },
  { id: "ready", label: "Ready to ship" },
  { id: "shipped", label: "Shipped" },
  { id: "cancelled", label: "Cancelled" },
];

const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "ships_asc", label: "Ship date (earliest first)" },
  { id: "ships_desc", label: "Ship date (latest first)" },
  { id: "placed_asc", label: "Oldest order first" },
  { id: "placed_desc", label: "Newest order first" },
];

export interface PreordersSearch {
  view: PreorderView;
  q?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

export function parsePreordersSearch(raw: Record<string, unknown>): PreordersSearch {
  return {
    view: oneOf(raw["view"], VIEWS.map((v) => v.id)) ?? "all",
    q: text(raw["q"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "ships_asc",
    ...parsePaging(raw),
  };
}

export function preordersListInput(s: PreordersSearch, paging: { pageSize: number; page: number } = { pageSize: s.size, page: s.page }) {
  return {
    view: s.view,
    sort: s.sort,
    ...(s.q ? { search: s.q } : {}),
    ...paging,
  };
}

type PreorderRow = Awaited<ReturnType<typeof client.admin.preorders.list>>["items"][number];

function PreorderStatsStrip() {
  const stats = useQuery(orpc.admin.preorders.stats.queryOptions());
  if (stats.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }
  const data = stats.data ?? { openPreorders: 0, readyToShip: 0, dueNext14Days: 0, overdue: 0 };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard label="Pre-orders open" value={data.openPreorders.toLocaleString("en-IN")} icon={Clock} />
      <MetricCard label="Ready to ship" value={data.readyToShip.toLocaleString("en-IN")} icon={PackageCheck} />
      <MetricCard label="Due in next 14 days" value={data.dueNext14Days.toLocaleString("en-IN")} icon={Calendar} />
      <MetricCard
        label="Overdue"
        value={data.overdue.toLocaleString("en-IN")}
        icon={AlertCircle}
      />
    </div>
  );
}

const EXPORT_HEADER = ["Order", "Placed at", "Ships on", "Status", "Payment", "Fulfillment", "Customer name", "Customer email", "Phone", "Items", "Total (INR)"];
const exportRow = (o: PreorderRow) => [
  o.number,
  new Date(o.placedAt).toISOString(),
  o.shipsOn,
  o.status,
  o.paymentStatus,
  o.fulfillmentStatus,
  o.customerName ?? "",
  o.customerEmail ?? "",
  o.customerPhone ?? "",
  o.itemsCount,
  (o.grandTotal / 100).toFixed(2),
];
const stamp = () => new Date().toISOString().slice(0, 10);

export const Route = createFileRoute("/_store/preorders")({
  validateSearch: (raw: Record<string, unknown>): Partial<PreordersSearch> =>
    compactSearch(parsePreordersSearch(raw), { view: "all", sort: "ships_asc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={7} />
    </PageSkeleton>
  ),
  component: PreordersPage,
});

export function PreordersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parsePreordersSearch);
  const bulk = useBulkRunner();

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.preorders.list.queryOptions({ input: preordersListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  const sel = useTableSelection({
    rows,
    getId: (o: PreorderRow) => o.id,
    total,
    resetKey: JSON.stringify([s.view, s.q, s.sort]),
  });

  // Modal states
  const [changeDateTarget, setChangeDateTarget] = useState<PreorderRow[] | null>(null);
  const [newShipDate, setNewShipDate] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [releaseTarget, setReleaseTarget] = useState<PreorderRow[] | null>(null);

  const changeDateMutation = useMutation(
    orpc.admin.preorders.changeShipDate.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Ship date updated for ${data.updatedCount} order${data.updatedCount === 1 ? "" : "s"}.`);
        if (data.skippedCount > 0) {
          toast.info(`${data.skippedCount} order${data.skippedCount === 1 ? "" : "s"} skipped (already shipped or cancelled).`);
        }
        setChangeDateTarget(null);
        setNewShipDate("");
        setChangeReason("");
        sel.clear();
        void queryClient.invalidateQueries({ queryKey: orpc.admin.preorders.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  async function exportPreorders(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`preorders-${stamp()}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} pre-order${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const { rows: all, total: count } = await fetchAllPages(
        (offset, limit) => {
          const page = Math.floor(offset / limit) + 1;
          return client.admin.preorders.list(preordersListInput(s, { pageSize: limit, page }));
        },
        { onProgress: (done, of) => bulk.setProgress({ label: "Exporting pre-orders", done, total: of }) },
      );
      downloadCsv(`preorders-${stamp()}.csv`, toCsv(EXPORT_HEADER, all.map((o) => exportRow(o as PreorderRow))));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} pre-orders.` : `Exported ${all.length.toLocaleString("en-IN")} pre-orders.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const columns: Column<PreorderRow>[] = [
    {
      id: "number",
      header: "Order",
      sort: { asc: "placed_asc", desc: "placed_desc" },
      className: "font-medium text-foreground",
      cell: (o) => (
        <Link to="/orders/$orderId" params={{ orderId: o.id }} className="hover:underline">
          {o.number}
        </Link>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (o) =>
        o.customerName ? (
          <div className="flex max-w-48 flex-col">
            <span className="truncate font-medium text-foreground">{o.customerName}</span>
            <span className="truncate text-xs text-muted-foreground">{o.customerEmail ?? o.customerPhone}</span>
          </div>
        ) : (
          <span className="block max-w-48 truncate text-foreground">{o.customerEmail ?? o.customerPhone ?? "—"}</span>
        ),
    },
    {
      id: "items",
      header: "Items",
      cell: (o) => {
        if (!o.firstItemTitle) return <span className="text-muted-foreground">—</span>;
        const extra = o.itemsCount > 1 ? ` +${o.itemsCount - 1} more` : "";
        return (
          <div className="flex max-w-52 flex-col gap-0.5">
            <span className="truncate text-foreground" title={`${o.firstItemTitle}${extra}`}>
              {o.firstItemTitle}
              {extra && <span className="text-muted-foreground">{extra}</span>}
            </span>
            <span className="inline-flex w-fit items-center rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Pre-order ({o.preorderItemsCount} item{o.preorderItemsCount === 1 ? "" : "s"})
            </span>
          </div>
        );
      },
    },
    {
      id: "shipsOn",
      header: "Ships on",
      sort: { asc: "ships_asc", desc: "ships_desc" },
      cell: (o) => {
        const isPast = o.shipsOn < today;
        const isDueSoon = o.shipsOn >= today && o.shipsOn <= new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        const isOpen = !["shipped", "delivered", "cancelled"].includes(o.status);

        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">
              {new Date(o.shipsOn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            {o.preorderReleasedAt ? (
              <span className="inline-flex w-fit items-center text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                Released early
              </span>
            ) : isOpen && isPast ? (
              <span className="inline-flex w-fit items-center text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                Overdue
              </span>
            ) : isOpen && isDueSoon ? (
              <span className="inline-flex w-fit items-center text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Due soon
              </span>
            ) : null}
          </div>
        );
      },
    },
    { id: "payment", header: "Payment", cell: (o) => <StatusBadge status={o.paymentStatus} /> },
    { id: "fulfillment", header: "Fulfillment", cell: (o) => <StatusBadge status={o.fulfillmentStatus} /> },
    {
      id: "total",
      header: "Total",
      className: "text-right font-medium text-foreground",
      cell: (o) => money(o.grandTotal),
    },
  ];

  const visibility = useColumnVisibility("preorders", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  const chips: FilterChip[] = useMemo(() => {
    const list: FilterChip[] = [];
    if (s.q) list.push({ key: "q", label: `Search: ${s.q}`, onRemove: () => update({ q: undefined, page: undefined }) });
    return list;
  }, [s, update]);

  const rowMenu = (o: PreorderRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${o.number}`} />}>
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void navigate({ to: "/orders/$orderId", params: { orderId: o.id } })}>
          View order
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(o.number);
            toast.success(`Copied ${o.number}`);
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy order number
        </DropdownMenuItem>
        {!["shipped", "delivered", "cancelled"].includes(o.status) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setChangeDateTarget([o]);
                setNewShipDate(o.shipsOn);
                setChangeReason("");
              }}
            >
              Change ship date
            </DropdownMenuItem>
            {!o.preorderReleasedAt ? (
              <DropdownMenuItem onClick={() => setReleaseTarget([o])}>
                Release now
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty = (
    <div className="grid justify-items-center gap-1">
      <p className="text-sm font-medium text-foreground">No pre-orders match</p>
      <p className="text-muted-foreground">{s.q ? "Try clearing your search query." : "Orders with pre-order items will show here."}</p>
      {s.q ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => update({ q: undefined, page: undefined })}>
          Clear search
        </Button>
      ) : null}
    </div>
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Pre-orders"
        description="Orders containing pre-order items held until dispatch date."
        aside={
          <Button variant="outline" size="sm" disabled={bulk.busy || total === 0} onClick={() => void exportPreorders("matching")}>
            <Download className="mr-1.5 size-3.5" /> Export
          </Button>
        }
      />

      <PreorderStatsStrip />

      <ScrollTabs value={s.view} onChange={(v) => update({ view: v as PreorderView, page: undefined })} tabs={VIEWS} />

      <PageSection>
        <div className="grid grid-cols-1 gap-3">
          <TableToolbar
            searchLabel="Search pre-orders"
            searchPlaceholder="Search order #, customer, item..."
            searchText={searchText}
            onSearchText={setSearchText}
            resultCount={total}
            noun="pre-orders"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="ships_asc"
            onSort={(v) => update({ sort: v as Sort, page: undefined })}
            trailing={<ColumnsMenu columns={columns as unknown as Column<unknown>[]} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />}
          />

          <FilterChips chips={chips} onClear={() => update({ q: undefined, page: undefined })} />

          {sel.count > 0 && (
            <BulkBar
              count={sel.count}
              noun="pre-order"
              total={total}
              allResults={sel.allResults}
              pageFullySelected={sel.pageFullySelected}
              onSelectAllResults={sel.selectAllResults}
              onClear={sel.clear}
            >
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setChangeDateTarget(sel.picked as PreorderRow[]);
                  setNewShipDate("");
                  setChangeReason("");
                }}
              >
                Change ship date
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReleaseTarget(sel.picked as PreorderRow[])}
              >
                Release now
              </Button>
              <Button size="sm" variant="outline" onClick={() => void exportPreorders("selection")}>
                Export CSV
              </Button>
            </BulkBar>
          )}

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
            onSortChange={(v) => update({ sort: v as Sort, page: undefined })}
            onRowClick={(o) => void navigate({ to: "/orders/$orderId", params: { orderId: o.id } })}
            rowActions={(o) => rowMenu(o)}
          />

          {total > s.size && (
            <Pagination
              page={s.page}
              pageSize={s.size}
              total={total}
              onPageChange={(p) => update({ page: p })}
              onPageSizeChange={(sz) => update({ size: sz, page: 1 })}
            />
          )}
        </div>
      </PageSection>

      {/* Change Ship Date Dialog */}
      <Dialog open={Boolean(changeDateTarget)} onOpenChange={(open) => !open && setChangeDateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Change ship date ({changeDateTarget?.length === 1 ? changeDateTarget[0]?.number : `${changeDateTarget?.length ?? 0} orders`})
            </DialogTitle>
            <DialogDescription>
              Updates the dispatch promise. Customers will be notified of the revised date.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <Field id="new-ship-date" label="New dispatch date">
              <Input
                id="new-ship-date"
                type="date"
                value={newShipDate}
                onChange={(e) => setNewShipDate(e.target.value)}
              />
            </Field>
            <Field id="change-reason" label="Reason for change (optional)">
              <Input
                id="change-reason"
                placeholder="e.g. Production delayed by craftsman"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeDateTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!newShipDate || changeDateMutation.isPending}
              onClick={() => {
                if (!changeDateTarget || !newShipDate) return;
                changeDateMutation.mutate({
                  orderIds: changeDateTarget.map((o) => o.id),
                  shipsOn: newShipDate,
                  reason: changeReason.trim() || undefined,
                });
              }}
            >
              {changeDateMutation.isPending ? "Updating..." : "Update ship date"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Now Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(releaseTarget)}
        onOpenChange={(open) => !open && setReleaseTarget(null)}
        title={
          releaseTarget?.length === 1
            ? `Release ${releaseTarget[0]?.number} early?`
            : `Release ${releaseTarget?.length ?? 0} pre-orders early?`
        }
        description="This removes the pre-order hold immediately, allowing stock to be fulfilled and marked shipped before the promised dispatch date."
        confirmLabel="Release now"
        onConfirm={async () => {
          if (!releaseTarget) return;
          try {
            await Promise.all(releaseTarget.map((o) => client.admin.preorders.releaseNow({ id: o.id })));
            toast.success(`Released ${releaseTarget.length} pre-order${releaseTarget.length === 1 ? "" : "s"} for shipping.`);
            setReleaseTarget(null);
            sel.clear();
            void queryClient.invalidateQueries({ queryKey: orpc.admin.preorders.key() });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </PageContainer>
  );
}
