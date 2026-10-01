import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, Copy, Download, ExternalLink, FileCheck, FilePen, MoreHorizontal, Package, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { DataTable, type Column } from "../../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../../components/data-table/fetch-all.ts";
import { Pagination } from "../../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../../components/data-table/use-table-selection.ts";
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
} from "../../../components/data-table/use-table-state.ts";
import { DateRangePicker } from "../../../components/date-range-picker.tsx";
import { StatusBadge } from "../../../components/order-parts.tsx";
import { ScrollTabs } from "../../../components/scroll-tabs.tsx";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { downloadCsv, toCsv } from "../../../lib/csv.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { client, orpc } from "../../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type Sort = "created_desc" | "created_asc" | "updated_desc" | "updated_asc" | "title_asc" | "title_desc";
type ProductStatus = "draft" | "active" | "archived";
type StockFilter = "in_stock" | "low" | "out";

const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "updated_desc", label: "Recently updated" },
  { id: "updated_asc", label: "Least recently updated" },
  { id: "title_asc", label: "Title (A to Z)" },
  { id: "title_desc", label: "Title (Z to A)" },
];
const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Draft" },
  { id: "archived", label: "Archived" },
] as const;
const STOCK_OPTIONS = [
  { value: "any", label: "Stock: any" },
  { value: "in_stock", label: "In stock (6+)" },
  { value: "low", label: "Low stock (1–5)" },
  { value: "out", label: "Out of stock" },
] as const;

export interface ProductsSearch {
  status: "all" | ProductStatus;
  q?: string | undefined;
  stock?: StockFilter | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

export function parseProductsSearch(raw: Record<string, unknown>): ProductsSearch {
  return {
    status: oneOf(raw["status"], ["all", "active", "draft", "archived"] as const) ?? "all",
    q: text(raw["q"]),
    stock: oneOf(raw["stock"], ["in_stock", "low", "out"] as const),
    from: day(raw["from"]),
    to: day(raw["to"]),
    sort: oneOf(raw["sort"], SORTS.map((x) => x.id)) ?? "created_desc",
    ...parsePaging(raw),
  };
}

export function productsListInput(s: ProductsSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    sort: s.sort,
    ...(s.status !== "all" ? { status: s.status } : {}),
    ...(s.q ? { search: s.q } : {}),
    ...(s.stock ? { stock: s.stock } : {}),
    ...(s.from ? { createdFrom: dayStartIso(s.from) } : {}),
    ...(s.to ? { createdTo: dayAfterIso(s.to) } : {}),
    ...paging,
  };
}

type ProductRow = Awaited<ReturnType<typeof client.admin.products.list>>["items"][number];

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null) return "—";
  return min === max ? inr.format(min / 100) : `${inr.format(min / 100)} – ${inr.format(max / 100)}`;
}

const useStatusCount = (status?: ProductStatus) =>
  useQuery(orpc.admin.products.list.queryOptions({ input: { limit: 1, ...(status ? { status } : {}) } }));

