import { ImageIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  ConfirmDialog,
  Field,
  FieldLabel,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  cn,
  toast,
} from "@bs/ui";
import type { ProductDetail, ProductVariant } from "@bs/contracts";
import { MediaPickerDialog } from "../media/media-picker-dialog.tsx";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const toRupees = (paise: number | null | undefined) => (paise == null ? "" : String(paise / 100));

type Dims = { lengthCm?: number; widthCm?: number; heightCm?: number } | null | undefined;
const dimText = (d: Dims, key: "lengthCm" | "widthCm" | "heightCm") => (d && typeof d[key] === "number" ? String(d[key]) : "");

export interface VariantDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productMedia: ProductDetail["media"];
  priceOnRequest: boolean;
  /** The variant to edit, or null to add a new one. */
  variant: ProductVariant | null;
  /** Names of the product's options; a new variant asks for a value for each. */
  optionNames: string[];
  /** False when this is the product's only variant. */
  canDelete: boolean;
  onChanged: () => void;
}

/** One variant's full details in a side drawer: identity, pricing, shipping size and weight, image, stock rules, pre-order. */
export function VariantDrawer(props: VariantDrawerProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="overflow-y-auto p-0">
        {props.open ? <VariantForm key={props.variant?.id ?? "new"} {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function VariantForm({ onOpenChange, productId, productMedia, priceOnRequest, variant, optionNames, canDelete, onChanged }: VariantDrawerProps) {
  const isNew = variant === null;
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [title, setTitle] = useState(variant?.title ?? "");
  const [barcode, setBarcode] = useState(variant?.barcode ?? "");
  const [price, setPrice] = useState(toRupees(variant?.price));
  const [compare, setCompare] = useState(toRupees(variant?.compareAtPrice));
  const [cost, setCost] = useState(toRupees(variant?.costPrice));
  const [weight, setWeight] = useState(variant?.weightGrams != null ? String(variant.weightGrams) : "");
  const dims = variant?.dimensions as Dims;
  const [length, setLength] = useState(dimText(dims, "lengthCm"));
  const [width, setWidth] = useState(dimText(dims, "widthCm"));
  const [height, setHeight] = useState(dimText(dims, "heightCm"));
  const [trackInventory, setTrackInventory] = useState(variant?.trackInventory ?? true);
  const [allowBackorder, setAllowBackorder] = useState(variant?.allowBackorder ?? false);
  const [preorderEnabled, setPreorderEnabled] = useState(Boolean(variant?.preorderEnabled));
  const [preorderShipsOn, setPreorderShipsOn] = useState(variant?.preorderShipsOn ?? "");
  const [preorderMessage, setPreorderMessage] = useState(variant?.preorderMessage ?? "");
  const [imageMediaId, setImageMediaId] = useState<string | null>(variant?.imageMediaId ?? null);
  const [optionInputs, setOptionInputs] = useState<Record<string, string>>(
    Object.fromEntries(optionNames.map((n) => [n, (variant?.optionValues as Record<string, string> | null | undefined)?.[n] ?? ""])),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matched = productMedia.find((m) => m.mediaId === imageMediaId);
  const mediaQuery = useQuery({
    ...orpc.admin.media.get.queryOptions({ input: { id: imageMediaId as string } }),
    enabled: Boolean(imageMediaId) && !matched,
  });
  const displayUrl = matched?.url ?? mediaQuery.data?.url;
  const productImages = productMedia.filter((m) => m.kind === "image" && Boolean(m.url));

  const updateMutation = useMutation(orpc.admin.variants.update.mutationOptions());
  const createMutation = useMutation(orpc.admin.variants.create.mutationOptions());
  const deleteMutation = useMutation(orpc.admin.variants.delete.mutationOptions());
  const busy = updateMutation.isPending || createMutation.isPending || deleteMutation.isPending;
  const today = new Date().toISOString().slice(0, 10);

  function numberOrNull(text: string): number | null {
    return text.trim() === "" ? null : Number(text);
  }

  function validate(): string | null {
    if (!sku.trim()) return "SKU is required";
    if (!title.trim()) return "Title is required";
    if (!priceOnRequest && (price === "" || !Number.isFinite(Number(price)) || Number(price) < 0)) return "Enter a valid price";
    if (!priceOnRequest && compare !== "" && (!Number.isFinite(Number(compare)) || Number(compare) < 0)) return "Enter a valid compare-at price";
    if (cost !== "" && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) return "Enter a valid cost price";
    const w = numberOrNull(weight);
    if (w !== null && (!Number.isInteger(w) || w < 0 || w > 1_000_000)) return "Weight must be a whole number of grams (0 to 1,000,000)";
    for (const [label, v] of [["Length", length], ["Width", width], ["Height", height]] as const) {
      const n = numberOrNull(v);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1000)) return `${label} must be between 0 and 1000 cm`;
    }
    if (preorderEnabled) {
      if (!preorderShipsOn) return "Ship date is required for pre-orders";
      if (!variant?.preorderEnabled && preorderShipsOn <= today) return "Pre-order ship date must be in the future when enabling";
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) return setError(problem);
    setError(null);

    const w = numberOrNull(weight);
    const l = numberOrNull(length);
    const wd = numberOrNull(width);
    const h = numberOrNull(height);
    const dimensions = l === null && wd === null && h === null ? null : { ...(l !== null ? { lengthCm: l } : {}), ...(wd !== null ? { widthCm: wd } : {}), ...(h !== null ? { heightCm: h } : {}) };
    const optionValues = Object.fromEntries(Object.entries(optionInputs).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

    try {
      if (isNew) {
        await createMutation.mutateAsync({
          productId,
          sku: sku.trim(),
          title: title.trim(),
          price: priceOnRequest ? 0 : toPaise(price),
          ...(compare !== "" && !priceOnRequest ? { compareAtPrice: toPaise(compare) } : {}),
          ...(cost !== "" ? { costPrice: toPaise(cost) } : {}),
          barcode: barcode.trim() || null,
          weightGrams: w,
          dimensions,
          ...(Object.keys(optionValues).length > 0 ? { optionValues } : {}),
          trackInventory,
          allowBackorder,
          ...(imageMediaId ? { imageMediaId } : {}),
        });
        toast.success(`Variant ${sku.trim()} added`);
      } else {
        await updateMutation.mutateAsync({
          id: variant.id,
          sku: sku.trim(),
          title: title.trim(),
          price: priceOnRequest ? 0 : toPaise(price),
          compareAtPrice: priceOnRequest || compare === "" ? null : toPaise(compare),
          costPrice: cost === "" ? null : toPaise(cost),
          barcode: barcode.trim() || null,
          weightGrams: w,
          dimensions,
          trackInventory,
          allowBackorder,
          preorderEnabled,
          preorderShipsOn: preorderEnabled ? preorderShipsOn || null : null,
          preorderMessage: preorderEnabled ? preorderMessage.trim() || null : null,
          imageMediaId,
        });
        toast.success(`Variant ${sku.trim()} saved`);
      }
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Failed to save the variant"));
    }
  }

  async function remove() {
    if (!variant) return;
    try {
      await deleteMutation.mutateAsync({ id: variant.id });
      toast.success(`Variant ${variant.sku} deleted`);
      setConfirmDelete(false);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setConfirmDelete(false);
      setError(errorMessage(err, "Failed to delete the variant"));
    }
  }

  return (
    <>
      <SheetHeader className="border-b border-border p-5 sm:p-8">
        <SheetTitle>{isNew ? "Add variant" : variant.title}</SheetTitle>
        <SheetDescription>
          {isNew ? "Add one more way this product can be bought." : `SKU ${variant.sku}. Changes apply to this variant only.`}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-8 p-5 text-xs sm:p-8">
        {isNew && optionNames.length > 0 ? (
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Option values</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {optionNames.map((name) => (
                <div key={name} className="grid gap-1.5">
                  <FieldLabel htmlFor={`new-opt-${name}`}>{name}</FieldLabel>
                  <Input
                    id={`new-opt-${name}`}
                    value={optionInputs[name] ?? ""}
                    onChange={(e) => setOptionInputs((p) => ({ ...p, [name]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-foreground">General</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor="vd-title">Title</FieldLabel>
              <Input id="vd-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-sku">SKU</FieldLabel>
              <Input id="vd-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-barcode">Barcode (ISBN, UPC, GTIN)</FieldLabel>
              <Input id="vd-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-foreground">Pricing</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-price">Price (₹)</FieldLabel>
              <Input id="vd-price" type="number" step="0.01" min="0" disabled={priceOnRequest} value={priceOnRequest ? "0.00" : price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-compare">Compare-at (₹)</FieldLabel>
              <Input id="vd-compare" type="number" step="0.01" min="0" disabled={priceOnRequest} value={priceOnRequest ? "" : compare} onChange={(e) => setCompare(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-cost">Cost per item (₹)</FieldLabel>
              <Input id="vd-cost" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>
          {priceOnRequest ? <p className="text-muted-foreground">Price on request is on for this product, so buyers see a quote form instead of a price.</p> : null}
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-foreground">Weight and size</h3>
          <p className="text-muted-foreground">Used for weight-based delivery rates and courier packing.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-weight">Weight (g)</FieldLabel>
              <Input id="vd-weight" type="number" step="1" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 250" />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-length">Length (cm)</FieldLabel>
              <Input id="vd-length" type="number" step="0.1" min="0" value={length} onChange={(e) => setLength(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-width">Width (cm)</FieldLabel>
              <Input id="vd-width" type="number" step="0.1" min="0" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="vd-height">Height (cm)</FieldLabel>
              <Input id="vd-height" type="number" step="0.1" min="0" value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-foreground">Image</h3>
          <div className="flex flex-wrap items-center gap-3">
            {displayUrl ? (
              <div className="group relative size-14 overflow-hidden rounded border border-border bg-background">
                <img src={displayUrl} alt={title} className="size-full object-cover" />
              </div>
            ) : (
              <div className="flex size-14 items-center justify-center rounded border border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground">
                <ImageIcon className="size-5" />
              </div>
            )}
            {productImages.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">From product:</span>
                {productImages.slice(0, 5).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setImageMediaId(m.mediaId)}
                    className={cn("size-9 overflow-hidden rounded border transition-all hover:opacity-80", imageMediaId === m.mediaId ? "border-primary ring-2 ring-primary" : "border-border")}
                    title={m.alt ?? "Use for this variant"}
                  >
                    {m.url ? <img src={m.url} alt="" className="size-full object-cover" /> : <ImageIcon className="mx-auto size-3" />}
                  </button>
                ))}
              </div>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              Browse library
            </Button>
            {imageMediaId ? (
              <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setImageMediaId(null)}>
                Remove
              </Button>
            ) : null}
          </div>
          <MediaPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            accept={["image"]}
            multiple={false}
            onSelect={(selected) => {
              if (selected[0]) setImageMediaId(selected[0].id);
            }}
            title="Select variant image"
          />
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-foreground">Stock rules</h3>
          <Field orientation="horizontal" className="justify-between">
            <div>
              <FieldLabel htmlFor="vd-track" className="cursor-pointer font-normal text-sm">Track stock</FieldLabel>
              <p className="text-muted-foreground">Count units and stop selling at zero.</p>
            </div>
            <Switch id="vd-track" checked={trackInventory} onCheckedChange={(c) => setTrackInventory(Boolean(c))} />
          </Field>
          <Field orientation="horizontal" className="justify-between">
            <div>
              <FieldLabel htmlFor="vd-backorder" className="cursor-pointer font-normal text-sm">Allow backorders</FieldLabel>
              <p className="text-muted-foreground">Keep selling when stock runs out.</p>
            </div>
            <Switch id="vd-backorder" checked={allowBackorder} onCheckedChange={(c) => setAllowBackorder(Boolean(c))} />
          </Field>
          {isNew ? <p className="text-muted-foreground">Set the opening stock from the Inventory page after saving.</p> : null}
        </section>

        {!isNew ? (
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Pre-order</h3>
            <Field orientation="horizontal" className="justify-between">
              <div>
                <FieldLabel htmlFor="vd-preorder" className="cursor-pointer font-normal text-sm">Enable pre-order</FieldLabel>
                <p className="text-muted-foreground">Sell at zero stock with an expected dispatch date.</p>
              </div>
              <Switch id="vd-preorder" checked={preorderEnabled} onCheckedChange={(c) => setPreorderEnabled(Boolean(c))} />
            </Field>
            {preorderEnabled ? (
              <div className="grid gap-3 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="vd-ships-on">Expected ship date *</FieldLabel>
                  <Input id="vd-ships-on" type="date" value={preorderShipsOn} onChange={(e) => setPreorderShipsOn(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="vd-preorder-msg">Customer message (optional)</FieldLabel>
                  <Input id="vd-preorder-msg" maxLength={200} placeholder="e.g. Dispatches in 2 weeks" value={preorderMessage} onChange={(e) => setPreorderMessage(e.target.value)} />
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-popover px-5 py-4 sm:px-8">
        <div>
          {!isNew ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || !canDelete} onClick={() => setConfirmDelete(true)} title={canDelete ? undefined : "A product needs at least one variant"}>
              <Trash2 className="mr-1.5 size-3.5" aria-hidden /> Delete variant
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving..." : isNew ? "Add variant" : "Save variant"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this variant?"
        description="This removes the variant and its stock records. A variant that has been sold cannot be deleted."
        confirmLabel="Delete variant"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => void remove()}
      />
    </>
  );
}
