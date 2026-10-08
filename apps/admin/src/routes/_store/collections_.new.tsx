import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Boxes,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionRule } from "@bs/contracts";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { RadioGroup, RadioGroupItem } from "@bs/ui";
import { Switch } from "@bs/ui";
import { SeoCard } from "../../components/seo-card.tsx";
import { SimpleSelect } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";
import { uploadMedia } from "../../lib/upload-media.ts";

export const Route = createFileRoute("/_store/collections_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateCollectionPage,
});

const SORT_OPTIONS = [
  { value: "manual", label: "Manually" },
  { value: "best_selling", label: "Best selling" },
  { value: "title_asc", label: "Alphabetically (A-Z)" },
  { value: "title_desc", label: "Alphabetically (Z-A)" },
  { value: "price_asc", label: "Price (low to high)" },
  { value: "price_desc", label: "Price (high to low)" },
  { value: "created_desc", label: "Date: Newest first" },
  { value: "created_asc", label: "Date: Oldest first" },
];

const RULE_FIELDS = [
  { value: "title", label: "Product title" },
  { value: "product_type", label: "Product type" },
  { value: "tag", label: "Product tag" },
  { value: "brand", label: "Brand" },
  { value: "category", label: "Category" },
  { value: "price", label: "Price (paise/inr)" },
  { value: "in_stock", label: "In stock" },
];

