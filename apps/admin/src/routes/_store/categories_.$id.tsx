import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Image as ImageIcon, Save, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DetailSkeleton, EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category } from "@bs/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { SeoCard } from "../../components/seo-card.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/categories_/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditCategoryPage,
});

export function EditCategoryPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const categoryQuery = useQuery(orpc.admin.categories.get.queryOptions({ input: { id } }));
  const categoriesListQuery = useQuery(orpc.admin.categories.list.queryOptions());

  const category = categoryQuery.data;
  const categories = categoriesListQuery.data ?? [];

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string>("none");
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [displayOrder, setDisplayOrder] = useState("0");
  const [imageMediaId, setImageMediaId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // SEO state
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Initialize form state from query
  useEffect(() => {
    if (category) {
      setName(category.name);
      setSlug(category.slug);
      setDescription(category.description ?? "");
      setParentId(category.parentId ?? "none");
      setIsActive(category.isActive);
      setIsFeatured(category.isFeatured);
      setDisplayOrder(String(category.position ?? 0));
      setImageMediaId(category.imageMediaId ?? null);
      setImageUrl(category.imageUrl ?? null);
      setSeoTitle(category.seo?.title ?? "");
      setSeoDescription(category.seo?.description ?? "");
    }
  }, [category]);

  // Filter eligible parents (not self, and depth < 3)
  const parentOptions = [
    { value: "none", label: "None (Top-level parent category)" },
    ...categories
      .filter((c) => {
        if (c.id === id) return false;
        // Don't allow picking a child as parent (prevent cycles)
        if (c.path?.includes(`/${id}/`)) return false;
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
      const descriptor = await requestUpload.mutateAsync({
        filename: file.name,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        folder: "categories",
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
        alt: name || "Category image",
        folder: "categories",
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
    orpc.admin.categories.update.mutationOptions({
      onSuccess: () => {
        toast.success("Category updated");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.get.key({ input: { id } }) });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update category"));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.categories.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Category deleted");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.stats.key() });
        void navigate({ to: "/categories" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete category"));
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors["name"] = "Category name is required";
    }
    if (description.length > 500) {
      newErrors["description"] = "Description must be 500 characters or less";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    updateMutation.mutate({
      id,
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() ? description.trim() : null,
      parentId: parentId === "none" ? null : parentId,
      imageMediaId: imageMediaId || null,
      position: Number(displayOrder) || 0,
      isActive,
      isFeatured,
      seo:
        seoTitle.trim() || seoDescription.trim()
          ? {
              title: seoTitle.trim() || null,
              description: seoDescription.trim() || null,
            }
          : null,
    });
  };

  if (categoryQuery.isLoading) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }

  if (categoryQuery.isError || !category) {
    return (
      <PageContainer size="default">
        <EmptyState
          title="Category not found"
          description={categoryQuery.error?.message ?? "The requested category does not exist."}
          action={
            <Button render={<Link to="/categories" />} variant="outline">
              Back to categories
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
          { label: "Categories", href: "/categories" },
          { label: category.name },
        ]}
      />

      <PageHeader
        title={category.name}
        description={`ID: ${category.id}`}
        aside={
          <div className="flex items-center gap-2">
            <Button render={<Link to="/categories" />} variant="outline" size="sm">
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
              form="edit-category-form"
              size="sm"
              disabled={updateMutation.isPending || uploading}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        }
      />

      <form id="edit-category-form" onSubmit={handleSubmit} className="grid gap-6">
        {/* Category Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">General Information</CardTitle>
            <CardDescription>Basic name, handle and description for the category.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="cat-name">Name *</FieldLabel>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mechanical Keyboards"
                required
              />
              {errors["name"] && <p className="text-xs text-destructive">{errors["name"]}</p>}
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
                placeholder="Brief category overview for the storefront..."
                maxLength={500}
              />
              {errors["description"] && (
                <p className="text-xs text-destructive">{errors["description"]}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="cat-parent">Parent category</FieldLabel>
              <SimpleSelect
                value={parentId}
                options={parentOptions}
                onChange={(val) => setParentId(val)}
              />
              <p className="text-xs text-muted-foreground">
                Category hierarchy allows up to 3 levels deep.
              </p>
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="cat-order">Display order position</FieldLabel>
              <Input
                id="cat-order"
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                className="max-w-[120px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Category Image */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Category Image</CardTitle>
            <CardDescription>Shown in collection grids, category lists and menus.</CardDescription>
          </CardHeader>
          <CardContent>
            {imageUrl ? (
              <div className="relative inline-block overflow-hidden rounded-lg border border-border">
                <img src={imageUrl} alt="Category preview" className="size-32 object-cover" />
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
                <p className="mt-2 text-sm font-medium">Upload category banner or thumbnail</p>
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

        {/* Visibility & Merchandising */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Visibility & Merchandising</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex items-center justify-between">
              <div>
                <FieldLabel htmlFor="cat-active">Active</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Inactive categories are hidden from storefront menus and category lists.
                </p>
              </div>
              <Switch
                id="cat-active"
                checked={isActive}
                onCheckedChange={(c) => setIsActive(c)}
              />
            </div>

            <div className="flex items-center justify-between border-t border-border pt-4">
              <div>
                <FieldLabel htmlFor="cat-featured">Featured category</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Highlight this category in featured category blocks on your homepage.
                </p>
              </div>
              <Switch
                id="cat-featured"
                checked={isFeatured}
                onCheckedChange={(c) => setIsFeatured(c)}
              />
            </div>
          </CardContent>
        </Card>

        {/* SEO Card (No indexing switch) */}
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
      </form>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Category?"
        description={
          <div className="space-y-2">
            <p>
              Are you sure you want to delete <strong>{category.name}</strong>?
            </p>
            {(category.childrenCount ?? 0) > 0 && (
              <p className="rounded-md bg-destructive/10 p-2 text-xs font-medium text-destructive">
                ⚠️ This category has subcategories. You must reassign or delete them first.
              </p>
            )}
            {(category.productCount ?? 0) > 0 && (
              <p className="rounded-md bg-amber-500/10 p-2 text-xs font-medium text-amber-800 dark:text-amber-400">
                ⚠️ {category.productCount} product(s) are assigned to this category. They will need to be reassigned.
              </p>
            )}
          </div>
        }
        confirmLabel="Delete Category"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id })}
      />
    </PageContainer>
  );
}
