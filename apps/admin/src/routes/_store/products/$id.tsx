import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Archive, ImageIcon, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { DetailSkeleton, EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductDetail } from "@bs/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "../../../components/section-card.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { orpc } from "../../../lib/orpc.ts";

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

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const toRupees = (paise: number | null | undefined) => (paise == null ? "" : String(paise / 100));

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
  const [title, setTitle] = useState(product.title);
  const [slug, setSlug] = useState(product.slug);
  const [status, setStatus] = useState<"draft" | "active" | "archived">(product.status);
  const [shortDescription, setShortDescription] = useState(product.shortDescription ?? "");
  const [description, setDescription] = useState(descriptionText(product.descriptionJson));
  const [tags, setTags] = useState(product.tags.join(", "));
  const [requiresShipping, setRequiresShipping] = useState(product.requiresShipping);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const save = (nextStatus?: "draft" | "active" | "archived") => {
    const e: Record<string, string> = {};
    if (!title.trim()) e["title"] = "Title is required";
    if (!slug.trim()) e["slug"] = "Slug is required";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) e["slug"] = "Use lowercase letters, numbers and hyphens only";
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    const finalStatus = nextStatus ?? status;
    if (nextStatus) setStatus(nextStatus);
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
    });
  };

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  return (
    <PageContainer size="default">
      <PageBreadcrumbs
        items={[{ label: "Products", href: "/products" }, { label: product.title }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go("/products")}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Products
            </Button>
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
          </div>
        }
      />

      <PageHeader title={product.title} description={`ID: ${product.id}`} />

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
        className="grid gap-6"
        noValidate
      >
        <SectionCard title="Product Information" description="Title, URL and merchandising settings.">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="edit-title">Title *</FieldLabel>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              {err("title")}
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="edit-slug">Slug *</FieldLabel>
              <Input id="edit-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
              {err("slug")}
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="edit-status">Status</FieldLabel>
              <div id="edit-status" className="flex gap-2">
                {(["draft", "active", "archived"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={status === s ? "default" : "outline"}
                    size="sm"
                    className="capitalize"
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="edit-short">Short description</FieldLabel>
              <Input id="edit-short" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="edit-desc">Description</FieldLabel>
              <Textarea
                id="edit-desc"
                rows={5}
                  value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="edit-tags">Tags</FieldLabel>
              <Input
                id="edit-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma separated"
              />
            </div>
            <Field orientation="horizontal">
              <Checkbox id="requires-shipping" checked={requiresShipping} onCheckedChange={(c) => setRequiresShipping(c)} />
              <FieldLabel htmlFor="requires-shipping" className="font-normal">Requires shipping</FieldLabel>
            </Field>
          </div>
        </SectionCard>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => go("/products")}>
            Back
          </Button>
          <Button type="submit" variant="default" disabled={updateMutation.isPending}>
            <Save className="mr-1.5 size-3.5" aria-hidden />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>

      <StockSummary product={product} onManage={() => go("/inventory")} />

      <SectionCard title="Variants" description="SKUs and pricing (in ₹). Stock is managed on the Inventory page.">
        {product.variants.length === 0 ? (
          <EmptyState title="No variants" description="This product has no variants yet." />
        ) : (
          <div className="grid gap-3">
            {product.variants.map((v) => (
              <VariantRow key={v.id} variant={v} onSaved={invalidate} />
            ))}
          </div>
        )}
      </SectionCard>

      <MediaSection product={product} />

      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
            <DialogDescription>
              "{product.title}" and its variants will be removed. To hide it from the store without deleting it,
              archive it instead.
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
    <SectionCard title="Stock" description="Customers can only add a product to their cart while it has stock available.">
      {levels.isLoading ? (
        <p className="text-sm text-foreground-lighter">Loading stock...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-foreground-lighter">This product does not track stock.</p>
      ) : (
        <ul className="grid gap-1 text-sm" data-testid="product-stock">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span>
                {r.variantTitle ?? r.variantSku} · {r.locationName}
              </span>
              <span className={r.available > 0 ? "font-medium" : "font-medium text-destructive"}>
                {r.available > 0 ? `${r.available} available` : "Out of stock"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" onClick={onManage}>
          Manage stock
        </Button>
      </div>
    </SectionCard>
  );
}

function VariantRow({
  variant,
  onSaved,
}: {
  variant: ProductDetailData["variants"][number];
  onSaved: () => void;
}) {
  const [sku, setSku] = useState(variant.sku);
  const [vTitle, setVTitle] = useState(variant.title);
  const [price, setPrice] = useState(toRupees(variant.price));
  const [compare, setCompare] = useState(toRupees(variant.compareAtPrice));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    orpc.admin.variants.update.mutationOptions({
      onSuccess: () => {
        toast.success(`Variant ${sku} saved`);
        onSaved();
      },
      onError: (err: Error) => toast.error(err.message || "Failed to save variant"),
    }),
  );

  const submit = () => {
    if (!sku.trim() || !vTitle.trim()) return setError("SKU and title are required");
    if (price === "" || !Number.isFinite(Number(price)) || Number(price) < 0) return setError("Enter a valid price");
    if (compare !== "" && (!Number.isFinite(Number(compare)) || Number(compare) < 0)) {
      return setError("Enter a valid compare-at price");
    }
    setError(null);
    mutation.mutate({
      id: variant.id,
      sku: sku.trim(),
      title: vTitle.trim(),
      price: toPaise(price),
      compareAtPrice: compare === "" ? null : toPaise(compare),
    });
  };

  return (
    <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-4">
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`v-title-${variant.id}`}>Title</FieldLabel>
        <Input id={`v-title-${variant.id}`} value={vTitle} onChange={(e) => setVTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`v-sku-${variant.id}`}>SKU</FieldLabel>
        <Input id={`v-sku-${variant.id}`} value={sku} onChange={(e) => setSku(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`v-price-${variant.id}`}>Price (₹)</FieldLabel>
        <Input
          id={`v-price-${variant.id}`}
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`v-compare-${variant.id}`}>Compare-at (₹)</FieldLabel>
        <Input
          id={`v-compare-${variant.id}`}
          type="number"
          step="0.01"
          min="0"
          value={compare}
          onChange={(e) => setCompare(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between sm:col-span-4">
        <span className="text-xs text-foreground-lighter">
          Current price {inr.format(variant.price / 100)}
          {error ? <span role="alert" className="ml-3 text-destructive">{error}</span> : null}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={submit}>
          {mutation.isPending ? "Saving..." : "Save variant"}
        </Button>
      </div>
    </div>
  );
}

function MediaSection({ product }: { product: ProductDetailData }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const requestUpload = useMutation(orpc.admin.media.requestUpload.mutationOptions());
  const createMedia = useMutation(orpc.admin.media.create.mutationOptions());
  const attachMedia = useMutation(orpc.admin.products.attachMedia.mutationOptions());
  const detachMedia = useMutation(orpc.admin.products.detachMedia.mutationOptions());
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() });

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const descriptor = await requestUpload.mutateAsync({
        filename: file.name,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        folder: "products",
      });
      const res = await fetch(descriptor.uploadUrl, {
        method: "PUT",
        headers: descriptor.headers,
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status}). Check that image storage allows uploads from this site.`);
      const created = await createMedia.mutateAsync({
        storageKey: descriptor.storageKey,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        alt: product.title,
        folder: "products",
      });
      await attachMedia.mutateAsync({ id: product.id, mediaId: created.id, alt: product.title });
      void queryClient.invalidateQueries({ queryKey: orpc.admin.media.list.key() });
      refresh();
      toast.success("Image added to the product");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <SectionCard
      title="Media"
      description="Images shown for this product in your store. The first image is the main one."
    >
      <div className="grid gap-4">
        {product.media.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="No images attached"
            description="Upload an image to show it on your product."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {product.media.map((m) => (
              <div key={m.id} className="overflow-hidden rounded-md border border-border">
                {m.url ? (
                  <img src={m.url} alt={product.title} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-foreground-muted">
                    <ImageIcon className="size-6" aria-hidden />
                  </div>
                )}
                <div className="flex items-center justify-between px-2 py-1 text-xs text-foreground-muted">
                  <span>{m.isPrimary ? "Main image" : ""}</span>
                  <button
                    type="button"
                    className="text-destructive hover:underline disabled:opacity-50"
                    disabled={detachMedia.isPending}
                    onClick={() =>
                      detachMedia.mutate(
                        { id: product.id, productMediaId: m.id },
                        { onSuccess: () => { toast.success("Image removed"); refresh(); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove the image") },
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1.5 size-3.5" aria-hidden />
            {uploading ? "Uploading..." : "Upload image"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
