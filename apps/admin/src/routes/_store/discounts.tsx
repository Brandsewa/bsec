import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, Download, MoreHorizontal, Percent, Plus, Power, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import { compactSearch, oneOf, parsePaging, text, useColumnVisibility, useDebouncedValue, useUrlTableState } from "../../components/data-table/use-table-state.ts";
import { StatusBadge } from "../../components/order-parts.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type Sort = "created_desc" | "created_asc" | "title_asc" | "title_desc" | "used_desc" | "used_asc";
type DiscountStatus = "active" | "scheduled" | "expired" | "disabled";
type DiscountType = "percent" | "fixed" | "free_shipping" | "buy_x_get_y";

const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "title_asc", label: "Title (A to Z)" },
  { id: "title_desc", label: "Title (Z to A)" },
  { id: "used_desc", label: "Most used" },
  { id: "used_asc", label: "Least used" },
];
const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "scheduled", label: "Scheduled" },
  { id: "expired", label: "Expired" },
  { id: "disabled", label: "Disabled" },
] as const;
const TYPES = [
  { value: "any", label: "Type: any" },
  { value: "percent", label: "Percentage off" },
  { value: "fixed", label: "Fixed amount off" },
  { value: "free_shipping", label: "Free shipping" },
] as const;

export interface DiscountsSearch {
  status: "all" | DiscountStatus;
  q?: string | undefined;
  type?: DiscountType | undefined;
  sort: Sort;
  page: number;
  size: number;
}

export function parseDiscountsSearch(raw: Record<string, unknown>): DiscountsSearch {
  return {
    status: oneOf(raw["status"], ["all", "active", "scheduled", "expired", "disabled"] as const) ?? "all",
    q: text(raw["q"]),
    type: oneOf(raw["type"], ["percent", "fixed", "free_shipping", "buy_x_get_y"] as const),
    sort: oneOf(raw["sort"], SORTS.map((x) => x.id)) ?? "created_desc",
    ...parsePaging(raw),
  };
}

export function discountsListInput(s: DiscountsSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    sort: s.sort,
    ...(s.status !== "all" ? { status: s.status } : {}),
    ...(s.q ? { search: s.q } : {}),
    ...(s.type ? { type: s.type } : {}),
    ...paging,
  };
}

type DiscountRow = Awaited<ReturnType<typeof client.admin.discounts.list>>["items"][number];

const useStatusCount = (status?: DiscountStatus) =>
  useQuery(orpc.admin.discounts.list.queryOptions({ input: { limit: 1, ...(status ? { status } : {}) } })).data?.total;

export const Route = createFileRoute("/_store/discounts")({
  validateSearch: (raw: Record<string, unknown>): Partial<DiscountsSearch> =>
    compactSearch(parseDiscountsSearch(raw), { status: "all", sort: "created_desc", page: 1, size: 25 }),
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
  component: DiscountsPage,
});

const benefit = (d: DiscountRow) =>
  d.type === "percent" ? `${d.value}% off` : d.type === "fixed" ? `₹${d.value / 100} off` : d.type === "free_shipping" ? "Free shipping" : "Buy X get Y";

