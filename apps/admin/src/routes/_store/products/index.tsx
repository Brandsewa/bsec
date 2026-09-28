import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, Package, Plus, Upload } from "lucide-react";
import { useState } from "react";
import {
  Button,
  DataTable,
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

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  status: "active" | "draft" | "archived";
  category?: string;
  pricePaise: number;
  stockOnHand: number;
}

const mockProducts: ProductRow[] = [
  {
    id: "0199a000-0000-7000-8000-000000000504",
    title: "Organic Cotton T-Shirt",
    slug: "organic-cotton-tshirt",
    status: "active",
    category: "Apparel",
    pricePaise: 2999,
    stockOnHand: 42,
  },
  {
    id: "0199a000-0000-7000-8000-000000000505",
    title: "Ceramic Coffee Mug",
    slug: "ceramic-coffee-mug",
    status: "draft",
    category: "Home & Kitchen",
    pricePaise: 899,
    stockOnHand: 0,
  },
];

export const Route = createFileRoute("/_store/products/")({
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
  component: ProductsPage,
});

function ProductsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredProducts = mockProducts.filter((p) => {
    if (search.trim() && !p.title.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (statusFilter !== "all" && p.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const columns: ColumnDef<ProductRow>[] = [
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
      cell: (p) => {
        const badgeColors = {
          active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          draft: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          archived: "bg-surface-100 text-foreground-muted",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[p.status]}`}>
            {p.status}
          </span>
        );
      },
    },
    {
      header: "Category",
      cell: (p) => <span className="text-sm text-foreground-muted">{p.category ?? "—"}</span>,
    },
    {
      header: "Stock",
      cell: (p) => (
        <span className={`text-sm ${p.stockOnHand === 0 ? "font-medium text-rose-500" : "text-foreground-muted"}`}>
          {p.stockOnHand === 0 ? "Out of stock" : `${p.stockOnHand} in stock`}
        </span>
      ),
    },
    {
      header: "Price",
      className: "text-right",
      headerClassName: "text-right",
      cell: (p) => <span className="font-medium text-foreground">₹{(p.pricePaise / 100).toFixed(2)}</span>,
    },
  ];

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Products" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm">
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export
            </Button>
            <Button variant="default" size="sm">
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              Import
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate({ to: "/products/new" })}>
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
        <MetricCard label="Total Products" value={mockProducts.length} icon={Package} />
        <MetricCard
          label="Active"
          value={mockProducts.filter((p) => p.status === "active").length}
          change={{ value: "+1", trend: "up" }}
        />
        <MetricCard
          label="Out of Stock"
          value={mockProducts.filter((p) => p.stockOnHand === 0).length}
          change={{ value: "1", trend: "down" }}
        />
      </div>

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search products by title..."
            hasActiveFilters={statusFilter !== "all" || search.length > 0}
            onReset={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          />

          <DataTable
            data={filteredProducts}
            columns={columns}
            keyExtractor={(p) => p.id}
            onRowClick={(p) => navigate({ to: `/products/${p.id}` })}
            emptyTitle="No products found"
            emptyDescription="Try adjusting your search query or status filter."
          />
        </div>
      </PageSection>
    </PageContainer>
  );
}
