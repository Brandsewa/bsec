import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Download, Package, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
  type ColumnDef,
} from "@bs/ui";
import { useQuery } from "@tanstack/react-query";
import { useCsvExport } from "../../../lib/use-csv-export.ts";
import { orpc } from "../../../lib/orpc.ts";

type ProductStatus = "draft" | "active" | "archived";
type StatusFilter = ProductStatus | "all";

export const PRODUCTS_PAGE_SIZE = 20;

const STATUS_BADGE: Record<ProductStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  draft: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  archived: "bg-surface-100 text-foreground-muted",
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null) return "—";
  return min === max ? inr.format(min / 100) : `${inr.format(min / 100)} – ${inr.format(max / 100)}`;
}

export const Route = createFileRoute("/_store/products/")({
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
  component: ProductsRoute,
});

function ProductsRoute() {
  const navigate = useNavigate();
  return <ProductsPage navigate={(to) => void navigate({ to })} />;
}

export function ProductsPage({ navigate }: { navigate?: (to: string) => void }) {
  const csvExport = useCsvExport("products");
  const go = navigate ?? (() => undefined);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const listQuery = useQuery(
    orpc.admin.products.list.queryOptions({
      input: {
        search: debounced ? debounced : undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: PRODUCTS_PAGE_SIZE,
        offset: page * PRODUCTS_PAGE_SIZE,
      },
    }),
  );
  const totalQuery = useQuery(
    orpc.admin.products.list.queryOptions({ input: { limit: 1, offset: 0 } }),
  );
  const activeQuery = useQuery(
    orpc.admin.products.list.queryOptions({ input: { status: "active", limit: 1, offset: 0 } }),
  );
  const draftQuery = useQuery(
    orpc.admin.products.list.queryOptions({ input: { status: "draft", limit: 1, offset: 0 } }),
  );

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const hasFilters = statusFilter !== "all" || debounced.length > 0 || search.length > 0;

  type Row = (typeof items)[number];
  const columns: ColumnDef<Row>[] = [
    {
      header: "Product",
      cell: (p) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{p.title}</span>
          <span className="text-xs text-foreground-lighter">{p.slug}</span>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (p) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[p.status]}`}>
          {p.status}
        </span>
      ),
    },
    {
      header: "Price",
      cell: (p) => <span className="text-sm text-foreground">{formatPriceRange(p.priceMin, p.priceMax)}</span>,
    },
    {
      header: "Stock",
      cell: (p) => (
        <span className={`text-sm ${(p.stock ?? 0) <= 0 ? "text-destructive" : "text-foreground-muted"}`}>
          {(p.stock ?? 0) <= 0 ? "Out of stock" : `${p.stock} in stock`}
          {(p.variantCount ?? 0) > 1 ? ` · ${p.variantCount} variants` : ""}
        </span>
      ),
    },
    {
      header: "Updated",
      className: "text-right",
      headerClassName: "text-right",
      cell: (p) => (
        <span className="text-xs text-foreground-muted">{new Date(p.updatedAt).toLocaleDateString("en-IN")}</span>
      ),
    },
  ];

  const from = total === 0 ? 0 : page * PRODUCTS_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PRODUCTS_PAGE_SIZE);

  const metric = (label: string, q: typeof totalQuery, icon?: typeof Package) =>
    q.isLoading ? (
      <MetricCardSkeleton />
    ) : (
      <MetricCard label={label} value={q.data ? q.data.total : "—"} {...(icon ? { icon } : {})} />
    );

  let body;
  if (listQuery.isError) {
    body = (
      <EmptyState
        icon={AlertTriangle}
        title="Could not load products"
        description={listQuery.error instanceof Error ? listQuery.error.message : "Something went wrong."}
        action={
          <Button variant="default" size="sm" onClick={() => void listQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (listQuery.isLoading) {
    body = <TableSkeleton rows={5} columns={4} />;
  } else if (total === 0 && !hasFilters) {
    body = (
      <EmptyState
        icon={Package}
        title="No products yet"
        description="Add your first product to start building your catalog."
        action={
          <Button variant="primary" size="sm" onClick={() => go("/products/new")}>
            <Plus className="mr-1.5 size-3.5" aria-hidden />
            Add product
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(p) => p.id}
          onRowClick={(p) => go(`/products/${p.id}`)}
          emptyTitle="No products match"
          emptyDescription="Try adjusting your search query or status filter."
        />
        <div className="flex items-center justify-between text-xs text-foreground-muted">
          <span>
            {from}-{to} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="default" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={(page + 1) * PRODUCTS_PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Products" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" disabled={csvExport.pending} onClick={csvExport.run} title={csvExport.error ?? undefined}>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export
            </Button>
            <Button variant="default" size="sm" disabled title="Coming soon">
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              Import
            </Button>
            <Button variant="primary" size="sm" onClick={() => go("/products/new")}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Add product
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Products"
        description="Manage your product catalog, prices, variants, and categories."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {metric("Total Products", totalQuery, Package)}
        {metric("Active", activeQuery)}
        {metric("Draft", draftQuery)}
      </div>

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search products by title..."
            hasActiveFilters={hasFilters}
            onReset={() => {
              setSearch("");
              setDebounced("");
              setStatusFilter("all");
              setPage(0);
            }}
            filters={
              <div className="flex gap-1">
                {(["all", "active", "draft", "archived"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={statusFilter === s ? "primary" : "default"}
                    className="capitalize"
                    onClick={() => {
                      setStatusFilter(s);
                      setPage(0);
                    }}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            }
          />
          {body}
        </div>
      </PageSection>
    </PageContainer>
  );
}
