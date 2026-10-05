import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Image as ImageIcon, Save, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { DetailSkeleton, EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category } from "@bs/contracts";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { Switch } from "@bs/ui";
import { Textarea } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { SeoCard } from "../../components/seo-card.tsx";
import { SimpleSelect } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/categories_/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditCategoryRoute,
});

function EditCategoryRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return <EditCategoryPage id={id} navigate={(to) => void navigate({ to })} />;
}

export function EditCategoryPage({ id, navigate }: { id: string; navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const categoryQuery = useQuery(orpc.admin.categories.get.queryOptions({ input: { id } }));
  const categoriesListQuery = useQuery(orpc.admin.categories.list.queryOptions());

  if (categoryQuery.isLoading) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }

  if (categoryQuery.isError || !categoryQuery.data) {
    return (
      <PageContainer size="default">
        <EmptyState
          title="Category not found"
          description={categoryQuery.error ? errorMessage(categoryQuery.error) : "This category does not exist."}
          action={
            <Button variant="outline" size="sm" onClick={() => go("/categories")}>
              Back to Categories
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <CategoryEditor
      key={categoryQuery.data.id}
      category={categoryQuery.data}
      categories={categoriesListQuery.data ?? []}
      go={go}
    />
  );
}

function CategoryEditor({
  category,
  categories,
  go,
}: {
  category: Category;
  categories: Category[];
  go: (to: string) => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const [description, setDescription] = useState(category.description ?? "");
  const [parentId, setParentId] = useState<string>(category.parentId ?? "none");
  const [isActive, setIsActive] = useState(category.isActive);
  const [isFeatured, setIsFeatured] = useState(category.isFeatured);
  const [displayOrder, setDisplayOrder] = useState(String(category.position ?? 0));
  const [imageMediaId, setImageMediaId] = useState<string | null>(category.imageMediaId ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(category.imageUrl ?? null);
  const [uploading, setUploading] = useState(false);

  // SEO state
  const [seoTitle, setSeoTitle] = useState(category.seo?.title ?? "");
  const [seoDescription, setSeoDescription] = useState(category.seo?.description ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Filter eligible parents (not self, and depth < 3)
  const parentOptions = [
    { value: "none", label: "None (Top-level parent category)" },
    ...categories
      .filter((c) => {
        if (c.id === category.id) return false;
        if (c.path?.includes(`/${category.id}/`)) return false;
        const depth = ((c.path ?? "/").match(/\//g) || []).length;
        return depth < 3;
      })
      .map((c) => ({
        value: c.id,
        label: `${(c.path ?? "/").replace(/^\/|\/$/g, "") ? "— " : ""}${c.name}`,
      })),
  ];

  // Upload mutations
  const requestUpload = useMutation(orpc.admin.media.requestUpload.mutationOptions());
  const createMedia = useMutation(orpc.admin.media.create.mutationOptions());

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { uploadUrl, storageKey } = await requestUpload.mutateAsync({
        filename: file.name,
        mime: file.type,
        bytes: file.size,
        folder: "categories",
      });

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload image file to storage.");
      }

      const media = await createMedia.mutateAsync({
        storageKey,
        mime: file.type,
        bytes: file.size,
        alt: name.trim() || "Category image",
        folder: "categories",
      });

      setImageMediaId(media.id);
      setImageUrl(URL.createObjectURL(file));
      toast.success("Image uploaded successfully");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to upload image"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Update mutation
  const updateMutation = useMutation(
    orpc.admin.categories.update.mutationOptions({
      onSuccess: () => {
        toast.success("Category updated successfully");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.key() });
        go("/categories");
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update category"));
      },
    }),
  );

  // Delete mutation
  const deleteMutation = useMutation(
    orpc.admin.categories.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Category deleted");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.key() });
        go("/categories");
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete category"));
      },
    }),
  );

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors["name"] = "Category name is required";
    if (slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      nextErrors["slug"] = "Use lowercase letters, numbers, and hyphens only";
    }
    if (description.length > 500) {
      nextErrors["description"] = "Description cannot exceed 500 characters";
    }
    const orderNum = parseInt(displayOrder, 10);
    if (isNaN(orderNum) || orderNum < 0) {
      nextErrors["displayOrder"] = "Must be a non-negative integer";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error("Please fix the errors before saving");
      return;
    }

    updateMutation.mutate({
      id: category.id,
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      parentId: parentId === "none" ? null : parentId,
      imageMediaId: imageMediaId || null,
      position: parseInt(displayOrder, 10) || 0,
      isActive,
      isFeatured,
      seo: {
        title: seoTitle.trim() || undefined,
        description: seoDescription.trim() || undefined,
      },
    });
  };

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[
          { label: "Categories", href: "/categories" },
          { label: category.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go("/categories")}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Categories
            </Button>
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
              form="category-form"
              size="sm"
              disabled={updateMutation.isPending}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        }
      />

      <PageHeader
        title={category.name}
        description={`Manage category details, hierarchical structure, and search engine listing.`}
      />

      <form id="category-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6" noValidate>
        {/* Left 2 Columns: Main Details, Image, SEO */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">General Information</CardTitle>
              <CardDescription>Name, description, and hierarchy settings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="cat-name">Category Name *</FieldLabel>
                <Input
                  id="cat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Mechanical Keyboards"
                  aria-invalid={Boolean(errors["name"])}
                />
                {errors["name"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors["name"]}
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="cat-slug">URL Handle (Slug)</FieldLabel>
                <Input
                  id="cat-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. mechanical-keyboards"
                  aria-invalid={Boolean(errors["slug"])}
                />
                {errors["slug"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors["slug"]}
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="cat-desc">Description</FieldLabel>
                  <span
                    className={`text-xs ${
                      description.length > 500 ? "font-semibold text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {description.length} / 500
                  </span>
                </div>
                <Textarea
                  id="cat-desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description displayed on category pages..."
                  maxLength={500}
                />
                {errors["description"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors["description"]}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Category Image */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Category Banner / Image</CardTitle>
              <CardDescription>Visual banner or icon used in category lists and grids.</CardDescription>
            </CardHeader>
            <CardContent>
              {imageUrl ? (
                <div className="relative inline-block overflow-hidden rounded-lg border border-border">
                  <img src={imageUrl} alt={name} className="h-40 w-72 object-cover" />
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

          {/* Search Engine Optimization Card (Always Indexable, No Switch) */}
          <SeoCard
            defaultTitle={name}
            defaultDescription={description}
            pathPrefix="/categories"
            slug={slug}
            onSlugChange={setSlug}
            title={seoTitle}
            onTitleChange={setSeoTitle}
            description={seoDescription}
            onDescriptionChange={setSeoDescription}
          />
        </div>

        {/* Right 1 Column: Hierarchy, Status, Position */}
        <div className="flex flex-col gap-6">
          {/* Hierarchy & Parent Category */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Hierarchy</CardTitle>
              <CardDescription>Position within the 3-level category tree.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="parent-category">Parent Category</FieldLabel>
                <SimpleSelect
                  id="parent-category"
                  value={parentId}
                  onChange={(v) => setParentId(v)}
                  options={parentOptions}
                />
                <p className="text-xs text-muted-foreground">
                  Categories can be nested up to 3 levels deep.
                </p>
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="cat-position">Display Position</FieldLabel>
                <Input
                  id="cat-position"
                  type="number"
                  min="0"
                  value={displayOrder}
                  onChange={(e) => setDisplayOrder(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  Lower numbers appear first within the same parent level.
                </p>
                {errors["displayOrder"] && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors["displayOrder"]}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Status & Visibility */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Status & Visibility</CardTitle>
              <CardDescription>Control category visibility across your storefront.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="is-active" className="cursor-pointer font-medium text-sm">
                    Active category
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Show this category in navigation menus and category lists.
                  </p>
                </div>
                <Switch
                  id="is-active"
                  checked={isActive}
                  onCheckedChange={(c) => setIsActive(Boolean(c))}
                />
              </Field>

              <Field orientation="horizontal" className="justify-between border-t border-border pt-3">
                <div>
                  <FieldLabel htmlFor="is-featured" className="cursor-pointer font-medium text-sm">
                    Featured category
                  </FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Highlight in featured collection grids and home heroes.
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
        </div>
      </form>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Category?"
        description={`Are you sure you want to delete "${category.name}"? This action cannot be undone. Categories with subcategories or assigned products cannot be deleted.`}
        confirmLabel="Delete Category"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id: category.id })}
      />
    </PageContainer>
  );
}
