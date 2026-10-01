import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormSkeleton, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "../../../components/section-card.tsx";
import { orpc } from "../../../lib/orpc.ts";

export const Route = createFileRoute("/_store/products/new")({
  pendingComponent: () => (
    <PageSkeleton>
      <FormSkeleton fields={6} />
    </PageSkeleton>
  ),
  component: NewProductRoute,
});

function NewProductRoute() {
  const navigate = useNavigate();
  return <NewProductPage navigate={(to) => void navigate({ to })} />;
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);

interface OptionDraft {
  name: string;
  values: string;
}
interface VariantDraft {
  sku: string;
  title: string;
  price: string;
  compareAtPrice: string;
}

export function NewProductPage({ navigate }: { navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [requiresShipping, setRequiresShipping] = useState(true);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([
    { sku: "", title: "Default", price: "", compareAtPrice: "" },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation(
    orpc.admin.products.create.mutationOptions({
      onSuccess: (product) => {
        toast.success(`Product "${product.title}" created`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() });
        go(`/products/${product.id}`);
      },
      onError: (err: Error) => {
        toast.error(err.message || "Failed to create product");
      },
    }),
  );

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugTouched) setSlug(slugify(val));
  };

  const updateVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const updateOption = (i: number, patch: Partial<OptionDraft>) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e["title"] = "Title is required";
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      e["slug"] = "Use lowercase letters, numbers and hyphens only";
    }
    options.forEach((o, i) => {
      if (!o.name.trim()) e[`option-name-${i}`] = "Option name is required";
      if (!o.values.split(",").some((s) => s.trim())) e[`option-values-${i}`] = "Add at least one value";
    });
    variants.forEach((v, i) => {
      if (!v.sku.trim()) e[`variant-sku-${i}`] = "SKU is required";
      if (!v.title.trim()) e[`variant-title-${i}`] = "Variant title is required";
      if (v.price === "" || !Number.isFinite(Number(v.price)) || Number(v.price) < 0) {
        e[`variant-price-${i}`] = "Enter a valid price";
      }
      if (v.compareAtPrice !== "" && (!Number.isFinite(Number(v.compareAtPrice)) || Number(v.compareAtPrice) < 0)) {
        e[`variant-compare-${i}`] = "Enter a valid compare-at price";
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    const cleanOptions = options.map((o) => ({
      name: o.name.trim(),
      values: o.values
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
    createMutation.mutate({
      title: title.trim(),
      ...(slug ? { slug } : {}),
      status,
      ...(shortDescription.trim() ? { shortDescription: shortDescription.trim() } : {}),
      ...(description.trim() ? { descriptionJson: { type: "text", text: description.trim() } } : {}),
      tags: tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      requiresShipping,
      ...(cleanOptions.length > 0 ? { options: cleanOptions } : {}),
      variants: variants.map((v) => ({
        sku: v.sku.trim(),
        title: v.title.trim(),
        price: toPaise(v.price),
        ...(v.compareAtPrice !== "" ? { compareAtPrice: toPaise(v.compareAtPrice) } : {}),
        trackInventory: true,
        allowBackorder: false,
      })),
    });
  };

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  return (
    <PageContainer size="small">
      <PageBreadcrumbs
        items={[{ label: "Products", href: "/products" }, { label: "New Product" }]}
        actions={
          <Button variant="ghost" size="sm" onClick={() => go("/products")}>
            <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
            Back
          </Button>
        }
      />

      <PageHeader
        title="Add Product"
        description="Create a new catalog item with options and variants. Stock levels are set from the Inventory page after saving."
      />

      <form onSubmit={handleSubmit} className="grid gap-6" noValidate>
        <SectionCard title="General Information" description="Basic product identity and URLs.">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="product-title">Product Title *</FieldLabel>
              <Input
                id="product-title"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Vintage Denim Jacket"
                aria-invalid={Boolean(errors["title"])}
              />
              {err("title")}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="product-slug">URL Handle (Slug)</FieldLabel>
              <Input
                id="product-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="generated from the title if left blank"
                aria-invalid={Boolean(errors["slug"])}
              />
              {err("slug")}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="product-status">Status</FieldLabel>
              <div id="product-status" className="flex gap-2">
                {(["draft", "active", "archived"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={status === s ? "default" : "outline"}
                    size="sm"
                    className="capitalize"
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="product-short-desc">Short Description</FieldLabel>
              <Input
                id="product-short-desc"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                placeholder="Brief summary used in cards and search engine results..."
              />
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="product-desc">Description</FieldLabel>
              <Textarea
                id="product-desc"
                rows={5}
                  value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="product-tags">Tags</FieldLabel>
              <Input
                id="product-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma separated, e.g. summer, cotton"
              />
            </div>

            <Field orientation="horizontal">
              <Checkbox id="requires-shipping" checked={requiresShipping} onCheckedChange={(c) => setRequiresShipping(c)} />
              <FieldLabel htmlFor="requires-shipping" className="font-normal">This is a physical product that requires shipping</FieldLabel>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Options" description="Optional attributes such as Size or Colour.">
          <div className="grid gap-3">
            {options.map((o, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_auto]">
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`option-name-${i}`}>Name</FieldLabel>
                  <Input
                    id={`option-name-${i}`}
                    value={o.name}
                    onChange={(e) => updateOption(i, { name: e.target.value })}
                    placeholder="Size"
                  />
                  {err(`option-name-${i}`)}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`option-values-${i}`}>Values (comma separated)</FieldLabel>
                  <Input
                    id={`option-values-${i}`}
                    value={o.values}
                    onChange={(e) => updateOption(i, { values: e.target.value })}
                    placeholder="S, M, L"
                  />
                  {err(`option-values-${i}`)}
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove option"
                    onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOptions((prev) => [...prev, { name: "", values: "" }])}
              >
                <Plus className="mr-1.5 size-3.5" aria-hidden />
                Add option
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Variants & Pricing" description="Each variant has its own SKU and price (in ₹).">
          <div className="grid gap-3">
            {variants.map((v, i) => (
              <div key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`variant-title-${i}`}>Variant title *</FieldLabel>
                  <Input
                    id={`variant-title-${i}`}
                    value={v.title}
                    onChange={(e) => updateVariant(i, { title: e.target.value })}
                  />
                  {err(`variant-title-${i}`)}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`variant-sku-${i}`}>SKU *</FieldLabel>
                  <Input
                    id={`variant-sku-${i}`}
                    value={v.sku}
                    onChange={(e) => updateVariant(i, { sku: e.target.value })}
                    placeholder="e.g. DENIM-JKT-01"
                  />
                  {err(`variant-sku-${i}`)}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`variant-price-${i}`}>Price (₹) *</FieldLabel>
                  <Input
                    id={`variant-price-${i}`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.price}
                    onChange={(e) => updateVariant(i, { price: e.target.value })}
                    placeholder="0.00"
                  />
                  {err(`variant-price-${i}`)}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`variant-compare-${i}`}>Compare-at price (₹)</FieldLabel>
                  <Input
                    id={`variant-compare-${i}`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.compareAtPrice}
                    onChange={(e) => updateVariant(i, { compareAtPrice: e.target.value })}
                    placeholder="0.00"
                  />
                  {err(`variant-compare-${i}`)}
                </div>
                {variants.length > 1 ? (
                  <div className="sm:col-span-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="mr-1.5 size-3.5" aria-hidden />
                      Remove variant
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setVariants((prev) => [...prev, { sku: "", title: "", price: "", compareAtPrice: "" }])
                }
              >
                <Plus className="mr-1.5 size-3.5" aria-hidden />
                Add variant
              </Button>
            </div>
          </div>
        </SectionCard>

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => go("/products")}>
            Cancel
          </Button>
          <Button type="submit" variant="default" disabled={createMutation.isPending}>
            <Save className="mr-1.5 size-3.5" aria-hidden />
            {createMutation.isPending ? "Saving..." : "Save Product"}
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
