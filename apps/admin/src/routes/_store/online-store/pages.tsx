import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, Edit, Image as ImageIcon, MoreHorizontal, Plus, Trash2, Undo2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Input,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  TableSkeleton,
  toast,
} from "@bs/ui";
import { THEME_PAGE_TYPES } from "@bs/blocks";
import type { PageItem } from "@bs/contracts";
import { DataTable, type Column } from "../../../components/data-table/data-table.tsx";
import { TableToolbar } from "../../../components/data-table/table-toolbar.tsx";
import { SeoCard } from "../../../components/seo-card.tsx";
import { errorMessage } from "../../../lib/errors.ts";
import { orpc } from "../../../lib/orpc.ts";
import { uploadMedia } from "../../../lib/upload-media.ts";

const RESERVED_SLUGS = new Set([
  "api",
  "cart",
  "checkout",
  "account",
  "login",
  "register",
  "products",
  "collections",
  "categories",
  "search",
  "pages",
  "sitemap",
  "robots",
  "favicon",
  "manifest",
  "admin",
  "static",
]);

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getDescendantIds(pageId: string, pages: PageItem[]): Set<string> {
  const descendants = new Set<string>();
  const queue = [pageId];
  while (queue.length > 0) {
    const curr = queue.shift();
    if (!curr) break;
    for (const p of pages) {
      if (p.parentId === curr && !descendants.has(p.id)) {
        descendants.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return descendants;
}

interface PageFormData {
  title: string;
  slug: string;
  parentId: string;
  seoTitle: string;
  seoDescription: string;
  imageMediaId: string | null;
}

function PagesLoading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={6} columns={5} />
    </PageSkeleton>
  );
}

export const Route = createFileRoute("/_store/online-store/pages")({
  pendingComponent: () => <PagesLoading />,
  component: PagesPage,
});

export function PagesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // Queries
  const pagesQuery = useQuery(orpc.admin.pages.list.queryOptions());
  const mediaQuery = useQuery(
    orpc.admin.media.list.queryOptions({
      input: { folder: "pages", limit: 100 },
    }),
  );

  const rawPages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data]);

  // Filter out theme system pages (header, footer, product_template, etc. and template-*)
  // Keep home page!
  const displayPages = useMemo(() => {
    return rawPages.filter((p) => !THEME_PAGE_TYPES.has(p.type ?? "") && !p.slug.startsWith("template-"));
  }, [rawPages]);

  // Search & Status filters
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");

  const filteredPages = useMemo(() => {
    return displayPages.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!searchText.trim()) return true;
      const q = searchText.toLowerCase().trim();
      const matchTitle = p.title.toLowerCase().includes(q);
      const matchSlug = p.slug.toLowerCase().includes(q);
      const matchPath = (p.path ?? "").toLowerCase().includes(q);
      return matchTitle || matchSlug || matchPath;
    });
  }, [displayPages, statusFilter, searchText]);

  // Drawer / Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<PageItem | null>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [saveAndCustomize, setSaveAndCustomize] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Unsaved guard state
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PageItem | null>(null);

  // Form setup
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<PageFormData>({
    defaultValues: {
      title: "",
      slug: "",
      parentId: "none",
      seoTitle: "",
      seoDescription: "",
      imageMediaId: null,
    },
  });

  const watchedTitle = watch("title");
  const watchedSlug = watch("slug");
  const watchedParentId = watch("parentId");
  const watchedSeoTitle = watch("seoTitle");
  const watchedSeoDescription = watch("seoDescription");
  const watchedImageMediaId = watch("imageMediaId");

  const isHome = editingPage?.slug === "home";

  // When title changes and user hasn't manually edited slug, auto-slugify
  useEffect(() => {
    if (!editingPage && !slugManuallyEdited && !isHome) {
      setValue("slug", toSlug(watchedTitle), { shouldValidate: true, shouldDirty: true });
    }
  }, [watchedTitle, editingPage, slugManuallyEdited, isHome, setValue]);

  // Compute live full path
  const liveFullPath = useMemo(() => {
    if (isHome) return "/";
    const cleanSlug = watchedSlug.trim() || "page-handle";
    if (watchedParentId && watchedParentId !== "none") {
      const parent = rawPages.find((p) => p.id === watchedParentId);
      if (parent?.path) {
        return `${parent.path}/${cleanSlug}`;
      }
    }
    return `/pages/${cleanSlug}`;
  }, [isHome, watchedSlug, watchedParentId, rawPages]);

  // Parent path prefix for SEO preview
  const seoPathPrefix = useMemo(() => {
    if (isHome) return "";
    if (watchedParentId && watchedParentId !== "none") {
      const parent = rawPages.find((p) => p.id === watchedParentId);
      if (parent?.path) {
        return parent.path;
      }
    }
    return "/pages";
  }, [isHome, watchedParentId, rawPages]);

  // Eligible parents: exclude self and self descendants, exclude home and system pages
  const parentOptions = useMemo(() => {
    const forbiddenIds = editingPage ? getDescendantIds(editingPage.id, rawPages) : new Set<string>();
    if (editingPage) forbiddenIds.add(editingPage.id);

    const eligible = displayPages.filter((p) => p.slug !== "home" && !forbiddenIds.has(p.id));

    return [
      { value: "none", label: "No parent (top level)" },
      ...eligible.map((p) => ({
        value: p.id,
        label: `${p.title} (${p.path ?? `/pages/${p.slug}`})`,
      })),
    ];
  }, [editingPage, rawPages, displayPages]);

  // Mutations
  const createMutation = useMutation(
    orpc.admin.pages.create.mutationOptions({
      onSuccess: (created) => {
        toast.success(`Page created: ${created.title}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
        setSheetOpen(false);
        reset();
        if (saveAndCustomize) {
          void navigate({ to: "/online-store/editor/$pageId", params: { pageId: created.id } });
        }
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create page"));
      },
    }),
  );

  const updateMutation = useMutation(
    orpc.admin.pages.update.mutationOptions({
      onSuccess: (updated) => {
        toast.success(`Page updated: ${updated.title}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
        setSheetOpen(false);
        reset();
        if (saveAndCustomize) {
          void navigate({ to: "/online-store/editor/$pageId", params: { pageId: updated.id } });
        }
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update page"));
      },
    }),
  );

  const duplicateMutation = useMutation(
    orpc.admin.pages.duplicate.mutationOptions({
      onSuccess: (duplicated) => {
        toast.success(`Page duplicated: ${duplicated.title}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to duplicate page"));
      },
    }),
  );

  const unpublishMutation = useMutation(
    orpc.admin.pages.unpublish.mutationOptions({
      onSuccess: () => {
        toast.success("Page moved to draft");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to unpublish page"));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.pages.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Page deleted");
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to delete page"));
      },
    }),
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Handlers for opening Add/Edit
  const handleOpenAdd = () => {
    setEditingPage(null);
    setSlugManuallyEdited(false);
    setPreviewImageUrl(null);
    reset({
      title: "",
      slug: "",
      parentId: "none",
      seoTitle: "",
      seoDescription: "",
      imageMediaId: null,
    });
    setSheetOpen(true);
  };

  const handleOpenEdit = (page: PageItem) => {
    setEditingPage(page);
    setSlugManuallyEdited(true);

    // Resolve preview image URL if available in media cache
    const existingMedia = mediaQuery.data?.items?.find((m) => m.id === page.seo?.imageMediaId);
    setPreviewImageUrl(existingMedia?.url ?? null);

    reset({
      title: page.title,
      slug: page.slug,
      parentId: page.parentId ?? "none",
      seoTitle: page.seo?.title ?? "",
      seoDescription: page.seo?.description ?? "",
      imageMediaId: page.seo?.imageMediaId ?? null,
    });
    setSheetOpen(true);
  };

  const handleCloseSheet = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (isDirty) {
        setDiscardDialogOpen(true);
      } else {
        setSheetOpen(false);
      }
    } else {
      setSheetOpen(true);
    }
  };

  const handleConfirmDiscard = () => {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    reset();
  };

  // Image Upload handler
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const media = await uploadMedia(file, { folder: "pages", alt: watchedTitle || "Page feature image" });
      setValue("imageMediaId", media.id, { shouldDirty: true });
      setPreviewImageUrl(media.url ?? URL.createObjectURL(file));
      toast.success("Feature image uploaded");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to upload feature image"));
    } finally {
      setUploadingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleRemoveImage = () => {
    setValue("imageMediaId", null, { shouldDirty: true });
    setPreviewImageUrl(null);
  };

  // Form submission
  const onSubmit = (data: PageFormData, customizeAfter: boolean) => {
    setSaveAndCustomize(customizeAfter);

    const cleanTitle = data.title.trim();
    const cleanSlug = isHome ? "home" : data.slug.trim().toLowerCase();
    const selectedParentId = data.parentId === "none" || !data.parentId ? null : data.parentId;

    const seoPayload = {
      title: data.seoTitle.trim() || undefined,
      description: data.seoDescription.trim() || undefined,
      imageMediaId: data.imageMediaId || null,
    };

    if (editingPage) {
      updateMutation.mutate({
        id: editingPage.id,
        title: cleanTitle,
        slug: isHome ? undefined : cleanSlug,
        parentId: isHome ? null : selectedParentId,
        seo: seoPayload,
      });
    } else {
      createMutation.mutate({
        title: cleanTitle,
        slug: cleanSlug,
        parentId: selectedParentId,
        seo: seoPayload,
      });
    }
  };

  // Columns for DataTable
  const columns: Column<PageItem>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (page) => (
        <div className="flex items-center gap-2">
          <span>{page.title}</span>
          {page.slug === "home" && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Home
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "url",
      header: "URL",
      className: "font-mono text-xs text-muted-foreground",
      cell: (page) => (
        <span>{page.path ?? (page.slug === "home" ? "/" : `/pages/${page.slug}`)}</span>
      ),
    },
    {
      id: "parent",
      header: "Parent",
      className: "text-muted-foreground",
      cell: (page) => {
        if (!page.parentId) return <span>—</span>;
        const parent = rawPages.find((p) => p.id === page.parentId);
        return <span>{parent ? parent.title : "—"}</span>;
      },
    },
    {
      id: "status",
      header: "Status",
      cell: (page) => (
        <Badge variant={page.status === "published" ? "secondary" : "outline"}>
          {page.status === "published" ? "Published" : "Draft"}
        </Badge>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      className: "text-muted-foreground text-xs",
      cell: (page) => (
        <span>
          {new Date(page.updatedAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[
          { label: "Online Store", href: "/online-store/theme-library" },
          { label: "Pages" },
        ]}
        actions={
          <Button variant="primary" size="sm" onClick={handleOpenAdd}>
            <Plus className="mr-1.5 size-3.5" aria-hidden />
            Add page
          </Button>
        }
      />

      <PageHeader
        title="Pages"
        description="Manage informational and marketing pages on your store. Customize their layout and content with the visual editor."
      />

      <div className="mt-6 flex flex-col gap-4">
        <TableToolbar
          searchLabel="Search pages"
          searchPlaceholder="Search by title or URL..."
          searchText={searchText}
          onSearchText={setSearchText}
          resultCount={filteredPages.length}
          noun="pages"
          filters={
            <div className="flex items-center gap-2">
              <SimpleSelect
                ariaLabel="Filter by status"
                className="w-36"
                value={statusFilter}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "published", label: "Published" },
                  { value: "draft", label: "Draft" },
                ]}
                onChange={(v) => setStatusFilter(v as "all" | "published" | "draft")}
              />
            </div>
          }
        />

        <DataTable
          columns={columns}
          rows={filteredPages}
          getRowId={(p) => p.id}
          isLoading={pagesQuery.isLoading}
          empty={
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <p className="text-base font-medium">No pages found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchText || statusFilter !== "all"
                  ? "Try adjusting your search or filters."
                  : "Create your first page to get started."}
              </p>
              {!searchText && statusFilter === "all" && (
                <Button variant="outline" size="sm" className="mt-4" onClick={handleOpenAdd}>
                  <Plus className="mr-1.5 size-3.5" />
                  Add page
                </Button>
              )}
            </div>
          }
          rowActions={(page) => (
            <div className="flex items-center justify-end gap-1">
              <Button variant="outline" size="sm" onClick={() => handleOpenEdit(page)}>
                <Edit className="mr-1.5 size-3.5" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/online-store/editor/$pageId",
                    params: { pageId: page.id },
                  })
                }
              >
                Customize
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="Page actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {page.slug !== "home" && (
                    <DropdownMenuItem
                      onClick={() => duplicateMutation.mutate({ id: page.id })}
                      disabled={duplicateMutation.isPending}
                    >
                      <Copy className="mr-2 size-3.5" />
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  {page.slug !== "home" && page.status === "published" && (
                    <DropdownMenuItem
                      onClick={() => unpublishMutation.mutate({ id: page.id })}
                      disabled={unpublishMutation.isPending}
                    >
                      <Undo2 className="mr-2 size-3.5" />
                      Unpublish
                    </DropdownMenuItem>
                  )}
                  {page.slug !== "home" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(page)}
                      >
                        <Trash2 className="mr-2 size-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        />
      </div>

      {/* Add / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={handleCloseSheet}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col bg-background text-foreground">
          <SheetHeader className="p-6 border-b border-border">
            <SheetTitle>{editingPage ? `Edit: ${editingPage.title}` : "Add page"}</SheetTitle>
            <SheetDescription>
              {editingPage
                ? "Update page settings, parent hierarchy, SEO, and feature image."
                : "Create a new page. You can customize layout and sections in the visual editor."}
            </SheetDescription>
          </SheetHeader>

          <form
            id="page-form"
            onSubmit={handleSubmit((data) => onSubmit(data, false))}
            className="flex-1 p-6 space-y-6"
            noValidate
          >
            {/* General Info */}
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="page-title">
                  Page name <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="page-title"
                  {...register("title", {
                    required: "Page name is required",
                    maxLength: { value: 200, message: "Max 200 characters" },
                  })}
                  placeholder="e.g. About Us"
                />
                {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="page-slug">
                    URL handle {!isHome && <span className="text-destructive">*</span>}
                  </FieldLabel>
                  {isHome && <span className="text-xs text-muted-foreground">Home URL is locked to /</span>}
                </div>
                <Input
                  id="page-slug"
                  disabled={isHome}
                  {...register("slug", {
                    required: !isHome ? "URL handle is required" : false,
                    validate: (val) => {
                      if (isHome) return true;
                      const clean = val.trim().toLowerCase();
                      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
                        return "Lowercase letters, numbers, and hyphens only (e.g. about-us)";
                      }
                      if (RESERVED_SLUGS.has(clean)) {
                        return "This URL handle is reserved by the system";
                      }
                      if (clean.startsWith("template-")) {
                        return "URL handle cannot start with 'template-'";
                      }
                      return true;
                    },
                    onChange: () => setSlugManuallyEdited(true),
                  })}
                  placeholder="e.g. about-us"
                />
                {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <span>Canonical URL:</span>
                  <span className="text-foreground font-medium">{liveFullPath}</span>
                </div>
              </Field>

              {!isHome && (
                <Field>
                  <FieldLabel htmlFor="page-parent">Parent page</FieldLabel>
                  <SimpleSelect
                    id="page-parent"
                    ariaLabel="Parent page"
                    value={watchedParentId}
                    options={parentOptions}
                    onChange={(val) => setValue("parentId", val, { shouldDirty: true })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Organize pages hierarchically (e.g. Company &gt; About Us). Max depth 3 levels.
                  </p>
                </Field>
              )}
            </div>

            {/* Feature Image */}
            <div className="space-y-3 pt-2 border-t border-border">
              <FieldLabel>Feature image</FieldLabel>
              <div className="flex items-center gap-4">
                {previewImageUrl ? (
                  <div className="relative inline-block overflow-hidden rounded-lg border border-border">
                    <img
                      src={previewImageUrl}
                      alt={watchedTitle || "Feature image"}
                      className="h-24 w-36 object-cover"
                      onError={() => setPreviewImageUrl(null)}
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute right-1 top-1 size-6"
                      onClick={handleRemoveImage}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : watchedImageMediaId ? (
                  <div className="flex h-24 w-36 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 p-2 text-center">
                    <ImageIcon className="size-6 text-muted-foreground mb-1" />
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      ID: {watchedImageMediaId.slice(0, 8)}...
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 px-1.5 text-xs text-destructive"
                      onClick={handleRemoveImage}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-24 w-36 flex-col items-center justify-center rounded-lg border border-dashed border-border p-2 text-center">
                    <ImageIcon className="size-6 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">No image</span>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingImage}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="mr-1.5 size-3.5" />
                    {uploadingImage ? "Uploading..." : "Upload image"}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Used for search and social sharing thumbnails.
                  </span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </div>
            </div>

            {/* SEO Section (reusing SeoCard) */}
            <div className="pt-2 border-t border-border">
              <SeoCard
                defaultTitle={watchedTitle.trim() || "Untitled Page"}
                defaultDescription=""
                pathPrefix={seoPathPrefix}
                slug={isHome ? "" : watchedSlug.trim()}
                title={watchedSeoTitle}
                onTitleChange={(v) => setValue("seoTitle", v, { shouldDirty: true })}
                description={watchedSeoDescription}
                onDescriptionChange={(v) => setValue("seoDescription", v, { shouldDirty: true })}
              />
            </div>
          </form>

          <SheetFooter className="p-6 border-t border-border flex sm:justify-between items-center gap-2">
            <Button variant="outline" type="button" onClick={() => handleCloseSheet(false)}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                form="page-form"
                variant="outline"
                disabled={isSaving || uploadingImage}
              >
                {isSaving && !saveAndCustomize ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={isSaving || uploadingImage}
                onClick={handleSubmit((data) => onSubmit(data, true))}
              >
                {isSaving && saveAndCustomize ? "Saving..." : "Save and Customize"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.childCount && deleteTarget.childCount > 0
            ? "Cannot delete page with subpages"
            : "Delete page"
        }
        description={
          deleteTarget?.childCount && deleteTarget.childCount > 0 ? (
            <span>
              This page has <strong>{deleteTarget.childCount} subpage(s)</strong>. Please reassign or
              delete its child pages first before deleting this page.
            </span>
          ) : (
            <span>
              Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This action cannot
              be undone.
            </span>
          )
        }
        confirmLabel="Delete page"
        destructive
        confirmDisabled={Boolean(deleteTarget?.childCount && deleteTarget.childCount > 0)}
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
      />

      {/* Unsaved Changes Discard Dialog */}
      <ConfirmDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        title="Discard unsaved changes?"
        description="You have unsaved changes that will be lost if you leave. Are you sure you want to discard them?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={handleConfirmDiscard}
      />
    </PageContainer>
  );
}
