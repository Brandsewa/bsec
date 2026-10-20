import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Archive, ArrowLeft, Eye, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { DetailSkeleton, EmptyState, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductDetail } from "@bs/contracts";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { Switch } from "@bs/ui";
import { Textarea } from "@bs/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bs/ui";
import { SeoCard } from "../../../components/seo-card.tsx";
import { VariantBuilderCard } from "../../../components/product/variant-builder.tsx";
import { CustomFieldsCard } from "../../../components/product/custom-fields-card.tsx";
import { CopyableId, SimpleSelect } from "@bs/ui";
import { formatProductId } from "@bs/contracts";
import { OrganizationCard, PricingQuotesCard, StatusVisibilityCard, type PreorderValue } from "../../../components/product/product-cards.tsx";
import { storefrontLink, useStorefrontUrl } from "../../../lib/storefront-url.ts";
import { client, orpc } from "../../../lib/orpc.ts";
import { MediaGalleryField } from "../../../components/media/media-gallery-field.tsx";
import type { MediaItem } from "@bs/contracts";

export const Route = createFileRoute("/_store/products/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: ProductDetailRoute,
});

function ProductDetailRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return <ProductDetailPage id={id} navigate={(to) => void navigate({ to })} />;
}


function descriptionText(json: unknown): string {
  if (typeof json === "string") return json;
  if (json && typeof json === "object" && "text" in json && typeof (json as { text: unknown }).text === "string") {
    return (json as { text: string }).text;
  }
  return "";
}

export function ProductDetailPage({ id, navigate }: { id: string; navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const query = useQuery(orpc.admin.products.get.queryOptions({ input: { id } }));

  if (query.isLoading) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }
  if (query.isError || !query.data) {
    return (
      <PageContainer size="default">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load product"
          description={query.error instanceof Error ? query.error.message : "The product could not be found."}
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
              <Button variant="ghost" size="sm" onClick={() => go("/products")}>
                Back to products
              </Button>
            </div>
          }
        />
      </PageContainer>
    );
  }
  return <ProductEditor key={query.data.id} product={query.data} go={go} />;
}

type ProductDetailData = ProductDetail;

