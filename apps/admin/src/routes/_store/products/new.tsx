import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormSkeleton, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SeoCard } from "../../../components/seo-card.tsx";
import { SimpleSelect } from "../../../components/simple-select.tsx";
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
  preorderEnabled?: boolean;
  preorderShipsOn?: string;
  preorderMessage?: string;
}

export function NewProductPage({ navigate }: { navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const queryClient = useQueryClient();

  // Queries for selectors
  const categoriesQuery = useQuery(orpc.admin.categories.list.queryOptions({ input: { status: "all" } }));
  const brandsQuery = useQuery(orpc.admin.brands.list.queryOptions());
  const collectionsQuery = useQuery(orpc.admin.collections.list.queryOptions({ input: { status: "all" } }));

  const categories = categoriesQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const collections = collectionsQuery.data ?? [];

  // Form State
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState<"draft" | "active" | "unlisted" | "archived">("draft");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [requiresShipping, setRequiresShipping] = useState(true);
  const [priceOnRequest, setPriceOnRequest] = useState(false);
  const [returnable, setReturnable] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);

  // Organization State
  const [primaryCategoryId, setPrimaryCategoryId] = useState("");
  const [extraCategoryIds, setExtraCategoryIds] = useState<string[]>([]);
  const [brandId, setBrandId] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);

  // SEO State
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

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

    if ((status === "active" || status === "unlisted") && !primaryCategoryId) {
      e["primaryCategory"] = "A primary category is required to publish or list a product";
    }

    options.forEach((o, i) => {
      if (!o.name.trim()) e[`option-name-${i}`] = "Option name is required";
      if (!o.values.split(",").some((s) => s.trim())) e[`option-values-${i}`] = "Add at least one value";
    });

    const today = new Date().toISOString().slice(0, 10);
    variants.forEach((v, i) => {
      if (!v.sku.trim()) e[`variant-sku-${i}`] = "SKU is required";
      if (!v.title.trim()) e[`variant-title-${i}`] = "Variant title is required";
      if (!priceOnRequest && (v.price === "" || !Number.isFinite(Number(v.price)) || Number(v.price) < 0)) {
        e[`variant-price-${i}`] = "Enter a valid price";
      }
      if (!priceOnRequest && v.compareAtPrice !== "" && (!Number.isFinite(Number(v.compareAtPrice)) || Number(v.compareAtPrice) < 0)) {
        e[`variant-compare-${i}`] = "Enter a valid compare-at price";
      }
      if (v.preorderEnabled) {
        if (!v.preorderShipsOn) {
          e[`variant-ships-on-${i}`] = "Pre-order ship date is required";
        } else if (v.preorderShipsOn <= today) {
          e[`variant-ships-on-${i}`] = "Pre-order ship date must be in the future";
        }
        if (v.preorderMessage && v.preorderMessage.length > 200) {
          e[`variant-msg-${i}`] = "Pre-order message cannot exceed 200 characters";
        }
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
      priceOnRequest,
      returnable,
      isFeatured,
      primaryCategoryId: primaryCategoryId || undefined,
      extraCategoryIds: extraCategoryIds.filter((cid) => cid !== primaryCategoryId),
      brandId: brandId || undefined,
      collectionIds,
      seo: {
        title: seoTitle.trim() || undefined,
        description: seoDescription.trim() || undefined,
      },
      ...(cleanOptions.length > 0 ? { options: cleanOptions } : {}),
      variants: variants.map((v) => ({
        sku: v.sku.trim(),
        title: v.title.trim(),
        price: priceOnRequest ? 0 : toPaise(v.price),
        ...(!priceOnRequest && v.compareAtPrice !== "" ? { compareAtPrice: toPaise(v.compareAtPrice) } : {}),
        trackInventory: true,
        allowBackorder: false,
        preorderEnabled: Boolean(v.preorderEnabled),
        preorderShipsOn: v.preorderEnabled && v.preorderShipsOn ? v.preorderShipsOn : null,
        preorderMessage: v.preorderEnabled && v.preorderMessage ? v.preorderMessage.trim() : null,
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
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Products", href: "/products" }, { label: "New Product" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go("/products")}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Back
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={createMutation.isPending}
              onClick={handleSubmit}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {createMutation.isPending ? "Saving..." : "Save Product"}
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Add Product"
        description="Create a new catalog item with options, variants, category organization and SEO settings."
      />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6" noValidate>
        {/* Left Column (2 spans): Primary details, options, variants, shipping, SEO */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* General Information Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">General Information</CardTitle>
              <CardDescription>Basic product title, URL handle, and descriptions.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
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
                  placeholder="Generated from the title if left blank"
                  aria-invalid={Boolean(errors["slug"])}
                />
                {err("slug")}
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
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed product story, specifications, and care instructions..."
                />
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="product-tags">Tags</FieldLabel>
                <Input
                  id="product-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Comma separated, e.g. summer, cotton, organic"
                />
              </div>
            </CardContent>
          </Card>

          {/* Pricing & Quotes Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Pricing & Quotes</CardTitle>
              <CardDescription>Price on request hides checkout prices and routes buyers to quote requests.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="price-on-request" className="cursor-pointer font-medium">
                    Price on request
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Hide prices and require customers to submit quote requests.
                  </p>
                </div>
                <Switch
                  id="price-on-request"
                  checked={priceOnRequest}
                  onCheckedChange={(c) => setPriceOnRequest(Boolean(c))}
                />
              </Field>
            </CardContent>
          </Card>

          {/* Options Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Options</CardTitle>
              <CardDescription>Optional buyer-selectable attributes such as Size or Colour.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {options.map((o, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_auto] bg-muted/20">
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor={`option-name-${i}`}>Option Name</FieldLabel>
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
                      placeholder="S, M, L, XL"
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
                      <Trash2 className="size-3.5 text-destructive" aria-hidden />
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
            </CardContent>
          </Card>

          {/* Variants Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Variants & Pricing</CardTitle>
              <CardDescription>Each variant has its own SKU, price (in ₹), and pre-order settings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {variants.map((v, i) => (
                <div key={i} className="grid gap-3 rounded-md border border-border p-3.5 sm:grid-cols-2 bg-muted/20">
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
                      disabled={priceOnRequest}
                      value={priceOnRequest ? "0.00" : v.price}
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
                      disabled={priceOnRequest}
                      value={priceOnRequest ? "" : v.compareAtPrice}
                      onChange={(e) => updateVariant(i, { compareAtPrice: e.target.value })}
                      placeholder="0.00"
                    />
                    {err(`variant-compare-${i}`)}
                  </div>

                  <div className="border-t border-border pt-3 sm:col-span-2 flex flex-col gap-3">
                    <Field orientation="horizontal" className="justify-between">
                      <div>
                        <FieldLabel htmlFor={`v-preorder-${i}`} className="cursor-pointer font-normal text-sm">
                          Enable pre-order
                        </FieldLabel>
                        <p className="text-xs text-muted-foreground">Sell at zero stock with expected dispatch date.</p>
                      </div>
                      <Switch
                        id={`v-preorder-${i}`}
                        checked={Boolean(v.preorderEnabled)}
                        onCheckedChange={(c) => updateVariant(i, { preorderEnabled: Boolean(c) })}
                      />
                    </Field>

                    {v.preorderEnabled && (
                      <div className="grid gap-3 sm:grid-cols-2 rounded-md bg-muted/40 p-3 border border-border">
                        <div className="grid gap-1.5">
                          <FieldLabel htmlFor={`variant-ships-on-${i}`}>Expected ship date *</FieldLabel>
                          <Input
                            id={`variant-ships-on-${i}`}
                            type="date"
                            value={v.preorderShipsOn ?? ""}
                            onChange={(e) => updateVariant(i, { preorderShipsOn: e.target.value })}
                          />
                          {err(`variant-ships-on-${i}`)}
                        </div>
                        <div className="grid gap-1.5">
                          <FieldLabel htmlFor={`variant-msg-${i}`}>
                            Customer message (optional, max 200 chars)
                          </FieldLabel>
                          <Input
                            id={`variant-msg-${i}`}
                            placeholder="e.g. Handmade in small batches"
                            maxLength={200}
                            value={v.preorderMessage ?? ""}
                            onChange={(e) => updateVariant(i, { preorderMessage: e.target.value })}
                          />
                          {err(`variant-msg-${i}`)}
                        </div>
                      </div>
                    )}
                  </div>

                  {variants.length > 1 ? (
                    <div className="sm:col-span-2 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="mr-1.5 size-3.5 text-destructive" aria-hidden />
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
            </CardContent>
          </Card>

          {/* Shipping Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Shipping</CardTitle>
              <CardDescription>Physical delivery requirements.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="requires-shipping" className="cursor-pointer font-medium">
                    Requires shipping
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    This is a physical item that requires shipping or courier dispatch.
                  </p>
                </div>
                <Switch
                  id="requires-shipping"
                  checked={requiresShipping}
                  onCheckedChange={(c) => setRequiresShipping(Boolean(c))}
                />
              </Field>
            </CardContent>
          </Card>

          {/* Search Engine Listing (SEO Card) */}
          <SeoCard
            defaultTitle={title}
            defaultDescription={shortDescription || description.slice(0, 160)}
            pathPrefix="/products"
            slug={slug}
            title={seoTitle}
            onTitleChange={setSeoTitle}
            description={seoDescription}
            onDescriptionChange={setSeoDescription}
          />
        </div>

        {/* Right Column (1 span): Status, Organization, Returns */}
        <div className="flex flex-col gap-6">
          {/* Status & Visibility Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Status & Visibility</CardTitle>
              <CardDescription>Control how and where this product is listed.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="product-status">Product Status</FieldLabel>
                <div id="product-status" className="grid grid-cols-2 gap-2">
                  {(["draft", "active", "unlisted", "archived"] as const).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant={status === s ? "default" : "outline"}
                      size="sm"
                      className="capitalize text-xs"
                      onClick={() => setStatus(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
                {status === "unlisted" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Unlisted products are reachable only by direct URL link; hidden from catalog lists, search, and sitemap.
                  </p>
                )}
                {(status === "active" || status === "unlisted") && !primaryCategoryId && (
                  <p className="text-xs text-destructive mt-1">
                    A primary category is required to publish or list this product.
                  </p>
                )}
              </div>

              <Field orientation="horizontal" className="justify-between border-t border-border pt-3">
                <div>
                  <FieldLabel htmlFor="is-featured" className="cursor-pointer font-medium text-sm">
                    Featured product
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Highlight this product on the home page and featured grids.
                  </p>
                </div>
                <Switch
                  id="is-featured"
                  checked={isFeatured}
                  onCheckedChange={(c) => setIsFeatured(Boolean(c))}
                />
              </Field>
            </CardContent>
          </Card>

          {/* Organization Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Organization</CardTitle>
              <CardDescription>Primary category, extra categories, brand, and collections.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/* Primary Category */}
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="primary-category">
                  Primary Category <span className="text-destructive">*</span>
                </FieldLabel>
                <SimpleSelect
                  id="primary-category"
                  value={primaryCategoryId}
                  onChange={(val) => {
                    setPrimaryCategoryId(val);
                    setExtraCategoryIds((prev) => prev.filter((id) => id !== val));
                  }}
                  options={[
                    { value: "", label: "Select primary category..." },
                    ...categories.map((c) => ({
                      value: c.id,
                      label: c.path ? `${c.path} (${c.name})` : c.name,
                    })),
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  Used as the main navigation breadcrumb and primary canonical taxonomy.
                </p>
                {err("primaryCategory")}
              </div>

              {/* Extra Categories */}
              <div className="grid gap-1.5 border-t border-border pt-3">
                <FieldLabel>Additional Categories</FieldLabel>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Optional extra categories this product also belongs to.
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 grid gap-2">
                  {categories
                    .filter((c) => c.id !== primaryCategoryId)
                    .map((c) => {
                      const checked = extraCategoryIds.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setExtraCategoryIds((prev) => [...prev, c.id]);
                              } else {
                                setExtraCategoryIds((prev) => prev.filter((id) => id !== c.id));
                              }
                            }}
                            className="rounded border-border text-primary focus:ring-primary"
                          />
                          <span className="truncate">{c.path ? `${c.path} (${c.name})` : c.name}</span>
                        </label>
                      );
                    })}
                  {categories.filter((c) => c.id !== primaryCategoryId).length === 0 && (
                    <span className="text-xs text-muted-foreground">No additional categories</span>
                  )}
                </div>
              </div>

              {/* Brand */}
              <div className="grid gap-1.5 border-t border-border pt-3">
                <FieldLabel htmlFor="product-brand">Brand</FieldLabel>
                <SimpleSelect
                  id="product-brand"
                  value={brandId}
                  onChange={(val) => setBrandId(val)}
                  options={[
                    { value: "", label: "No brand" },
                    ...brands.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
              </div>

              {/* Collections */}
              <div className="grid gap-1.5 border-t border-border pt-3">
                <FieldLabel>Manual Collections</FieldLabel>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Assign this product to specific curated collections.
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 grid gap-2">
                  {collections
                    .filter((c) => c.type === "manual")
                    .map((c) => {
                      const checked = collectionIds.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCollectionIds((prev) => [...prev, c.id]);
                              } else {
                                setCollectionIds((prev) => prev.filter((id) => id !== c.id));
                              }
                            }}
                            className="rounded border-border text-primary focus:ring-primary"
                          />
                          <span className="truncate">{c.title}</span>
                        </label>
                      );
                    })}
                  {collections.filter((c) => c.type === "manual").length === 0 && (
                    <span className="text-xs text-muted-foreground">No manual collections</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Returns & Policy Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Returns & Policy</CardTitle>
              <CardDescription>Determine whether customers can request returns.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="returnable-switch" className="cursor-pointer font-medium text-sm">
                    Returnable item
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    {returnable
                      ? "Eligible for standard return requests per store return policy."
                      : "Final sale · Customers cannot request a return for this item."}
                  </p>
                </div>
                <Switch
                  id="returnable-switch"
                  checked={returnable}
                  onCheckedChange={(c) => setReturnable(Boolean(c))}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      </form>
    </PageContainer>
  );
}

export default NewProductPage;
