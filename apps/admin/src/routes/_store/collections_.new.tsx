import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Boxes,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SeoCard } from "../../components/seo-card.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

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
  const [sortOrder, setSortOrder] = useState("manual");
  const [published, setPublished] = useState(true);
  const [indexable, setIndexable] = useState(false); // DEFAULT FALSE (Owner Decision)

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

  // Media upload
  const requestUpload = useMutation(orpc.admin.media.requestUpload.mutationOptions());
  const createMedia = useMutation(orpc.admin.media.create.mutationOptions());

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const descriptor = await requestUpload.mutateAsync({
        filename: file.name,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        folder: "collections",
      });

      const res = await fetch(descriptor.uploadUrl, {
        method: "PUT",
        headers: descriptor.headers,
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);

      const created = await createMedia.mutateAsync({
        storageKey: descriptor.storageKey,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        alt: title || "Collection image",
        folder: "collections",
      });

      setImageMediaId(created.id);
      setImageUrl(URL.createObjectURL(file));
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(errorMessage(err, "Image upload failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const createMutation = useMutation(
    orpc.admin.collections.create.mutationOptions({
      onSuccess: () => {
        toast.success("Collection created");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.stats.key() });
        void navigate({ to: "/collections" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create collection"));
      },
    }),
  );

  const addRule = () => {
    setRules((prev) => [...prev, { field: "tag", operator: "equals", value: "" }]);
  };

  const removeRule = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRule = (idx: number, patch: Partial<CollectionRule>) => {
    setRules((prev) =>
      prev.map((r, i) => (i === idx ? ({ ...r, ...patch } as CollectionRule) : r)),
    );
  };

  const addProduct = (productId: string) => {
    if (!productIds.includes(productId)) {
      setProductIds((prev) => [...prev, productId]);
    }
  };

  const removeProduct = (productId: string) => {
    setProductIds((prev) => prev.filter((id) => id !== productId));
  };

  const moveProductOrder = (index: number, delta: number) => {
    setProductIds((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(target, 0, moved);
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
      sortOrder: sortOrder as any,
      published,
      indexable, // Respects "Allow search engines to index this page"
      seo:
        seoTitle.trim() || seoDescription.trim()
          ? {
              title: seoTitle.trim() || null,
              description: seoDescription.trim() || null,
            }
          : undefined,
      productIds: type === "manual" ? productIds : undefined,
    });
  };

  return (
    <PageContainer size="default">
      <PageBreadcrumbs
        items={[
          { label: "Collections", href: "/collections" },
          { label: "New collection" },
        ]}
      />

      <PageHeader
        title="Create collection"
        description="Build a curated or dynamic product showcase page."
        aside={
          <div className="flex items-center gap-2">
            <Button render={<Link to="/collections" />} variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Cancel
            </Button>
            <Button
              type="submit"
              form="collection-form"
              size="sm"
              disabled={createMutation.isPending || uploading}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {createMutation.isPending ? "Saving..." : "Save Collection"}
            </Button>
          </div>
        }
      />

      <form id="collection-form" onSubmit={handleSubmit} className="grid gap-6">
        {/* General Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">General Information</CardTitle>
            <CardDescription>Title, handle, and default sorting for this collection.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="col-title">Title *</FieldLabel>
              <Input
                id="col-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slug || slug === title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")) {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
                  }
                }}
                placeholder="e.g. Summer Essentials, Mechanical Keyboards"
                required
              />
              {errors["title"] && <p className="text-xs text-destructive">{errors["title"]}</p>}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="col-sort">Default sort order</FieldLabel>
              <SimpleSelect
                value={sortOrder}
                options={SORT_OPTIONS}
                onChange={(val: string) => setSortOrder(val)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Collection Image */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Collection Image</CardTitle>
            <CardDescription>Hero banner or header image for this collection.</CardDescription>
          </CardHeader>
          <CardContent>
            {imageUrl ? (
              <div className="relative inline-block overflow-hidden rounded-lg border border-border">
                <img src={imageUrl} alt="Collection preview" className="size-32 object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setImageMediaId(null);
                    setImageUrl(null);
                  }}
                  className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black"
                  aria-label="Remove image"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
                <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
                <p className="mt-2 text-sm font-medium">Upload collection image</p>
                <p className="text-xs text-muted-foreground">PNG, JPG, WebP up to 5MB</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="mt-4"
                >
                  <Upload className="mr-1.5 size-3.5" />
                  {uploading ? "Uploading..." : "Select image"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Collection Type: Manual vs Automated */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Collection Type</CardTitle>
            <CardDescription>Choose how products are added to this collection.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <RadioGroup
              value={type}
              onValueChange={(val) => setType(val as "manual" | "automated")}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="flex items-start space-x-3 rounded-lg border border-border p-4 hover:bg-muted/30">
                <RadioGroupItem value="manual" id="type-manual" className="mt-1" />
                <label htmlFor="type-manual" className="cursor-pointer space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Boxes className="size-4 text-muted-foreground" />
                    Manual
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Add products one by one and drag them into any custom order.
                  </p>
                </label>
              </div>

              <div className="flex items-start space-x-3 rounded-lg border border-border p-4 hover:bg-muted/30">
                <RadioGroupItem value="automated" id="type-automated" className="mt-1" />
                <label htmlFor="type-automated" className="cursor-pointer space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Zap className="size-4 text-purple-600 dark:text-purple-400" />
                    Automated
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Existing and future products that match your condition rules will automatically be included.
                  </p>
                </label>
              </div>
            </RadioGroup>

            {/* Condition Builder for Automated */}
            {type === "automated" && (
              <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Conditions</h4>
                  <div className="flex items-center gap-2 text-xs">
                    <span>Products must match:</span>
                    <RadioGroup
                      value={match}
                      onValueChange={(val) => setMatch(val as "all" | "any")}
                      className="flex items-center gap-4"
                    >
                      <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="all" id="match-all" />
                        <label htmlFor="match-all" className="cursor-pointer">All conditions</label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="any" id="match-any" />
                        <label htmlFor="match-any" className="cursor-pointer">Any condition</label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>

                <div className="space-y-3">
                  {rules.map((rule, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2">
                      <div className="w-36">
                        <SimpleSelect
                          value={rule.field}
                          options={RULE_FIELDS}
                          onChange={(val: string) => updateRule(idx, { field: val as any })}
                        />
                      </div>
                      <div className="w-36">
                        <SimpleSelect
                          value={rule.operator}
                          options={RULE_OPERATORS}
                          onChange={(val: string) => updateRule(idx, { operator: val as any })}
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
                          className="size-9 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addRule}
                    className="mt-2"
                  >
                    <Plus className="mr-1.5 size-3.5" />
                    Add another condition
                  </Button>
                </div>
              </div>
            )}

            {/* Product Picker for Manual */}
            {type === "manual" && (
              <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="text-sm font-semibold">Products in collection ({productIds.length})</h4>

                {/* Product Search Bar */}
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search catalog to add products..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>

                {/* Search Results Dropdown / Picker List */}
                {productSearch.trim() && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-2">
                    {availableProducts.length === 0 ? (
                      <p className="p-2 text-xs text-muted-foreground">No products found</p>
                    ) : (
                      availableProducts.map((p) => {
                        const isAdded = productIds.includes(p.id);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between p-1.5 hover:bg-muted rounded"
                          >
                            <span className="text-sm truncate">{p.title}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant={isAdded ? "ghost" : "outline"}
                              disabled={isAdded}
                              onClick={() => addProduct(p.id)}
                            >
                              {isAdded ? "Added" : "Add"}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Selected Products List */}
                {productIds.length > 0 && (
                  <div className="divide-y divide-border rounded-md border border-border bg-background">
                    {productIds.map((pId, idx) => (
                      <div key={pId} className="flex items-center justify-between p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                          <span className="text-sm font-medium">Product ID: {pId.slice(0, 8)}...</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveProductOrder(idx, -1)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={idx === productIds.length - 1}
                            onClick={() => moveProductOrder(idx, 1)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeProduct(pId)}
                            className="rounded p-1 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Visibility */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Publishing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <FieldLabel htmlFor="col-published">Active (Published)</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Draft collections are hidden from the storefront.
                </p>
              </div>
              <Switch
                id="col-published"
                checked={published}
                onCheckedChange={(c) => setPublished(c)}
              />
            </div>
          </CardContent>
        </Card>

        {/* SEO Card with the mandatory "Allow search engines to index this page" switch (off by default) */}
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
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <FieldLabel htmlFor="col-indexable">Allow search engines to index this page</FieldLabel>
              <p className="text-xs text-muted-foreground">
                When disabled, search engines will be served a <code>noindex</code> tag and this collection will be excluded from your sitemap.
              </p>
            </div>
            <Switch
              id="col-indexable"
              checked={indexable}
              onCheckedChange={(c) => setIndexable(c)}
            />
          </div>
        </SeoCard>
      </form>
    </PageContainer>
  );
}
