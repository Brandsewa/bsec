import { createFileRoute } from "@tanstack/react-router";
import { Image as ImageIcon, MoreHorizontal, Pencil, Plus, Tag, Trash2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Brand } from "@bs/contracts";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bs/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/brands")({
  pendingComponent: () => <PageSkeleton />,
  component: BrandsPage,
});

export function BrandsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [queryText, setQueryText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);

  // Form states for dialog
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logoMediaId, setLogoMediaId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const statsQuery = useQuery(orpc.admin.brands.stats.queryOptions());
  const brandsQuery = useQuery(orpc.admin.brands.list.queryOptions());

  const brands = brandsQuery.data;

  const filteredBrands = useMemo(() => {
    const list = brands ?? [];
    if (!queryText.trim()) return list;
    const q = queryText.toLowerCase().trim();
    return list.filter((b) => b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q));
  }, [brands, queryText]);

  const openCreateDialog = () => {
    setEditingBrand(null);
    setName("");
    setSlug("");
    setLogoMediaId(null);
    setLogoUrl(null);
    setFormErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (brand: Brand) => {
    setEditingBrand(brand);
    setName(brand.name);
    setSlug(brand.slug);
    setLogoMediaId(brand.logoMediaId ?? null);
    setLogoUrl(brand.logoUrl ?? null);
    setFormErrors({});
    setDialogOpen(true);
  };

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
        folder: "brands",
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
        alt: name || "Brand logo",
        folder: "brands",
      });

      setLogoMediaId(created.id);
      setLogoUrl(URL.createObjectURL(file));
      toast.success("Logo uploaded");
    } catch (err) {
      toast.error(errorMessage(err, "Logo upload failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const createMutation = useMutation(
    orpc.admin.brands.create.mutationOptions({
      onSuccess: (saved) => {
        toast.success(`Brand created: ${saved.name}`);
        setDialogOpen(false);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.brands.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.brands.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create brand"));
      },
    }),
  );

  const updateMutation = useMutation(
    orpc.admin.brands.update.mutationOptions({
      onSuccess: (saved) => {
        toast.success(`Brand updated: ${saved.name}`);
        setDialogOpen(false);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.brands.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.brands.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update brand"));
      },
    }),
  );

  const handleSave = () => {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Brand name is required";
    if (!slug.trim()) errors.slug = "Handle is required";
    else if (!/^[a-z0-9-]+$/.test(slug)) errors.slug = "Handle can only contain lowercase letters, numbers, and hyphens";

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    if (editingBrand) {
      updateMutation.mutate({
        id: editingBrand.id,
        name: name.trim(),
        slug: slug.trim(),
        logoMediaId: logoMediaId ?? null,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        slug: slug.trim(),
        logoMediaId: logoMediaId ?? undefined,
      });
    }
  };

  const deleteMutation = useMutation(
    orpc.admin.brands.delete.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.affectedProducts > 0
            ? `Brand deleted. ${res.affectedProducts} product(s) unassigned.`
            : "Brand deleted",
        );
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.brands.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.brands.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to delete brand"));
      },
    }),
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Brands"
        description="Organize products under manufacturer or brand labels for easy filtering."
        aside={
          <Button onClick={openCreateDialog} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add brand
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
        {statsQuery.isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Total Brands" value={statsQuery.data?.total ?? 0} />
            <MetricCard label="In Use" value={statsQuery.data?.used ?? 0} />
            <MetricCard label="Unused" value={statsQuery.data?.unused ?? 0} />
          </>
        )}
      </div>

      <PageSection>
        <div className="grid gap-3">
          <TableToolbar
            searchLabel="Search brands"
            searchPlaceholder="Search brands..."
            searchText={queryText}
            onSearchText={setQueryText}
            resultCount={filteredBrands.length}
            noun="brands"
          />

          {/* Brands Table */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Handle</th>
                  <th className="px-4 py-3">Products</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
            {brandsQuery.isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Loading brands...
                </td>
              </tr>
            ) : filteredBrands.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Tag className="h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No brands found</p>
                    <p className="text-xs text-muted-foreground">
                      {queryText ? "Try changing your search query." : "Add your first brand to assign to products."}
                    </p>
                    {!queryText && (
                      <Button size="sm" onClick={openCreateDialog} className="mt-2 gap-1.5">
                        <Plus className="h-4 w-4" />
                        Add brand
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredBrands.map((brand) => (
                <tr key={brand.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                        {brand.logoUrl ? (
                          <img src={brand.logoUrl} alt={brand.name} className="h-full w-full object-contain" />
                        ) : (
                          <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{brand.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    /{brand.slug}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={(brand.productCount ?? 0) > 0 ? "secondary" : "outline"} className="text-xs">
                      {brand.productCount ?? 0} {brand.productCount === 1 ? "product" : "products"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(brand)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(brand)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
      </PageSection>

      {/* Brand Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBrand ? "Edit Brand" : "Add Brand"}</DialogTitle>
            <DialogDescription>
              {editingBrand
                ? "Update brand information and logo."
                : "Create a new brand to categorize products."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field>
              <FieldLabel htmlFor="brand-name">Brand Name</FieldLabel>
              <Input
                id="brand-name"
                placeholder="e.g. Acme Studio"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editingBrand) {
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .trim()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-+|-+$/g, "")
                    );
                  }
                }}
              />
              {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
            </Field>

            <Field>
              <FieldLabel htmlFor="brand-slug">Handle (Slug)</FieldLabel>
              <Input
                id="brand-slug"
                placeholder="e.g. acme-studio"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              {formErrors.slug && <p className="text-xs text-destructive">{formErrors.slug}</p>}
            </Field>

            <Field>
              <FieldLabel>Brand Logo</FieldLabel>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/20">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo preview" className="h-full w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      className="gap-1.5"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {uploading ? "Uploading..." : logoUrl ? "Change logo" : "Upload logo"}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setLogoMediaId(null);
                          setLogoUrl(null);
                        }}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">PNG, JPG or SVG up to 5MB.</p>
                </div>
              </div>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving || uploading}>
              {isSaving ? "Saving..." : editingBrand ? "Save changes" : "Create brand"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete brand"
        description={
          deleteTarget ? (
            <span>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
              {(deleteTarget.productCount ?? 0) > 0 && (
                <span className="mt-2 block text-muted-foreground">
                  {deleteTarget.productCount} product(s) assigned to this brand will remain in your catalog with no brand assigned.
                </span>
              )}
            </span>
          ) : ""
        }
        confirmLabel="Delete brand"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
      />
    </PageContainer>
  );
}