export const Route = createFileRoute("/_store/products/")({
  validateSearch: (raw: Record<string, unknown>): Partial<ProductsSearch> =>
    compactSearch(parseProductsSearch(raw), { status: "all", sort: "created_desc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={4} />
    </PageSkeleton>
  ),
  component: ProductsPage,
});

const EXPORT_HEADER = ["Title", "Slug", "Status", "Min price (INR)", "Max price (INR)", "Variants", "Stock", "Tags", "Updated"];
const exportRow = (p: ProductRow) => [
  p.title,
  p.slug,
  p.status,
  p.priceMin == null ? "" : (p.priceMin / 100).toFixed(2),
  p.priceMax == null ? "" : (p.priceMax / 100).toFixed(2),
  p.variantCount ?? 0,
  p.stock ?? 0,
  p.tags.join("; "),
  p.updatedAt,
];

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function ProductsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parseProductsSearch);
  const bulk = useBulkRunner();
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });
  const [toDelete, setToDelete] = useState<ProductRow[] | null>(null);

  const go = (id: string) => void navigate({ to: "/products/$id", params: { id } });

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.products.list.queryOptions({ input: productsListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  const allCount = useStatusCount();
  const activeCount = useStatusCount("active");
  const draftCount = useStatusCount("draft");

  const hasFilters = Boolean(s.q || s.stock || s.from || s.to);
  const activeFilterCount = [s.stock, s.from || s.to].filter(Boolean).length;
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, stock: undefined, from: undefined, to: undefined, page: undefined });
  };

  const sel = useTableSelection({ rows, getId: (p: ProductRow) => p.id, total, resetKey: JSON.stringify([s.status, s.q, s.stock, s.from, s.to]) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() });

  const setStatus = (items: ProductRow[], status: ProductStatus) =>
    bulk.run({
      rows: items,
      getId: (p) => p.id,
      getLabel: (p) => p.title,
      verb: status === "active" ? "Activating" : status === "archived" ? "Archiving" : "Moving to draft",
      done: status === "active" ? "activated" : status === "archived" ? "archived" : "moved to draft",
      noun: "product",
      eligible: (p) => p.status !== status,
      action: (p) => client.admin.products.update({ id: p.id, status }),
      onFinished: (ok) => {
        sel.release(ok);
        refresh();
      },
    });

  const remove = (items: ProductRow[]) =>
    bulk.run({
      rows: items,
      getId: (p) => p.id,
      getLabel: (p) => p.title,
      verb: "Deleting",
      done: "deleted",
      noun: "product",
      action: (p) => client.admin.products.delete({ id: p.id }),
      onFinished: (ok) => {
        sel.release(ok);
        refresh();
      },
    });

  async function exportProducts(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} product${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.products.list(productsListInput(s, { limit, offset })), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting products", done, total: of }),
      });
      downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} products.` : `Exported ${all.length.toLocaleString("en-IN")} products.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  const columns: Column<ProductRow>[] = [
    {
      id: "product",
      header: "Product",
      sort: { asc: "title_asc", desc: "title_desc" },
      cell: (p) => (
        <div className="flex max-w-72 flex-col">
          <span className="truncate font-medium text-foreground">{p.title}</span>
          <span className="truncate text-muted-foreground">{p.slug}</span>
        </div>
      ),
    },
    { id: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
    { id: "price", header: "Price", className: "text-foreground", cell: (p) => formatPriceRange(p.priceMin, p.priceMax) },
    {
      id: "stock",
      header: "Stock",
      cell: (p) => (
        <span className={(p.stock ?? 0) <= 0 ? "text-destructive" : (p.stock ?? 0) <= 5 ? "text-amber-600" : "text-muted-foreground"}>
          {(p.stock ?? 0) <= 0 ? "Out of stock" : `${p.stock} in stock`}
          {(p.variantCount ?? 0) > 1 ? ` · ${p.variantCount} variants` : ""}
        </span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      sort: { asc: "updated_asc", desc: "updated_desc" },
      className: "text-right text-muted-foreground",
      cell: (p) => new Date(p.updatedAt).toLocaleDateString("en-IN"),
    },
    {
      id: "created",
      header: "Created",
      optional: true,
      defaultHidden: true,
      sort: { asc: "created_asc", desc: "created_desc" },
      className: "text-muted-foreground",
      cell: (p) => new Date(p.createdAt).toLocaleDateString("en-IN"),
    },
  ];
  const visibility = useColumnVisibility("products", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.stock ? [{ key: "stock", label: STOCK_OPTIONS.find((o) => o.value === s.stock)?.label ?? "Stock", onRemove: () => setFilter({ stock: undefined }) }] : []),
    ...(s.from || s.to
      ? [{ key: "created", label: `Created: ${s.from ? fmtDay(s.from) : "…"} – ${s.to ? fmtDay(s.to) : "…"}`, onRemove: () => setFilter({ from: undefined, to: undefined }) }]
      : []),
  ];

  const filterControls = (
    <>
      <SimpleSelect ariaLabel="Stock level" className="w-full md:w-auto md:min-w-36" value={s.stock ?? "any"} options={STOCK_OPTIONS} onChange={(v) => setFilter({ stock: v === "any" ? undefined : v })} />
      <DateRangePicker className="w-full justify-start md:w-auto" emptyLabel="Created: any date" from={s.from} to={s.to} onChange={(from, to) => setFilter({ from, to })} />
    </>
  );

  const rowMenu = (p: ProductRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${p.title}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => go(p.id)}>
          <ExternalLink /> Edit product
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(p.slug);
            toast.success(`Copied ${p.slug}`);
          }}
        >
          <Copy /> Copy slug
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {p.status !== "active" ? (
          <DropdownMenuItem disabled={bulk.busy} onClick={() => void setStatus([p], "active")}>
            <FileCheck /> Activate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={bulk.busy} onClick={() => void setStatus([p], "draft")}>
            <FilePen /> Move to draft
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={bulk.busy || p.status === "archived"} onClick={() => void setStatus([p], "archived")}>
          <Archive /> Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={bulk.busy} onClick={() => setToDelete([p])}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty =
    hasFilters || s.status !== "all" ? (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No products match</p>
        <p className="text-muted-foreground">Try a different search or remove some filters.</p>
        {hasFilters ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    ) : (
      <div className="grid justify-items-center gap-1">
        <Package className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">No products yet</p>
        <p className="text-muted-foreground">Add your first product to start building your catalog.</p>
        <Button size="sm" className="mt-2" nativeButton={false} render={<Link to="/products/new" />}>
          <Plus className="mr-1.5 size-3.5" aria-hidden />
          Add product
        </Button>
      </div>
    );

  const metric = (label: string, q: typeof allCount, icon?: typeof Package) =>
    q.isLoading ? <MetricCardSkeleton /> : <MetricCard label={label} value={q.data ? q.data.total : "—"} {...(icon ? { icon } : {})} />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Products"
        description="Manage your product catalog, prices, variants, and categories."
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={bulk.busy || total === 0} onClick={() => void exportProducts("matching")}>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export
            </Button>
            <Button variant="outline" size="sm" disabled title="Coming soon">
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              Import
            </Button>
            <Button size="sm" nativeButton={false} render={<Link to="/products/new" />}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Add product
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {metric("Total Products", allCount, Package)}
        {metric("Active", activeCount)}
        {metric("Draft", draftCount)}
      </div>

      <ScrollTabs value={s.status} onChange={(v) => setFilter({ status: v === "all" ? undefined : v })} tabs={STATUS_TABS} />

      <PageSection>
        <div className="grid gap-3">
          <TableToolbar
            searchLabel="Search products"
            searchPlaceholder="Search products by title"
            searchText={searchText}
            onSearchText={setSearchText}
            filters={filterControls}
            activeFilterCount={activeFilterCount}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            resultCount={total}
            noun="products"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="created_desc"
            onSort={(v) => setFilter({ sort: v })}
            trailing={<ColumnsMenu columns={columns} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />}
          />

          <FilterChips chips={chips} onClear={clearFilters} />

          <BulkBar
            count={sel.count}
            noun="product"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note={sel.allResults ? "Status changes and delete work on products you tick yourself. Export covers every matching product." : undefined}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void setStatus(sel.picked, "active")}>
              <FileCheck className="mr-1.5" /> Activate
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void setStatus(sel.picked, "draft")}>
              <FilePen className="mr-1.5" /> Draft
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void setStatus(sel.picked, "archived")}>
              <Archive className="mr-1.5" /> Archive
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy} onClick={() => void exportProducts("selection")}>
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
            getRowId={(p) => p.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            sort={s.sort}
            onSortChange={(v) => setFilter({ sort: v === "created_desc" ? undefined : v })}
            onRowClick={(p) => go(p.id)}
            rowActions={rowMenu}
            renderCard={(p, ctx) => (
              <div className="flex items-start gap-3 p-3" onClick={() => go(p.id)}>
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${p.title}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{p.title}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="text-foreground">{formatPriceRange(p.priceMin, p.priceMax)}</p>
                  <p className={(p.stock ?? 0) <= 0 ? "text-destructive" : "text-muted-foreground"}>
                    {(p.stock ?? 0) <= 0 ? "Out of stock" : `${p.stock} in stock`}
                    {(p.variantCount ?? 0) > 1 ? ` · ${p.variantCount} variants` : ""}
                  </p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>{rowMenu(p)}</div>
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
        title={toDelete?.length === 1 ? `Delete "${toDelete[0]?.title}"?` : `Delete ${toDelete?.length ?? 0} products?`}
        description="They and their variants will be removed. To hide a product from the store without deleting it, archive it instead."
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
export default ProductsPage;
