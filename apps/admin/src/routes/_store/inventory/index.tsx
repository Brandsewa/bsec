import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpDown, Box, Download, PackageX, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bs/ui";
import { Field, FieldError, FieldGroup, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { DataTable, type Column } from "../../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../../components/data-table/fetch-all.ts";
import { Pagination } from "../../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../../components/data-table/use-table-selection.ts";
import { compactSearch, oneOf, parsePaging, text, useColumnVisibility, useDebouncedValue, useUrlTableState } from "../../../components/data-table/use-table-state.ts";
import { ScrollTabs } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { downloadCsv, toCsv } from "../../../lib/csv.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { client, orpc } from "../../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type Sort = "product_asc" | "product_desc" | "on_hand_desc" | "on_hand_asc" | "available_desc" | "available_asc";
type StockFilter = "in_stock" | "low" | "out";
type Reason = "received" | "sold" | "damaged" | "returned" | "correction" | "transfer";

const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "product_asc", label: "Product (A to Z)" },
  { id: "product_desc", label: "Product (Z to A)" },
  { id: "on_hand_desc", label: "Most on hand" },
  { id: "on_hand_asc", label: "Least on hand" },
  { id: "available_desc", label: "Most available" },
  { id: "available_asc", label: "Least available" },
];
const STOCK_TABS = [
  { id: "all", label: "All" },
  { id: "in_stock", label: "In stock" },
  { id: "low", label: "Low stock" },
  { id: "out", label: "Out of stock" },
] as const;
const REASONS: ReadonlyArray<{ value: Reason; label: string }> = [
  { value: "received", label: "Received from supplier" },
  { value: "sold", label: "Sold" },
  { value: "damaged", label: "Damaged stock" },
  { value: "returned", label: "Customer return" },
  { value: "correction", label: "Inventory count correction" },
  { value: "transfer", label: "Warehouse transfer" },
];

export interface InventorySearch {
  stock: "all" | StockFilter;
  locationId?: string | undefined;
  q?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

export function parseInventorySearch(raw: Record<string, unknown>): InventorySearch {
  return {
    stock: oneOf(raw["stock"], ["all", "in_stock", "low", "out"] as const) ?? "all",
    locationId: text(raw["locationId"]),
    q: text(raw["q"]),
    sort: oneOf(raw["sort"], SORTS.map((x) => x.id)) ?? "product_asc",
    ...parsePaging(raw),
  };
}

export function inventoryListInput(s: InventorySearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    sort: s.sort,
    ...(s.stock !== "all" ? { stock: s.stock } : {}),
    ...(s.locationId ? { locationId: s.locationId } : {}),
    ...(s.q ? { search: s.q } : {}),
    ...paging,
  };
}

type Row = Awaited<ReturnType<typeof client.admin.inventory.list>>["items"][number];

const useStockCount = (stock?: StockFilter, locationId?: string) =>
  useQuery(orpc.admin.inventory.list.queryOptions({ input: { limit: 1, ...(stock ? { stock } : {}), ...(locationId ? { locationId } : {}) } })).data?.total;

