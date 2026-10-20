import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useState } from "react";
import { PageActions, FormSkeleton, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel, Switch } from "@bs/ui";
import { Input } from "@bs/ui";
import { Textarea } from "@bs/ui";
import { SeoCard } from "../../../components/seo-card.tsx";
import { DraftVariantBuilderCard, defaultDraftVariant, usableOptions, type DraftVariant } from "../../../components/product/draft-variant-builder.tsx";
import { OrganizationCard, PricingQuotesCard, StatusVisibilityCard, type PreorderValue } from "../../../components/product/product-cards.tsx";
import { previewGrid, type DraftOption } from "../../../lib/variant-grid.ts";
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

  const [options, setOptions] = useState<DraftOption[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([defaultDraftVariant()]);
  const [preorder, setPreorder] = useState<PreorderValue>({ enabled: false, shipsOn: "", message: "" });
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

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e["title"] = "Title is required";
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      e["slug"] = "Use lowercase letters, numbers and hyphens only";
    }

    if ((status === "active" || status === "unlisted") && !primaryCategoryId) {
      e["primaryCategory"] = "A primary category is required to publish or list a product";
    }

    const grid = previewGrid(options, []);
    if (grid.error) e["options"] = grid.error;

    const today = new Date().toISOString().slice(0, 10);
    variants.forEach((v, i) => {
      if (!v.sku.trim()) e[`variant-sku-${i}`] = "SKU is required";
      if (!priceOnRequest && (v.price === "" || !Number.isFinite(Number(v.price)) || Number(v.price) < 0)) {
        e[`variant-price-${i}`] = "Enter a valid price";
      }
      if (!priceOnRequest && v.compareAtPrice !== "" && (!Number.isFinite(Number(v.compareAtPrice)) || Number(v.compareAtPrice) < 0)) {
        e[`variant-compare-${i}`] = "Enter a valid compare-at price";
      }
    });
    if (preorder.enabled) {
      if (!preorder.shipsOn) e["preorderShipsOn"] = "Pre-order ship date is required";
      else if (preorder.shipsOn <= today) e["preorderShipsOn"] = "Pre-order ship date must be in the future";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    const cleanOpts = usableOptions(options);
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
      ...(cleanOpts.length > 0 ? { options: cleanOpts } : {}),
      variants: variants.map((v) => ({
        sku: v.sku.trim(),
        title: v.title,
        price: priceOnRequest ? 0 : toPaise(v.price),
        ...(!priceOnRequest && v.compareAtPrice !== "" ? { compareAtPrice: toPaise(v.compareAtPrice) } : {}),
        ...(Object.keys(v.optionValues).length > 0 ? { optionValues: v.optionValues } : {}),
        trackInventory: true,
        allowBackorder: false,
        preorderEnabled: preorder.enabled,
        preorderShipsOn: preorder.enabled ? preorder.shipsOn : null,
        preorderMessage: preorder.enabled && preorder.message.trim() ? preorder.message.trim() : null,
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
      <PageActions>
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
      </PageActions>

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

          <PricingQuotesCard
            priceOnRequest={priceOnRequest}
            onPriceOnRequestChange={setPriceOnRequest}
            preorder={preorder}
            onPreorderChange={setPreorder}
            errors={errors}
          />

          <DraftVariantBuilderCard
            options={options}
            onOptionsChange={setOptions}
            variants={variants}
            onVariantsChange={setVariants}
            priceOnRequest={priceOnRequest}
            errors={errors}
          />

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

        {/* Right Column (1 span): Status, Organization, Returns, Shipping */}
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
        </div>
      </form>
    </PageContainer>
  );
}

export default NewProductPage;
