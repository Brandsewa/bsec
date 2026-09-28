import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useState } from "react";
import {
  Button,
  FormSkeleton,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
} from "@bs/ui";

export const Route = createFileRoute("/_store/products/new")({
  pendingComponent: () => (
    <PageSkeleton>
      <FormSkeleton fields={6} />
    </PageSkeleton>
  ),
  component: NewProductPage,
});

function NewProductPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slug || slug === title.toLowerCase().replace(/[^a-z0-9]+/g, "-")) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      navigate({ to: "/products" });
    }, 400);
  };

  return (
    <PageContainer size="small">
      <PageBreadcrumbs
        items={[{ label: "Products", href: "/products" }, { label: "New Product" }]}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/products" })}>
            <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
            Back
          </Button>
        }
      />

      <PageHeader
        title="Add Product"
        description="Create a new catalog item with options, pricing, and inventory tracking."
      />

      <form onSubmit={handleSubmit} className="grid gap-6">
        <PageSection title="General Information" description="Basic product identity and URLs.">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="product-title">Product Title *</Label>
              <Input
                id="product-title"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Vintage Denim Jacket"
                required
              />
              <p className="text-xs text-foreground-lighter">
                The public name of the product displayed across the store.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="product-slug">URL Handle (Slug) *</Label>
              <Input
                id="product-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. vintage-denim-jacket"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="product-short-desc">Short Description</Label>
              <Input
                id="product-short-desc"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                placeholder="Brief summary used in cards and search engine results..."
              />
            </div>
          </div>
        </PageSection>

        <PageSection title="Pricing & Inventory" description="Base pricing and SKU tracking for default variant.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="product-price">Price (₹) *</Label>
              <Input
                id="product-price"
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="product-sku">SKU *</Label>
              <Input
                id="product-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. DENIM-JKT-01"
                required
              />
            </div>
          </div>

          <div className="mt-4 grid gap-1.5">
            <Label htmlFor="product-category">Category</Label>
            <Input
              id="product-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Apparel"
            />
          </div>
        </PageSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="default" onClick={() => navigate({ to: "/products" })}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting || !title || !price || !sku}>
            <Save className="mr-1.5 size-3.5" aria-hidden />
            {isSubmitting ? "Saving..." : "Save Product"}
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