const EXPORT_HEADER = ["Code", "Title", "Type", "Value", "Used", "Usage limit", "Status", "Combinable", "Starts", "Ends", "Created"];
const exportRow = (d: DiscountRow) => [
  d.code ?? "",
  d.title,
  d.type,
  d.type === "fixed" ? (d.value / 100).toFixed(2) : d.value,
  d.usedCount,
  d.usageLimit ?? "",
  d.status,
  d.combinable ? "yes" : "no",
  d.startsAt ?? "",
  d.endsAt ?? "",
  d.createdAt,
];

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function DiscountsPage() {
  const queryClient = useQueryClient();
  const [s, update] = useUrlTableState(parseDiscountsSearch);
  const bulk = useBulkRunner();
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DiscountRow[] | null>(null);

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.discounts.list.queryOptions({ input: discountsListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  const totalAll = useStatusCount();
  const activeCount = useStatusCount("active");
  const scheduledCount = useStatusCount("scheduled");

  const hasFilters = Boolean(s.q || s.type);
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, type: undefined, page: undefined });
  };

  const sel = useTableSelection({ rows, getId: (d: DiscountRow) => d.id, total, resetKey: JSON.stringify([s.status, s.q, s.type]) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.key() });

  const setStatus = (items: DiscountRow[], status: "active" | "disabled") =>
    bulk.run({
      rows: items,
      getId: (d) => d.id,
      getLabel: (d) => d.code ?? d.title,
      verb: status === "active" ? "Enabling" : "Disabling",
      done: status === "active" ? "enabled" : "disabled",
      noun: "discount",
      eligible: (d) => d.status !== status,
      action: (d) => client.admin.discounts.update({ id: d.id, status }),
      onFinished: (ok) => {
        sel.release(ok);
        refresh();
      },
    });

  const remove = (items: DiscountRow[]) =>
    bulk.run({
      rows: items,
      getId: (d) => d.id,
      getLabel: (d) => d.code ?? d.title,
      verb: "Deleting",
      done: "deleted",
      noun: "discount",
      action: (d) => client.admin.discounts.delete({ id: d.id }),
      onFinished: (ok) => {
        sel.release(ok);
        refresh();
      },
    });

  async function exportDiscounts(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`discounts-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} discount${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.discounts.list(discountsListInput(s, { limit, offset })), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting discounts", done, total: of }),
      });
      downloadCsv(`discounts-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length} of ${count} discounts.` : `Exported ${all.length} discounts.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  const columns: Column<DiscountRow>[] = [
    {
      id: "code",
      header: "Discount code",
      cell: (d) => (
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-2 py-0.5 font-mono font-semibold text-foreground">{d.code ?? "AUTOMATIC"}</span>
          {d.code ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Copy code ${d.code}`}
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard.writeText(d.code ?? "");
                setCopiedId(d.id);
                setTimeout(() => setCopiedId(null), 1500);
              }}
            >
              {copiedId === d.id ? <Check className="text-emerald-600" /> : <Copy />}
            </Button>
          ) : null}
        </div>
      ),
    },
    { id: "title", header: "Title", sort: { asc: "title_asc", desc: "title_desc" }, className: "font-medium text-foreground", cell: (d) => d.title },
    { id: "benefit", header: "Benefit", className: "font-medium text-foreground", cell: benefit },
    {
      id: "usage",
      header: "Usage",
      sort: { asc: "used_asc", desc: "used_desc" },
      className: "text-muted-foreground",
      cell: (d) => `${d.usedCount} ${d.usageLimit ? `/ ${d.usageLimit}` : "used"}`,
    },
    { id: "status", header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
    {
      id: "created",
      header: "Created",
      optional: true,
      defaultHidden: true,
      sort: { asc: "created_asc", desc: "created_desc" },
      className: "text-muted-foreground",
      cell: (d) => new Date(d.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    },
  ];
  const visibility = useColumnVisibility("discounts", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.type ? [{ key: "type", label: `Type: ${TYPES.find((t) => t.value === s.type)?.label ?? s.type}`, onRemove: () => setFilter({ type: undefined }) }] : []),
  ];

  const filterControls = (
    <SimpleSelect ariaLabel="Discount type" className="w-full md:w-auto md:min-w-40" value={s.type ?? "any"} options={TYPES} onChange={(v) => setFilter({ type: v === "any" ? undefined : v })} />
  );

  const rowMenu = (d: DiscountRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${d.code ?? d.title}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {d.code ? (
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard.writeText(d.code ?? "");
              toast.success(`Copied ${d.code}`);
            }}
          >
            <Copy /> Copy code
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={bulk.busy} onClick={() => void setStatus([d], d.status === "active" ? "disabled" : "active")}>
          <Power /> {d.status === "active" ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={bulk.busy} onClick={() => setToDelete([d])}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty =
    hasFilters || s.status !== "all" ? (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No discounts match</p>
        <p className="text-muted-foreground">Try a different search or remove some filters.</p>
        {hasFilters ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    ) : (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No discounts yet</p>
        <p className="text-muted-foreground">Create your first promotional discount code.</p>
        <Button size="sm" className="mt-2" nativeButton={false} render={<Link to="/discounts/new" />}>
          <Plus className="mr-1.5 size-3.5" aria-hidden /> Create discount
        </Button>
      </div>
    );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Discounts"
        description="Promotional coupons, percentage off, fixed vouchers, and free shipping rules."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={bulk.busy || total === 0} onClick={() => void exportDiscounts("matching")}>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export
            </Button>
            <Button size="sm" nativeButton={false} render={<Link to="/discounts/new" />}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Create discount
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard label="Active Discounts" value={activeCount ?? "—"} icon={Tag} />
        <MetricCard label="Scheduled" value={scheduledCount ?? "—"} icon={Percent} />
        <MetricCard label="Total Vouchers" value={totalAll ?? "—"} />
      </div>

      <ScrollTabs value={s.status} onChange={(v) => setFilter({ status: v === "all" ? undefined : v })} tabs={STATUS_TABS} />

      <PageSection>
        <div className="grid grid-cols-1 gap-3">
          <TableToolbar
            searchLabel="Search discounts"
            searchPlaceholder="Search title or code"
            searchText={searchText}
            onSearchText={setSearchText}
            filters={filterControls}
            activeFilterCount={s.type ? 1 : 0}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            resultCount={total}
            noun="discounts"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="created_desc"
            onSort={(v) => setFilter({ sort: v })}
            trailing={<ColumnsMenu columns={columns} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />}
          />

          <FilterChips chips={chips} onClear={clearFilters} />

          <BulkBar
            count={sel.count}
            noun="discount"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note={sel.allResults ? "Enable, disable and delete work on discounts you tick yourself. Export covers every matching discount." : undefined}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void setStatus(sel.picked, "active")}>
              <Power className="mr-1.5" /> Enable
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void setStatus(sel.picked, "disabled")}>
              <Power className="mr-1.5" /> Disable
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy} onClick={() => void exportDiscounts("selection")}>
              <Download className="mr-1.5" /> Export
            </Button>
            <Button variant="destructive" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => setToDelete(sel.picked)}>
              <Trash2 className="mr-1.5" /> Delete
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
            getRowId={(d) => d.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            sort={s.sort}
            onSortChange={(v) => setFilter({ sort: v === "created_desc" ? undefined : v })}
            rowActions={rowMenu}
            renderCard={(d, ctx) => (
              <div className="flex items-start gap-3 p-3">
                <div className="pt-0.5">
                  <Checkbox aria-label={`Select ${d.code ?? d.title}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 font-mono font-semibold text-foreground">{d.code ?? "AUTOMATIC"}</span>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="truncate text-foreground">{d.title}</p>
                  <p className="text-muted-foreground">
                    {benefit(d)} · {d.usedCount} {d.usageLimit ? `/ ${d.usageLimit}` : "used"}
                  </p>
                </div>
                {rowMenu(d)}
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
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={toDelete?.length === 1 ? `Delete ${toDelete[0]?.code ?? toDelete[0]?.title}?` : `Delete ${toDelete?.length ?? 0} discounts?`}
        description="Customers will no longer be able to use them. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          const items = toDelete ?? [];
          setToDelete(null);
          void remove(items);
        }}
      />
    </PageContainer>
  );
}
export default DiscountsPage;