function ProductEditor({ product, go }: { product: ProductDetailData; go: (to: string) => void }) {
  const queryClient = useQueryClient();

  // Queries for selectors
  const categoriesQuery = useQuery(orpc.admin.categories.list.queryOptions({ input: { status: "all" } }));
  const brandsQuery = useQuery(orpc.admin.brands.list.queryOptions());
  const collectionsQuery = useQuery(orpc.admin.collections.list.queryOptions({ input: { status: "all" } }));
  const taxClassesQuery = useQuery(orpc.admin.taxClasses.list.queryOptions({}));

  const categories = categoriesQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const collections = collectionsQuery.data ?? [];
  const taxClasses = taxClassesQuery.data ?? [];

  // Form State
  const [title, setTitle] = useState(product.title);
  const [slug, setSlug] = useState(product.slug);
  const [status, setStatus] = useState<"draft" | "active" | "unlisted" | "archived">(product.status);
  const [shortDescription, setShortDescription] = useState(product.shortDescription ?? "");
  const [description, setDescription] = useState(descriptionText(product.descriptionJson));
  const [tags, setTags] = useState(product.tags.join(", "));
  const [requiresShipping, setRequiresShipping] = useState(product.requiresShipping);
  const [priceOnRequest, setPriceOnRequest] = useState(Boolean(product.priceOnRequest));
  const [returnable, setReturnable] = useState(product.returnable ?? true);
  const [isFeatured, setIsFeatured] = useState(product.isFeatured ?? false);
  const [taxClassId, setTaxClassId] = useState<string>(product.taxClassId ?? "");
  const [hsn, setHsn] = useState<string>(product.hsn ?? "");

  // Organization
  const [primaryCategoryId, setPrimaryCategoryId] = useState<string>(product.primaryCategoryId ?? "");
  const [extraCategoryIds, setExtraCategoryIds] = useState<string[]>(product.extraCategoryIds ?? []);
  const [brandId, setBrandId] = useState<string>(product.brandId ?? "");
  const [collectionIds, setCollectionIds] = useState<string[]>(product.collectionIds ?? []);

  // SEO State
  const initialSeo = (product.seo as { title?: string; description?: string } | null) ?? {};
  const [seoTitle, setSeoTitle] = useState(initialSeo.title ?? "");
  const [seoDescription, setSeoDescription] = useState(initialSeo.description ?? "");

  // Pre-order is stored per variant; this switch sets it on all of them (see PricingQuotesCard).
  const preorderVariants = product.variants.filter((v) => v.preorderEnabled);
  const initialPreorder: PreorderValue = {
    enabled: product.variants.length > 0 && preorderVariants.length === product.variants.length,
    shipsOn: preorderVariants[0]?.preorderShipsOn ?? "",
    message: preorderVariants[0]?.preorderMessage ?? "",
  };
  const mixedPreorder = preorderVariants.length > 0 && preorderVariants.length < product.variants.length;
  const [preorder, setPreorder] = useState<PreorderValue>(initialPreorder);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const storefront = useStorefrontUrl();
  const previewHref = storefrontLink(storefront, `/products/${product.slug}`);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.products.get.key({ input: { id: product.id } }) });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() });
  };

  const updateMutation = useMutation(
    orpc.admin.products.update.mutationOptions({
      onSuccess: () => {
        toast.success("Product saved");
        invalidate();
      },
      onError: (err: Error) => toast.error(err.message || "Failed to save product"),
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.products.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Product deleted");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() });
        setConfirmDelete(false);
        go("/products");
      },
      onError: (err: Error) => toast.error(err.message || "Failed to delete product"),
    }),
  );

  const save = (nextStatus?: "draft" | "active" | "unlisted" | "archived") => {
    const finalStatus = nextStatus ?? status;
    const e: Record<string, string> = {};
    if (!title.trim()) e["title"] = "Title is required";
    if (!slug.trim()) e["slug"] = "Slug is required";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) e["slug"] = "Use lowercase letters, numbers and hyphens only";

    if ((finalStatus === "active" || finalStatus === "unlisted") && !primaryCategoryId) {
      e["primaryCategory"] = "A primary category is required to publish or list a product";
    }

    const preorderChanged =
      preorder.enabled !== initialPreorder.enabled ||
      (preorder.enabled && (preorder.shipsOn !== initialPreorder.shipsOn || preorder.message !== initialPreorder.message));
    if (preorder.enabled && preorderChanged) {
      const today = new Date().toISOString().slice(0, 10);
      if (!preorder.shipsOn) e["preorderShipsOn"] = "Pre-order ship date is required";
      else if (preorder.shipsOn !== initialPreorder.shipsOn && preorder.shipsOn <= today) e["preorderShipsOn"] = "Pre-order ship date must be in the future";
    }

    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }

    if (nextStatus) setStatus(nextStatus);

    const applyPreorder = async () => {
      if (!preorderChanged) return;
      await Promise.all(
        product.variants.map((v) =>
          client.admin.variants.update({
            id: v.id,
            preorderEnabled: preorder.enabled,
            preorderShipsOn: preorder.enabled ? preorder.shipsOn || null : null,
            preorderMessage: preorder.enabled ? preorder.message.trim() || null : null,
          }),
        ),
      );
    };

    updateMutation.mutate({
      id: product.id,
      title: title.trim(),
      slug: slug.trim(),
      status: finalStatus,
      shortDescription: shortDescription.trim(),
      descriptionJson: { type: "text", text: description.trim() },
      tags: tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      requiresShipping,
      priceOnRequest,
      returnable,
      isFeatured,
      taxClassId: taxClassId || null,
      hsn: hsn.trim() || null,
      primaryCategoryId: primaryCategoryId || null,
      extraCategoryIds: extraCategoryIds.filter((cid) => cid !== primaryCategoryId),
      brandId: brandId || null,
      collectionIds,
      seo: {
        title: seoTitle.trim() || undefined,
        description: seoDescription.trim() || undefined,
      },
    }, {
      onSuccess: () => {
        void applyPreorder()
          .then(invalidate)
          .catch((err: Error) => toast.error(err.message || "Saved, but the pre-order settings could not be applied"));
      },
    });
  };

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  const statusBadgeColor =
    product.status === "active"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : product.status === "unlisted"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : product.status === "archived"
          ? "bg-muted text-muted-foreground border-border"
          : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";

  return (
    <PageContainer size="full">
      <PageHeader
        meta={formatProductId(product.productNumber) ? <CopyableId value={formatProductId(product.productNumber) as string} /> : undefined}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {product.title}
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${statusBadgeColor}`}>
              {product.status}
            </span>
          </span>
        }
        aside={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go("/products")}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Products
            </Button>
            {previewHref ? (
              product.status === "active" || product.status === "unlisted" ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={previewHref} target="_blank" rel="noopener noreferrer">
                    <Eye className="mr-1.5 size-3.5" aria-hidden />
                    Preview
                  </a>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled title="Only active or unlisted products can be viewed on the storefront">
                  <Eye className="mr-1.5 size-3.5" aria-hidden />
                  Preview
                </Button>
              )
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={product.status === "archived" || updateMutation.isPending}
              onClick={() => save("archived")}
            >
              <Archive className="mr-1.5 size-3.5" aria-hidden />
              Archive
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1.5 size-3.5" aria-hidden />
              Delete
            </Button>
            <Button type="button" variant="default" size="sm" disabled={updateMutation.isPending} onClick={() => save()}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        }
      />

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        noValidate
      >
        {/* Left Column (2 spans): Primary details, media, pricing, variants, custom fields, SEO */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* General Information Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">General Information</CardTitle>
              <CardDescription>Title, handle, and product descriptions.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-title">Title *</FieldLabel>
                <Input
                  id="edit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={Boolean(errors["title"])}
                />
                {err("title")}
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-slug">URL Handle (Slug) *</FieldLabel>
                <Input
                  id="edit-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  aria-invalid={Boolean(errors["slug"])}
                />
                {err("slug")}
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-short">Short Description</FieldLabel>
                <Input
                  id="edit-short"
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  placeholder="Brief summary used in cards and search engine snippets..."
                />
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-desc">Description</FieldLabel>
                <Textarea
                  id="edit-desc"
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed product story, specifications, and care instructions..."
                />
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-tags">Tags</FieldLabel>
                <Input
                  id="edit-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Comma separated, e.g. silk, festive, bestseller"
                />
              </div>
            </CardContent>
          </Card>

          {/* Media Section */}
          <MediaSection product={product} />

          <PricingQuotesCard
            priceOnRequest={priceOnRequest}
            onPriceOnRequestChange={setPriceOnRequest}
            preorder={preorder}
            onPreorderChange={setPreorder}
            mixedPreorder={mixedPreorder}
            errors={errors}
          />

          {/* Variants Section */}
          <VariantBuilderCard
            product={product}
            priceOnRequest={priceOnRequest}
            onChanged={invalidate}
          />

          {/* Custom fields (ADR-034) */}
          <CustomFieldsCard resourceType="product" resourceId={product.id} />

          {/* Search Engine Listing (SEO Card) */}
          <SeoCard
            defaultTitle={title || product.title}
            defaultDescription={shortDescription || description.slice(0, 160)}
            pathPrefix="/products"
            slug={slug}
            title={seoTitle}
            onTitleChange={setSeoTitle}
            description={seoDescription}
            onDescriptionChange={setSeoDescription}
          />
        </div>

        {/* Right Column (1 span): Status, Organization, Returns, Stock, Shipping, Taxes */}
        <div className="flex flex-col gap-6">
          <StatusVisibilityCard
            status={status}
            onStatusChange={setStatus}
            isFeatured={isFeatured}
            onFeaturedChange={setIsFeatured}
            hasPrimaryCategory={Boolean(primaryCategoryId)}
          />

          <OrganizationCard
            categories={categories}
            brands={brands}
            collections={collections}
            primaryCategoryId={primaryCategoryId}
            onPrimaryCategoryChange={setPrimaryCategoryId}
            extraCategoryIds={extraCategoryIds}
            onExtraCategoryIdsChange={setExtraCategoryIds}
            brandId={brandId}
            onBrandChange={setBrandId}
            collectionIds={collectionIds}
            onCollectionIdsChange={setCollectionIds}
            primaryCategoryError={errors["primaryCategory"]}
          />

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

          {/* Stock / Inventory Summary */}
          <StockSummary product={product} onManage={() => go("/inventory")} />

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

          {/* Tax & GST Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Taxes & GST</CardTitle>
              <CardDescription>Tax slab and HSN code for GST invoicing.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="tax-class">Tax Class</FieldLabel>
                <SimpleSelect
                  id="tax-class"
                  value={taxClassId}
                  onChange={(val) => {
                    setTaxClassId(val);
                    const selected = taxClasses.find((tc) => tc.id === val);
                    if (selected?.defaultHsn && !hsn) {
                      setHsn(selected.defaultHsn);
                    }
                  }}
                  options={[
                    { value: "", label: "Default store tax class" },
                    ...taxClasses.map((tc) => ({
                      value: tc.id,
                      label: `${tc.name} (${(tc.rateBps / 100).toFixed(tc.rateBps % 100 === 0 ? 0 : 2)}%)`,
                    })),
                  ]}
                />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="product-hsn">HSN Code</FieldLabel>
                <Input
                  id="product-hsn"
                  value={hsn}
                  onChange={(e) => setHsn(e.target.value)}
                  placeholder="e.g. 61091000"
                  maxLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  4, 6 or 8 digit Harmonised System of Nomenclature code.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>

      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
            <DialogDescription>
              "{product.title}" and its variants will be removed. To hide it from the store without deleting it,
              archive it or set it to draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ id: product.id })}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

/** Current stock of each variant, with a shortcut to the Inventory page where it is changed. */
function StockSummary({ product, onManage }: { product: ProductDetailData; onManage: () => void }) {
  const levels = useQuery(orpc.admin.inventory.list.queryOptions({ input: { search: product.title, limit: 100 } }));
  const variantIds = new Set(product.variants.map((v) => v.id));
  const rows = (levels.data?.items ?? []).filter((r) => variantIds.has(r.variantId));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-semibold">Stock & Inventory</CardTitle>
          <CardDescription>Live stock levels tracked across store locations.</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onManage}>
          Manage inventory
        </Button>
      </CardHeader>
      <CardContent>
        {levels.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading stock...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">This product does not track stock.</p>
        ) : (
          <ul className="grid gap-2 text-sm" data-testid="product-stock">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                <span className="text-foreground">
                  {r.variantTitle ?? r.variantSku} <span className="text-muted-foreground">· {r.locationName}</span>
                </span>
                <span className={r.available > 0 ? "font-medium text-emerald-600" : "font-medium text-destructive"}>
                  {r.available > 0 ? `${r.available} available` : "Out of stock"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MediaSection({ product }: { product: ProductDetailData }) {
  const queryClient = useQueryClient();
  const attachMedia = useMutation(orpc.admin.products.attachMedia.mutationOptions());
  const detachMedia = useMutation(orpc.admin.products.detachMedia.mutationOptions());
  const reorderMedia = useMutation(orpc.admin.products.reorderMedia.mutationOptions());
  const updateMedia = useMutation(orpc.admin.products.updateMedia.mutationOptions());

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.products.get.key({ input: { id: product.id } }) });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() });
  };

  const handleAttach = async (mediaItem: MediaItem) => {
    await attachMedia.mutateAsync({
      id: product.id,
      mediaId: mediaItem.id,
      alt: mediaItem.alt ?? product.title,
    });
    refresh();
  };

  const handleDetach = async (productMediaId: string) => {
    await detachMedia.mutateAsync({
      id: product.id,
      productMediaId,
    });
    refresh();
  };

  const handleReorder = async (order: string[]) => {
    await reorderMedia.mutateAsync({
      id: product.id,
      order,
    });
    refresh();
  };

  const handleAltChange = async (productMediaId: string, alt: string | null) => {
    await updateMedia.mutateAsync({
      id: product.id,
      productMediaId,
      alt,
    });
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Media</CardTitle>
        <CardDescription>
          Images and videos shown on your storefront. The first image is the main card image. Drag to reorder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MediaGalleryField
          value={product.media}
          accept={["image", "video"]}
          max={10}
          onAttach={handleAttach}
          onDetach={handleDetach}
          onReorder={handleReorder}
          onAltChange={handleAltChange}
        />
      </CardContent>
    </Card>
  );
}
