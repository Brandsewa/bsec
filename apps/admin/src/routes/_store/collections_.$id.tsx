import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { PageActions, DetailSkeleton, EmptyState, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionDetail, CollectionRule, RichDescription } from "@bs/contracts";
import { RichDescriptionField } from "../../components/rich-description-field.tsx";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input, InfoTip, Textarea } from "@bs/ui";
import { Switch } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { SeoCard } from "../../components/seo-card.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";
import { CollectionTypeCard, ProductAssignmentsCard, ProductSortingCard, RulesBuilderCard } from "../../components/collection/collection-parts.tsx";
import type { PickedProduct } from "../../components/product/product-picker-dialog.tsx";
import { storefrontLink, useStorefrontUrl } from "../../lib/storefront-url.ts";
import { MediaField } from "../../components/media/media-field.tsx";

export const Route = createFileRoute("/_store/collections_/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditCollectionRoute,
});

function EditCollectionRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return <EditCollectionPage id={id} navigate={(to) => void navigate({ to })} />;
}

export function EditCollectionPage({ id, navigate }: { id: string; navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const collectionQuery = useQuery(orpc.admin.collections.get.queryOptions({ input: { id } }));

  if (collectionQuery.isLoading) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }

  if (collectionQuery.isError || !collectionQuery.data) {
    return (
      <PageContainer size="default">
        <EmptyState
          title="Collection not found"
          description={collectionQuery.error ? errorMessage(collectionQuery.error) : "The requested collection does not exist."}
          action={
            <Button variant="outline" size="sm" onClick={() => go("/collections")}>
              Back to collections
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return <CollectionEditor key={collectionQuery.data.id} collection={collectionQuery.data} go={go} />;
}

function CollectionEditor({ collection, go }: { collection: CollectionDetail; go: (to: string) => void }) {
  const queryClient = useQueryClient();
  const previewHref = storefrontLink(useStorefrontUrl(), `/collections/${collection.slug}`);

  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description ?? "");
  const [descriptionJson, setDescriptionJson] = useState<RichDescription | null>(collection.descriptionJson ?? null);
  const [slug, setSlug] = useState(collection.slug);
  const [type, setType] = useState<"manual" | "automated">(collection.type);
  const [match, setMatch] = useState<"all" | "any">(collection.match ?? "all");
  const [sortOrder, setSortOrder] = useState<
    "manual" | "best_selling" | "title_asc" | "title_desc" | "price_asc" | "price_desc" | "created_desc" | "created_asc"
  >(
    (collection.sortOrder as "manual" | "best_selling" | "title_asc" | "title_desc" | "price_asc" | "price_desc" | "created_desc" | "created_asc") ?? "manual",
  );
  const [published, setPublished] = useState(collection.published);
  const [indexable, setIndexable] = useState(collection.indexable);

  // Media
  const [imageMediaId, setImageMediaId] = useState<string | null>(collection.imageMediaId ?? null);

  // SEO state
  const [seoTitle, setSeoTitle] = useState(collection.seo?.title ?? "");
  const [seoDescription, setSeoDescription] = useState(collection.seo?.description ?? "");

  // Automated condition builder rules
  const [rules, setRules] = useState<CollectionRule[]>(
    collection.rules && collection.rules.length > 0
      ? (collection.rules as CollectionRule[])
      : [{ field: "tag", operator: "equals", value: "" }],
  );

  // Manual product picker state
  const [products, setProducts] = useState<PickedProduct[]>(() => {
    const byId = new Map((collection.products ?? []).map((p) => [p.id, p]));
    return (collection.productIds ?? []).map((id) => byId.get(id) ?? { id, title: "Unknown product" });
  });
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Mutations
  const updateMutation = useMutation(
    orpc.admin.collections.update.mutationOptions({
      onSuccess: () => {
        toast.success("Collection updated");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() });
        go("/collections");
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
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() });
        go("/collections");
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to delete collection"));
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors["title"] = "Collection title is required";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    updateMutation.mutate({
      id: collection.id,
      title: title.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      descriptionJson,
      imageMediaId: imageMediaId || null,
      type,
      match,
      rules: type === "automated" ? rules : null,
      sortOrder,
      published,
      indexable,
      seo:
        seoTitle.trim() || seoDescription.trim()
          ? {
              title: seoTitle.trim() || null,
              description: seoDescription.trim() || null,
            }
          : null,
      productIds: type === "manual" ? products.map((p) => p.id) : undefined,
    });
  };

  return (
    <PageContainer size="full">
      <PageActions>
        <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go("/collections")}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Collections
            </Button>
            {previewHref ? (
              collection.published ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={previewHref} target="_blank" rel="noopener noreferrer">
                    <Eye className="mr-1.5 size-3.5" aria-hidden />
                    Preview
                  </a>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled title="Unpublished collections are hidden from the storefront">
                  <Eye className="mr-1.5 size-3.5" aria-hidden />
                  Preview
                </Button>
              )
            ) : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-1.5 size-3.5" aria-hidden />
              Delete
            </Button>
            <Button
              type="submit"
              form="collection-form"
              size="sm"
              disabled={updateMutation.isPending}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
      </PageActions>

      <PageHeader
        title={collection.title}
        description="Configure collection type, product assignments, sorting rules, and search engine indexing."
      />

      <form id="collection-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6" noValidate>
        {/* Left 2 Columns: Main Details, Type, Rules/Picker, SEO */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">General Information</CardTitle>
              <CardDescription>Title and optional custom handle.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-title">Title *</FieldLabel>
                <Input
                  id="edit-title"
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
                <FieldLabel htmlFor="edit-description" className="flex items-center gap-1.5">
                  Short description
                  <InfoTip>Plain-text blurb shown under the collection title, on collection cards and on the collections page (two lines on cards). Up to 300 characters.</InfoTip>
                </FieldLabel>
                <Textarea
                  id="edit-description"
                  rows={3}
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Hand-made chilli pastes and oils from the Darjeeling hills"
                />
                <p className="text-xs text-muted-foreground">{description.length}/300</p>
              </div>

              <RichDescriptionField id="edit-long-description" value={descriptionJson} onChange={setDescriptionJson} tip="Shown below the products on the collection page, for detail content such as buying guides or care notes. Supports headings, bold, italic, links, lists and dividers." />

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="edit-slug">URL Handle (Slug)</FieldLabel>
                <Input
                  id="edit-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. summer-essentials"
                />
              </div>
            </CardContent>
          </Card>

          <CollectionTypeCard value={type} onChange={setType} noun="collection" idPrefix="edit" />

          {/* Type-specific: manual product picker or automated conditions */}
          {type === "manual" ? (
            <ProductAssignmentsCard products={products} onChange={setProducts} />
          ) : (
            <RulesBuilderCard rules={rules} onRulesChange={setRules} match={match} onMatchChange={setMatch} idPrefix="edit" />
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
                    <FieldLabel htmlFor="edit-indexable-switch" className="cursor-pointer font-medium text-sm">
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
                  id="edit-indexable-switch"
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
              <MediaField
                value={imageMediaId}
                onChange={(id) => setImageMediaId(id)}
                accept={["image"]}
                aspect="16:9"
              />
            </CardContent>
          </Card>

          <ProductSortingCard value={sortOrder} onChange={(val) => setSortOrder(val as typeof sortOrder)} noun="collection" />

          {/* Status & Visibility */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Status & Visibility</CardTitle>
              <CardDescription>Control collection visibility in your storefront.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="edit-status-switch" className="cursor-pointer font-medium text-sm">
                    Published collection
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Available to customers and visible on your store.
                  </p>
                </div>
                <Switch
                  id="edit-status-switch"
                  checked={published}
                  onCheckedChange={(c) => setPublished(Boolean(c))}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      </form>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Collection?"
        description={`Are you sure you want to delete "${collection.title}"? Products in this collection will not be deleted.`}
        confirmLabel="Delete Collection"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id: collection.id })}
      />
    </PageContainer>
  );
}
