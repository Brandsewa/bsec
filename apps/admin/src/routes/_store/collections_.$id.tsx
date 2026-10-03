import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { useEffect, useRef, useState } from "react";
import { DetailSkeleton, EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionDetail, CollectionRule } from "@bs/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { SeoCard } from "../../components/seo-card.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/collections_/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditCollectionPage,
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

export function EditCollectionPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const collectionQuery = useQuery(orpc.admin.collections.get.queryOptions({ input: { id } }));
  const collection = collectionQuery.data;

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"manual" | "automated">("manual");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [sortOrder, setSortOrder] = useState("manual");
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
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  useEffect(() => {
    if (collection) {
      setTitle(collection.title);
      setSlug(collection.slug);
      setDescription(collection.description ?? "");
      setType(collection.type);
      setMatch(collection.match ?? "all");
      setSortOrder(collection.sortOrder ?? "manual");
      setPublished(collection.published);
      setIndexable(collection.indexable);
      setImageMediaId(collection.imageMediaId ?? null);
      setImageUrl(collection.imageUrl ?? null);
      setSeoTitle(collection.seo?.title ?? "");
      setSeoDescription(collection.seo?.description ?? "");
      if (collection.rules && Array.isArray(collection.rules) && collection.rules.length > 0) {
        setRules(collection.rules);
      }
      setProductIds(collection.productIds ?? []);
    }
  }, [collection]);

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

  const updateMutation = useMutation(
    orpc.admin.collections.update.mutationOptions({
      onSuccess: () => {
        toast.success("Collection updated");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.get.key({ input: { id } }) });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update collection"));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.collections.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Collection deleted");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.stats.key() });
        void navigate({ to: "/collections" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete collection"));
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
    setProductIds((prev) => prev.filter((pid) => pid !== productId));
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

    updateMutation.mutate({
      id,
      title: title.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() ? description.trim() : null,
      imageMediaId: imageMediaId || null,
      type,
      match,
      rules: type === "automated" ? rules : null,
      sortOrder: sortOrder as any,
      published,
      indexable, // SEO indexing toggle
      seo:
        seoTitle.trim() || seoDescription.trim()
          ? {
              title: seoTitle.trim() || null,
              description: seoDescription.trim() || null,
            }
          : null,
      productIds: type === "manual" ? productIds : undefined,
    });
  };

  if (collectionQuery.isLoading) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }

  if (collectionQuery.isError || !collection) {
    return (
      <PageContainer size="default">
        <EmptyState
          title="Collection not found"
          description={collectionQuery.error?.message ?? "The requested collection does not exist."}
          action={
            <Button render={<Link to="/collections" />} variant="outline">
              Back to collections
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer size="default">
      <PageBreadcrumbs
        items={[
          { label: "Collections", href: "/collections" },
          { label: collection.title },
        ]}
      />

      <PageHeader
        title={collection.title}
        description={`ID: ${collection.id}`}
        actions={
          <div className="flex items-center gap-2">
            <Button render={<Link to="/collections" />} variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Back
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 size-3.5" aria-hidden />
              Delete
            </Button>
            <Button
              type="submit"
              form="edit-collection-form"
              size="sm"
              disabled={updateMutation.isPending || uploading}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        }
      />

      <form id="edit-collection-form" onSubmit={handleSubmit} className="grid gap-6">
        {/* General Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">General Information</CardTitle>
            <CardDescription>Title, handle, and description for this collection.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="col-title">Title *</FieldLabel>
              <Input
                id="col-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer Essentials, Mechanical Keyboards"
                required
              />
              {errors["title"] && <p className="text-xs text-destructive">{errors["title"]}</p>}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="col-desc">Description</FieldLabel>
              <Textarea
                id="col-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Summary description shown on the collection page..."
              />
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="col-sort">Default sort order</FieldLabel>
              <SimpleSelect
                value={sortOrder}
                options={SORT_OPTIONS}
                onValueChange={(val) => setSortOrder(val)}
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
                <RadioGroupItem value="manual" id="edit-type-manual" className="mt-1" />
                <label htmlFor="edit-type-manual" className="cursor-pointer space-y-1">
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
                <RadioGroupItem value="automated" id="edit-type-automated" className="mt-1" />
                <label htmlFor="edit-type-automated" className="cursor-pointer space-y-1">
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
                        <RadioGroupItem value="all" id="edit-match-all" />
                        <label htmlFor="edit-match-all" className="cursor-pointer">All conditions</label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="any" id="edit-match-any" />
                        <label htmlFor="edit-match-any" className="cursor-pointer">Any condition</label>
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
                          onValueChange={(val) => updateRule(idx, { field: val })}
                        />
                      </div>
                      <div className="w-36">
                        <SimpleSelect
                          value={rule.operator}
                          options={RULE_OPERATORS}
                          onValueChange={(val) => updateRule(idx, { operator: val })}
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

        {/* SEO Card with the "Allow search engines to index this page" switch */}
        <SeoCard
          defaultTitle={title}
          defaultDescription={description}
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

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Collection?"
        description={`Are you sure you want to delete collection "${collection.title}"? Products in this collection will not be deleted.`}
        confirmLabel="Delete Collection"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id })}
      />
    </PageContainer>
  );
}
