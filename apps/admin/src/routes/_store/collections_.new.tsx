import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Save,
} from "lucide-react";
import { useState } from "react";
import { PageActions, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CollectionRule } from "@bs/contracts";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input, InfoTip, Textarea } from "@bs/ui";
import { Switch } from "@bs/ui";
import { SeoCard } from "../../components/seo-card.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";
import { CollectionTypeCard, ProductAssignmentsCard, ProductSortingCard, RulesBuilderCard } from "../../components/collection/collection-parts.tsx";
import type { PickedProduct } from "../../components/product/product-picker-dialog.tsx";
import { MediaField } from "../../components/media/media-field.tsx";

export const Route = createFileRoute("/_store/collections_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateCollectionPage,
});

export function CreateCollectionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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

  // SEO state
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  // Automated condition builder rules
  const [rules, setRules] = useState<CollectionRule[]>([
    { field: "tag", operator: "equals", value: "" },
  ]);

  // Manual product picker state
  const [products, setProducts] = useState<PickedProduct[]>([]);

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
      description: description.trim() || undefined,
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
      productIds: type === "manual" ? products.map((p) => p.id) : undefined,
    });
  };

  return (
    <PageContainer size="full">
      <PageActions>
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
      </PageActions>

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
                <FieldLabel htmlFor="col-description" className="flex items-center gap-1.5">
                  Description
                  <InfoTip>Short plain-text blurb shown on collection cards and the collections page (two lines on cards). Up to 300 characters.</InfoTip>
                </FieldLabel>
                <Textarea
                  id="col-description"
                  rows={3}
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Hand-made chilli pastes and oils from the Darjeeling hills"
                />
                <p className="text-xs text-muted-foreground">{description.length}/300</p>
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

          <CollectionTypeCard value={type} onChange={setType} noun="collection" idPrefix="create" />

          {/* Type-specific: manual product picker or automated conditions */}
          {type === "manual" ? (
            <ProductAssignmentsCard products={products} onChange={setProducts} />
          ) : (
            <RulesBuilderCard rules={rules} onRulesChange={setRules} match={match} onMatchChange={setMatch} idPrefix="create" />
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
