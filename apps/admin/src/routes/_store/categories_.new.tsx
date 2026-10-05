import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Image as ImageIcon, Save, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { Switch } from "@bs/ui";
import { Textarea } from "@bs/ui";
import { SeoCard } from "../../components/seo-card.tsx";
import { SimpleSelect } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/categories_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateCategoryPage,
});

export function CreateCategoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Query existing categories to populate parent options
  const categoriesQuery = useQuery(orpc.admin.categories.list.queryOptions());
  const categories = categoriesQuery.data ?? [];

  // Filter eligible parents (depth < 3)
  const parentOptions = [
    { value: "none", label: "None (Top-level parent category)" },
    ...categories
      .filter((c) => {
        // Path has max 3 levels: "/" is depth 1, "/id/" is depth 2, "/id1/id2/" is depth 3
        const depth = ((c.path ?? "/").match(/\//g) || []).length;
        return depth < 3; // depth 1 or 2 can be parent
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

  const createMutation = useMutation(
    orpc.admin.categories.create.mutationOptions({
      onSuccess: () => {
        toast.success("Category created");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.stats.key() });
        void navigate({ to: "/categories" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create category"));
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

    createMutation.mutate({
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
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
          : undefined,
    });
  };

  return (
    <PageContainer size="default">
      <PageBreadcrumbs
        items={[
          { label: "Categories", href: "/categories" },
          { label: "New category" },
        ]}
      />

      <PageHeader
        title="Add category"
        description="Create a category to group related products."
        aside={
          <div className="flex items-center gap-2">
            <Button render={<Link to="/categories" />} variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Cancel
            </Button>
            <Button
              type="submit"
              form="category-form"
              size="sm"
              disabled={createMutation.isPending || uploading}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {createMutation.isPending ? "Saving..." : "Save Category"}
            </Button>
          </div>
        }
      />

      <form id="category-form" onSubmit={handleSubmit} className="grid gap-6">
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
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")) {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
                  }
                }}
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

        {/* Visibility & Organization */}
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

        {/* SEO Card (No indexing switch for categories as categories are always indexable) */}
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
    </PageContainer>
  );
}