export const Route = createFileRoute("/_store/inventory/")({
  validateSearch: (raw: Record<string, unknown>): Partial<InventorySearch> =>
    compactSearch(parseInventorySearch(raw), { stock: "all", sort: "product_asc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: InventoryPage,
});

const EXPORT_HEADER = ["Product", "Variant", "SKU", "Location", "On hand", "Reserved", "Available"];
const exportRow = (r: Row) => [r.productTitle ?? "", r.variantTitle ?? "", r.variantSku ?? "", r.locationName ?? "", r.onHand, r.reserved, r.available];

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [s, update] = useUrlTableState(parseInventorySearch);
  const bulk = useBulkRunner();
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });

  const locationsQuery = useQuery(orpc.admin.locations.list.queryOptions({ input: { status: "all" } }));
  const locations = locationsQuery.data ?? [];

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.inventory.list.queryOptions({ input: inventoryListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  const allCount = useStockCount(undefined, s.locationId);
  const lowCount = useStockCount("low", s.locationId);
  const outCount = useStockCount("out", s.locationId);

  const hasFilters = Boolean(s.q || s.locationId);
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, locationId: undefined, page: undefined });
  };

  const sel = useTableSelection({ rows, getId: (r: Row) => r.id, total, resetKey: JSON.stringify([s.stock, s.locationId, s.q]) });

  // ----- adjust stock -----
  const [adjustItem, setAdjustItem] = useState<Row | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<Reason>("received");
  const [note, setNote] = useState("");
  const [deltaError, setDeltaError] = useState<string | null>(null);

  const closeDialog = () => {
    setAdjustItem(null);
    setDelta("");
    setNote("");
    setReason("received");
    setDeltaError(null);
  };

  const adjustMutation = useMutation(
    orpc.admin.inventory.adjust.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Stock adjusted. New on-hand quantity: ${res.newOnHand}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.inventory.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() });
        closeDialog();
      },
      onError: (err: Error) => toast.error(err.message || "Failed to adjust stock"),
    }),
  );

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    const qty = Number(delta);
    if (delta.trim() === "" || !Number.isInteger(qty)) {
      setDeltaError("Enter a whole number, e.g. 10 or -5");
      return;
    }
    if (qty === 0) {
      setDeltaError("Adjustment cannot be zero");
      return;
    }
    if (adjustItem.onHand + qty < 0) {
      setDeltaError(`Cannot remove more than the ${adjustItem.onHand} units on hand`);
      return;
    }
    setDeltaError(null);
    adjustMutation.mutate({
      variantId: adjustItem.variantId,
      locationId: adjustItem.locationId,
      quantityDelta: qty,
      reason,
      ...(note.trim() ? { notes: note.trim() } : {}),
    });
  };

  async function exportInventory(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} row${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.inventory.list(inventoryListInput(s, { limit, offset })), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting inventory", done, total: of }),
      });
      downloadCsv(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} rows.` : `Exported ${all.length.toLocaleString("en-IN")} rows.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  const columns: Column<Row>[] = [
    {
      id: "item",
      header: "Item & variant",
      sort: { asc: "product_asc", desc: "product_desc" },
      cell: (r) => (
        <div className="flex max-w-72 flex-col">
          <span className="truncate font-medium text-foreground">{r.productTitle ?? r.variantTitle ?? "Variant"}</span>
          <span className="truncate text-muted-foreground">{[r.variantTitle, r.variantSku].filter(Boolean).join(" · ")}</span>
        </div>
      ),
    },
    {
      id: "location",
      header: "Location",
      optional: true,
      cell: (r) => (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Warehouse className="size-3.5" aria-hidden />
          {r.locationName ?? "—"}
        </span>
      ),
    },
    { id: "onHand", header: "On hand", sort: { asc: "on_hand_asc", desc: "on_hand_desc" }, className: "text-right font-mono text-foreground", cell: (r) => r.onHand },
    { id: "reserved", header: "Reserved", optional: true, className: "text-right font-mono text-muted-foreground", cell: (r) => r.reserved },
    {
      id: "available",
      header: "Available",
      sort: { asc: "available_asc", desc: "available_desc" },
      className: "text-right font-mono font-medium",
      cell: (r) => <span className={r.available <= 0 ? "text-destructive" : r.available <= 5 ? "text-amber-600" : "text-emerald-600"}>{r.available}</span>,
    },
  ];
  const visibility = useColumnVisibility("inventory", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  const activeLocation = locations.find((l) => l.id === s.locationId);

  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.locationId && activeLocation ? [{ key: "location", label: `Location: ${activeLocation.name}`, onRemove: () => setFilter({ locationId: undefined }) }] : []),
  ];

  const adjustButton = (r: Row) => (
    <Button variant="outline" size="sm" onClick={() => setAdjustItem(r)}>
      <ArrowUpDown className="mr-1.5 size-3.5" aria-hidden />
      Adjust
    </Button>
  );

  const empty =
    hasFilters || s.stock !== "all" ? (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No inventory levels match</p>
        <p className="text-muted-foreground">Try a different SKU, product name, or location filter.</p>
        {hasFilters ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    ) : (
      <div className="grid justify-items-center gap-1">
        <Warehouse className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">No inventory yet</p>
        <p className="text-muted-foreground">Inventory levels appear here once products with tracked variants exist.</p>
        <Button size="sm" className="mt-2" nativeButton={false} render={<Link to="/products/new" />}>
          Add a product
        </Button>
      </div>
    );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Inventory"
        description="Track on-hand stock, committed reservations, and record stock adjustments across locations."
        aside={
          <Button variant="outline" size="sm" disabled={bulk.busy || total === 0} onClick={() => void exportInventory("matching")}>
            <Download className="mr-1.5 size-3.5" aria-hidden />
            Export
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard label="Tracked Items" value={allCount ?? "—"} icon={Box} />
        <MetricCard label="Low Stock" value={lowCount ?? "—"} icon={AlertTriangle} />
        <MetricCard label="Out of Stock" value={outCount ?? "—"} icon={PackageX} />
      </div>

      <ScrollTabs value={s.stock} onChange={(v) => setFilter({ stock: v === "all" ? undefined : v })} tabs={STOCK_TABS} />

      <PageSection>
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <TableToolbar
                searchLabel="Search inventory"
                searchPlaceholder="Search SKU or product"
                searchText={searchText}
                onSearchText={setSearchText}
                resultCount={total}
                noun="items"
                sortOptions={SORTS}
                sort={s.sort}
                defaultSort="product_asc"
                onSort={(v) => setFilter({ sort: v })}
                trailing={
                  <div className="flex items-center gap-2">
                    {locations.length > 1 && (
                      <div className="w-48">
                        <SimpleSelect
                          value={s.locationId ?? ""}
                          onChange={(val) => setFilter({ locationId: val || undefined })}
                          options={[
                            { value: "", label: "All locations" },
                            ...locations.map((loc) => ({ value: loc.id, label: loc.name })),
                          ]}
                        />
                      </div>
                    )}
                    <ColumnsMenu columns={columns} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />
                  </div>
                }
              />
            </div>
          </div>

          <FilterChips chips={chips} onClear={clearFilters} />

          <BulkBar
            count={sel.count}
            noun="row"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy} onClick={() => void exportInventory("selection")}>
              <Download className="mr-1.5 size-3.5" aria-hidden /> Export
            </Button>
            {bulk.progress ? (
              <span role="status" className="text-muted-foreground text-xs">
                {bulk.progress.label}… {bulk.progress.done}/{bulk.progress.total}
              </span>
            ) : null}
          </BulkBar>

          <DataTable
            columns={shown}
            rows={rows}
            getRowId={(r) => r.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            sort={s.sort}
            onSortChange={(v) => setFilter({ sort: v === "product_asc" ? undefined : v })}
            rowActions={adjustButton}
            renderCard={(r, ctx) => (
              <div className="flex items-start gap-3 p-3">
                <div className="pt-0.5">
                  <Checkbox aria-label={`Select ${r.productTitle ?? r.variantSku}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="truncate font-medium text-foreground">{r.productTitle ?? r.variantTitle ?? "Variant"}</p>
                  <p className="truncate text-muted-foreground">{[r.variantTitle, r.variantSku].filter(Boolean).join(" · ")}</p>
                  <p className="text-muted-foreground text-xs">
                    {r.locationName ?? "—"} · {r.onHand} on hand · {r.reserved} reserved ·{" "}
                    <span className={r.available <= 0 ? "text-destructive font-medium" : r.available <= 5 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                      {r.available} available
                    </span>
                  </p>
                </div>
                {adjustButton(r)}
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

      {adjustItem ? (
        <Dialog open onOpenChange={(open) => !open && closeDialog()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Stock Level</DialogTitle>
              <DialogDescription>
                Recording a stock movement for {adjustItem.productTitle ?? adjustItem.variantTitle ?? "this variant"}
                {adjustItem.variantSku ? ` (${adjustItem.variantSku})` : ""}. Currently {adjustItem.onHand} on hand.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAdjustSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={Boolean(deltaError)}>
                  <FieldLabel htmlFor="qty-delta">Adjustment quantity *</FieldLabel>
                  <Input id="qty-delta" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 10 or -5" aria-invalid={Boolean(deltaError)} />
                  {deltaError ? <FieldError>{deltaError}</FieldError> : null}
                </Field>

                <Field>
                  <FieldLabel htmlFor="adj-reason">Reason *</FieldLabel>
                  <SimpleSelect id="adj-reason" value={reason} onChange={(v) => setReason(v as Reason)} options={REASONS} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="adj-note">Note (optional)</FieldLabel>
                  <Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Audit reference or reason details..." />
                </Field>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeDialog}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={adjustMutation.isPending}>
                    {adjustMutation.isPending ? "Adjusting..." : "Confirm Adjustment"}
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </PageContainer>
  );
}
export default InventoryPage;