const RULE_OPERATORS = [
  { value: "equals", label: "is equal to" },
  { value: "not_equals", label: "is not equal to" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

export function CreateCollectionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<"manual" | "automated">("manual");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [sortOrder, setSortOrder] = useState<
    "manual" | "best_selling" | "title_asc" | "title_desc" | "price_asc" | "price_desc" | "created_desc" | "created_asc"
  >("manual");
  const [published, setPublished] = useState(true);
  const [indexable, setIndexable] = useState(false);

  // Media
  const [imageMediaId, setImageMediaId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // SEO state
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  // Automated condition builder rules
  const [rules, setRules] = useState<CollectionRule[]>([
    { field: "tag", operator: "equals", value: "" },
  ]);

  // Manual product picker state
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const productsQuery = useQuery({
    ...orpc.admin.products.list.queryOptions({
      input: {
        search: productSearch.trim() || undefined,
        limit: 20,
      },
    }),
  });
  const availableProducts = productsQuery.data?.items ?? [];

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Mutations
  const createMutation = useMutation(
    orpc.admin.collections.create.mutationOptions({
      onSuccess: () => {
        toast.success("Collection created successfully");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() });
        void navigate({ to: "/collections" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create collection"));
      },
    }),
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const media = await uploadMedia(file, {
        folder: "collections",
        alt: title.trim() || "Collection image",
      });

      setImageMediaId(media.id);
      setImageUrl(media.url ?? URL.createObjectURL(file));
      toast.success("Image uploaded successfully");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to upload image"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addRule = () => {
    setRules((prev) => [...prev, { field: "tag", operator: "equals", value: "" }]);
  };

  const updateRule = (index: number, patch: Partial<CollectionRule>) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  const addProduct = (productId: string) => {
    if (!productIds.includes(productId)) {
      setProductIds((prev) => [...prev, productId]);
    }
  };

  const removeProduct = (productId: string) => {
    setProductIds((prev) => prev.filter((id) => id !== productId));
  };

  const moveProduct = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= productIds.length) return;
    setProductIds((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      if (item) next.splice(toIndex, 0, item);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors["title"] = "Collection title is required";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    createMutation.mutate({
      title: title.trim(),
      slug: slug.trim() || undefined,
      imageMediaId: imageMediaId || null,
      type,
      match,
      rules: type === "automated" ? rules : undefined,
      sortOrder,
      published,
      indexable,
      seo:
        seoTitle.trim() || seoDescription.trim()
          ? {
              title: seoTitle.trim() || undefined,
              description: seoDescription.trim() || undefined,
            }
          : undefined,
      productIds: type === "manual" ? productIds : undefined,
    });
  };

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[
          { label: "Collections", href: "/collections" },
          { label: "New Collection" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/collections" })}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Collections
            </Button>
            <Button
              type="submit"
              form="create-collection-form"
              size="sm"
              disabled={createMutation.isPending}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {createMutation.isPending ? "Saving..." : "Save Collection"}
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Create Collection"
        description="Group products manually or create automated condition rules to build merchandising pages."
      />

      <form id="create-collection-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6" noValidate>
        {/* Left 2 Columns: Main Details, Type, Rules/Picker, SEO */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">General Information</CardTitle>
              <CardDescription>Title and optional custom handle.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="col-title">Title *</FieldLabel>
                <Input
                  id="col-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Summer Essentials"
                  aria-invalid={Boolean(errors["title"])}
                />
                {errors["title"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors["title"]}
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="col-slug">URL Handle (Slug)</FieldLabel>
                <Input
                  id="col-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. summer-essentials"
                />
              </div>
            </CardContent>
          </Card>

          {/* Collection Type Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Collection Type</CardTitle>
              <CardDescription>Choose how products are added to this collection.</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={type}
                onValueChange={(val: string) => setType(val as "manual" | "automated")}
                className="grid gap-4"
              >
                <label
                  htmlFor="create-type-manual"
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                    type === "manual" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="manual" id="create-type-manual" className="mt-1" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Boxes className="size-4 text-muted-foreground" aria-hidden />
                      Manual Collection
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Add products to this collection one by one and custom order them.
                    </p>
                  </div>
                </label>

                <label
                  htmlFor="create-type-auto"
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                    type === "automated" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="automated" id="create-type-auto" className="mt-1" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Zap className="size-4 text-muted-foreground" aria-hidden />
                      Automated Collection
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Existing and future products matching conditions will be automatically added.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Type-Specific Builder: Manual Picker or Automated Condition Builder */}
          {type === "manual" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Product Assignments</CardTitle>
                <CardDescription>Search and select products included in this collection.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products to add..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {productSearch.trim() && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 space-y-1">
                    {availableProducts.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground">No matching products found</div>
                    ) : (
                      availableProducts.map((p) => {
                        const isSelected = productIds.includes(p.id);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded p-2 text-sm hover:bg-muted/50"
                          >
                            <span className="truncate">{p.title}</span>
                            <Button
                              type="button"
                              variant={isSelected ? "secondary" : "outline"}
                              size="sm"
                              disabled={isSelected}
                              onClick={() => addProduct(p.id)}
                            >
                              {isSelected ? "Added" : "Add"}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                    Selected Products ({productIds.length})
                  </div>
                  {productIds.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      No products added yet. Use the search above to pick products.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {productIds.map((pid, idx) => {
                        const prod = availableProducts.find((p) => p.id === pid);
                        return (
                          <div
                            key={pid}
                            className="flex items-center justify-between rounded-md border border-border bg-card p-2 text-sm"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <GripVertical className="size-4 text-muted-foreground cursor-grab" />
                              <span className="text-xs font-mono text-muted-foreground">{idx + 1}.</span>
                              <span className="truncate font-medium">{prod?.title ?? pid}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={idx === 0}
                                onClick={() => moveProduct(idx, idx - 1)}
                              >
                                ↑
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={idx === productIds.length - 1}
                                onClick={() => moveProduct(idx, idx + 1)}
                              >
                                ↓
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeProduct(pid)}
                              >
                                <X className="size-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Conditions</CardTitle>
                <CardDescription>Products must match these criteria to be included.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">Products must match:</span>
                  <RadioGroup
                    value={match}
                    onValueChange={(val: string) => setMatch(val as "all" | "any")}
                    className="flex items-center gap-4"
                  >
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="all" id="create-match-all" />
                      <label htmlFor="create-match-all" className="cursor-pointer">All conditions</label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="any" id="create-match-any" />
                      <label htmlFor="create-match-any" className="cursor-pointer">Any condition</label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  {rules.map((rule, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2">
                      <div className="w-36">
                        <SimpleSelect
                          value={rule.field}
                          options={RULE_FIELDS}
                          onChange={(val: string) => updateRule(idx, { field: val as CollectionRule["field"] })}
                        />
                      </div>
                      <div className="w-36">
                        <SimpleSelect
                          value={rule.operator}
                          options={RULE_OPERATORS}
                          onChange={(val: string) => updateRule(idx, { operator: val as CollectionRule["operator"] })}
                        />
                      </div>
                      {!["is_set", "is_not_set"].includes(rule.operator) && (
                        <Input
                          placeholder="Condition value"
                          value={String(rule.value ?? "")}
                          onChange={(e) => updateRule(idx, { value: e.target.value })}
                          className="flex-1 min-w-[140px]"
                        />
                      )}
                      {rules.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRule(idx)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}

                  <Button type="button" variant="outline" size="sm" onClick={addRule}>
                    <Plus className="mr-1.5 size-3.5" />
                    Add another condition
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search Engine Optimization Card (Configurable Indexing) */}
          <SeoCard
            defaultTitle={title}
            pathPrefix="/collections"
            slug={slug}
            onSlugChange={setSlug}
            title={seoTitle}
            onTitleChange={setSeoTitle}
            description={seoDescription}
            onDescriptionChange={setSeoDescription}
          >
            <div className="border-t border-border pt-4">
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {indexable ? (
                      <Eye className="size-4 text-emerald-600" aria-hidden />
                    ) : (
                      <EyeOff className="size-4 text-amber-600" aria-hidden />
                    )}
                    <FieldLabel htmlFor="create-indexable-switch" className="cursor-pointer font-medium text-sm">
                      Allow search engines to index this collection page
                    </FieldLabel>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {indexable
                      ? "Search engines are allowed to crawl, index, and surface this collection in search results."
                      : "Served with 'noindex, follow' and omitted from sitemap.xml. Useful for seasonal or temporary merchandising."}
                  </p>
                </div>
                <Switch
                  id="create-indexable-switch"
                  checked={indexable}
                  onCheckedChange={(c) => setIndexable(Boolean(c))}
                />
              </Field>
            </div>
          </SeoCard>
        </div>

        {/* Right 1 Column: Image, Sort Order, Status */}
        <div className="flex flex-col gap-6">
          {/* Collection Image */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Featured Image</CardTitle>
              <CardDescription>Hero banner or tile image for this collection.</CardDescription>
            </CardHeader>
            <CardContent>
              {imageUrl ? (
                <div className="relative inline-block overflow-hidden rounded-lg border border-border">
                  <img src={imageUrl} alt={title} className="h-40 w-72 object-cover" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute right-2 top-2 size-7"
                    onClick={() => {
                      setImageMediaId(null);
                      setImageUrl(null);
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
                  <ImageIcon className="size-8 text-muted-foreground mb-2" aria-hidden />
                  <p className="text-sm font-medium text-foreground">No image uploaded</p>
                  <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, WebP up to 5MB</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="mr-1.5 size-3.5" aria-hidden />
                    {uploading ? "Uploading..." : "Upload Image"}
                  </Button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </CardContent>
          </Card>

          {/* Sort Order */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Product Sorting</CardTitle>
              <CardDescription>Default display order of products in this collection.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleSelect
                value={sortOrder}
                options={SORT_OPTIONS}
                onChange={(val: string) =>
                  setSortOrder(
                    val as
                      | "manual"
                      | "best_selling"
                      | "title_asc"
                      | "title_desc"
                      | "price_asc"
                      | "price_desc"
                      | "created_desc"
                      | "created_asc",
                  )
                }
              />
            </CardContent>
          </Card>

          {/* Status & Visibility */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Status & Visibility</CardTitle>
              <CardDescription>Control collection visibility in your storefront.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="create-status-switch" className="cursor-pointer font-medium text-sm">
                    Published collection
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Available to customers and visible on your store.
                  </p>
                </div>
                <Switch
                  id="create-status-switch"
                  checked={published}
                  onCheckedChange={(c) => setPublished(Boolean(c))}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      </form>
    </PageContainer>
  );
}
