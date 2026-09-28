import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  DataTable,
  DetailSkeleton,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  type ColumnDef,
} from "@bs/ui";

interface VariantRow {
  id: string;
  sku: string;
  title: string;
  pricePaise: number;
  trackInventory: boolean;
}

export const Route = createFileRoute("/_store/products/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState("Organic Cotton T-Shirt");
  const [slug, setSlug] = useState("organic-cotton-tshirt");
  const [status, setStatus] = useState<"active" | "draft" | "archived">("active");
  const [isSaved, setIsSaved] = useState(false);

  const mockVariants: VariantRow[] = [
    {
      id: "v-1",
      sku: "TSHIRT-BLK-S",
      title: "Small / Black",
      pricePaise: 2999,
      trackInventory: true,
    },
    {
      id: "v-2",
      sku: "TSHIRT-BLK-M",
      title: "Medium / Black",
      pricePaise: 2999,
      trackInventory: true,
    },
  ];

  const variantColumns: ColumnDef<VariantRow>[] = [
    {
      header: "Variant",
      cell: (v) => <span className="font-medium text-foreground">{v.title}</span>,
    },
    {
      header: "SKU",
      cell: (v) => <span className="font-mono text-xs text-foreground-lighter">{v.sku}</span>,
    },
    {
      header: "Inventory Tracking",
      cell: (v) => (
        <span className="text-xs text-foreground-muted">
          {v.trackInventory ? "Tracked" : "Do not track"}
        </span>
      ),
    },
    {
      header: "Price",
      className: "text-right",
      headerClassName: "text-right",
      cell: (v) => <span className="font-medium text-foreground">₹{(v.pricePaise / 100).toFixed(2)}</span>,
    },
  ];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <PageContainer size="default">
      <PageBreadcrumbs
        items={[{ label: "Products", href: "/products" }, { label: title }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/products" })}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Products
            </Button>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-1.5 size-3.5" aria-hidden />
              Delete
            </Button>
          </div>
        }
      />

      <PageHeader
        title={title}
        description={`ID: ${id}`}
      />

      <form onSubmit={handleSave} className="grid gap-6">
        <PageSection title="Product Information" description="Title and slug settings.">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-title">Title *</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-slug">Slug *</Label>
              <Input
                id="edit-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-status">Status</Label>
              <div id="edit-status" className="flex gap-2">
                {(["draft", "active", "archived"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={status === s ? "primary" : "default"}
                    size="sm"
                    className="capitalize"
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </PageSection>

        <PageSection title="Variants" description="All SKUs and pricing options configured for this product.">
          <DataTable
            data={mockVariants}
            columns={variantColumns}
            keyExtractor={(v) => v.id}
          />
        </PageSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="default" onClick={() => navigate({ to: "/products" })}>
            Back
          </Button>
          <Button type="submit" variant="primary">
            {isSaved ? <Check className="mr-1.5 size-3.5" aria-hidden /> : null}
            {isSaved ? "Saved" : "Save Changes"}
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
