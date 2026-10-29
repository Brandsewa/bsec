import { ImageIcon, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { gramsToUnit, unitToGrams, type WeightUnit } from "@bs/contracts/units";
import { MediaPickerDialog } from "../media/media-picker-dialog.tsx";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const toRupees = (paise: number | null | undefined) => (paise == null ? "" : String(paise / 100));

type Dims = { lengthCm?: number; widthCm?: number; heightCm?: number } | null | undefined;
const dimText = (d: Dims, key: "lengthCm" | "widthCm" | "heightCm") => (d && typeof d[key] === "number" ? String(d[key]) : "");

/** Everything the drawer edits for one variant, as the strings and flags the inputs hold. */
interface FormState {
  sku: string;
  title: string;
  barcode: string;
  price: string;
  compare: string;
  cost: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  trackInventory: boolean;
  allowBackorder: boolean;
  preorderEnabled: boolean;
  preorderShipsOn: string;
  preorderMessage: string;
  imageMediaId: string | null;
  optionInputs: Record<string, string>;
}

function toForm(variant: ProductVariant | null, optionNames: string[], weightUnit: WeightUnit = "g"): FormState {
  const dims = variant?.dimensions as Dims;
  return {
    sku: variant?.sku ?? "",
    title: variant?.title ?? "",
    barcode: variant?.barcode ?? "",
    price: toRupees(variant?.price),
    compare: toRupees(variant?.compareAtPrice),
    cost: toRupees(variant?.costPrice),
    weight: variant?.weightGrams != null ? String(gramsToUnit(variant.weightGrams, weightUnit)) : "",
    length: dimText(dims, "lengthCm"),
    width: dimText(dims, "widthCm"),
    height: dimText(dims, "heightCm"),
    trackInventory: variant?.trackInventory ?? true,
    allowBackorder: variant?.allowBackorder ?? false,
    preorderEnabled: Boolean(variant?.preorderEnabled),
    preorderShipsOn: variant?.preorderShipsOn ?? "",
    preorderMessage: variant?.preorderMessage ?? "",
    imageMediaId: variant?.imageMediaId ?? null,
    optionInputs: Object.fromEntries(optionNames.map((n) => [n, (variant?.optionValues as Record<string, string> | null | undefined)?.[n] ?? ""])),
  };
}

const numberOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export interface VariantDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productMedia: ProductDetail["media"];
  priceOnRequest: boolean;
  /** The variant to edit first, or null to add a new one. */
  variant: ProductVariant | null;
  /** All the product's variants, listed in the side rail so you can switch without closing the drawer. */
  variants: ProductVariant[];
  /** Names of the product's options; a new variant asks for a value for each. */
  optionNames: string[];
  /** False when this is the product's only variant. */
  canDelete: boolean;
  onChanged: () => void;
}

/**
 * One variant's full details in a side drawer: identity, pricing, shipping size and weight, image, stock rules, pre-order.
 * A rail of the product's variants sits beside the form; edits to each variant are kept while you switch, and one
 * save writes every variant you changed.
 */
export function VariantDrawer(props: VariantDrawerProps) {
  const multi = props.variant !== null && props.variants.length > 1;
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={cn("overflow-y-auto p-0", multi && "data-[side=right]:sm:w-[56%] data-[side=right]:sm:max-w-[60rem]")}>
        {props.open ? <VariantWorkspace key={props.variant?.id ?? "new"} {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function VariantWorkspace({ onOpenChange, productId, productMedia, priceOnRequest, variant, variants, optionNames, canDelete, onChanged }: VariantDrawerProps) {
  const isNew = variant === null;
  const settingsQuery = useQuery(orpc.admin.settings.get.queryOptions());
  const activeWeightUnit: WeightUnit = settingsQuery.data?.weightUnit ?? "g";

  const [activeId, setActiveId] = useState<string>(variant?.id ?? "new");
  const [forms, setForms] = useState<Record<string, FormState>>(() => ({ [variant?.id ?? "new"]: toForm(variant, optionNames, activeWeightUnit) }));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const rail = useMemo(() => variants.filter((v) => !removed.has(v.id)), [variants, removed]);
  const active = isNew ? null : (rail.find((v) => v.id === activeId) ?? rail[0] ?? null);
  const activeKey = active?.id ?? "new";
  const form = forms[activeKey] ?? toForm(active, optionNames, activeWeightUnit);
  const patch = (p: Partial<FormState>) => setForms((prev) => ({ ...prev, [activeKey]: { ...(prev[activeKey] ?? toForm(active, optionNames, activeWeightUnit)), ...p } }));

  const updateMutation = useMutation(orpc.admin.variants.update.mutationOptions());
  const createMutation = useMutation(orpc.admin.variants.create.mutationOptions());
  const deleteMutation = useMutation(orpc.admin.variants.delete.mutationOptions());
  const busy = updateMutation.isPending || createMutation.isPending || deleteMutation.isPending;
  const today = new Date().toISOString().slice(0, 10);

  const isDirty = (v: ProductVariant) => {
    const f = forms[v.id];
    return f ? JSON.stringify(f) !== JSON.stringify(toForm(v, optionNames, activeWeightUnit)) : false;
  };
  const dirtyVariants = rail.filter(isDirty);

  const [pickerOpen, setPickerOpen] = useState(false);
  const matched = productMedia.find((m) => m.mediaId === form.imageMediaId);
  const mediaQuery = useQuery({
    ...orpc.admin.media.get.queryOptions({ input: { id: form.imageMediaId as string } }),
    enabled: Boolean(form.imageMediaId) && !matched,
  });
  const displayUrl = matched?.url ?? mediaQuery.data?.url;
  const productImages = productMedia.filter((m) => m.kind === "image" && Boolean(m.url));
  const railUrl = (mediaId: string | null | undefined) => productMedia.find((m) => m.mediaId === mediaId)?.url;

  function validate(f: FormState, original: ProductVariant | null): string | null {
    if (!f.sku.trim()) return "SKU is required";
    if (!f.title.trim()) return "Title is required";
    if (!priceOnRequest && (f.price === "" || !Number.isFinite(Number(f.price)) || Number(f.price) < 0)) return "Enter a valid price";
    if (!priceOnRequest && f.compare !== "" && (!Number.isFinite(Number(f.compare)) || Number(f.compare) < 0)) return "Enter a valid compare-at price";
    if (f.cost !== "" && (!Number.isFinite(Number(f.cost)) || Number(f.cost) < 0)) return "Enter a valid cost price";
    const w = numberOrNull(f.weight);
    if (w !== null) {
      if (!Number.isFinite(w) || w < 0) return `Enter a valid weight in ${activeWeightUnit}`;
      const grams = unitToGrams(w, activeWeightUnit);
      if (grams > 1_000_000) return "Weight cannot exceed 1,000,000 grams";
    }
    for (const [label, v] of [["Length", f.length], ["Width", f.width], ["Height", f.height]] as const) {
      const n = numberOrNull(v);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1000)) return `${label} must be between 0 and 1000 cm`;
    }
    if (f.preorderEnabled) {
      if (!f.preorderShipsOn) return "Ship date is required for pre-orders";
      if (!original?.preorderEnabled && f.preorderShipsOn <= today) return "Pre-order ship date must be in the future when enabling";
    }
    return null;
  }

  function shared(f: FormState) {
    const l = numberOrNull(f.length);
    const wd = numberOrNull(f.width);
    const h = numberOrNull(f.height);
    const w = numberOrNull(f.weight);
    const weightGrams = w !== null ? unitToGrams(w, activeWeightUnit) : null;
    return {
      weightGrams,
      dimensions: l === null && wd === null && h === null ? null : { ...(l !== null ? { lengthCm: l } : {}), ...(wd !== null ? { widthCm: wd } : {}), ...(h !== null ? { heightCm: h } : {}) },
    };
  }

  async function save() {
    setError(null);
    try {
      if (isNew) {
        const problem = validate(form, null);
        if (problem) return setError(problem);
        const optionValues = Object.fromEntries(Object.entries(form.optionInputs).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
        await createMutation.mutateAsync({
          productId,
          sku: form.sku.trim(),
          title: form.title.trim(),
          price: priceOnRequest ? 0 : toPaise(form.price),
          ...(form.compare !== "" && !priceOnRequest ? { compareAtPrice: toPaise(form.compare) } : {}),
          ...(form.cost !== "" ? { costPrice: toPaise(form.cost) } : {}),
          barcode: form.barcode.trim() || null,
          ...shared(form),
          ...(Object.keys(optionValues).length > 0 ? { optionValues } : {}),
          trackInventory: form.trackInventory,
          allowBackorder: form.allowBackorder,
          ...(form.imageMediaId ? { imageMediaId: form.imageMediaId } : {}),
        });
        toast.success(`Variant ${form.sku.trim()} added`);
        onChanged();
        onOpenChange(false);
        return;
      }

      if (dirtyVariants.length === 0) {
        onOpenChange(false);
        return;
      }
      // Check every edited variant first so nothing is half saved because of a typo in one of them.
      for (const v of dirtyVariants) {
        const problem = validate(forms[v.id] as FormState, v);
        if (problem) {
          setActiveId(v.id);
          return setError(`${v.title}: ${problem}`);
        }
      }
      for (const v of dirtyVariants) {
        const f = forms[v.id] as FormState;
        await updateMutation.mutateAsync({
          id: v.id,
          sku: f.sku.trim(),
          title: f.title.trim(),
          price: priceOnRequest ? 0 : toPaise(f.price),
          compareAtPrice: priceOnRequest || f.compare === "" ? null : toPaise(f.compare),
          costPrice: f.cost === "" ? null : toPaise(f.cost),
          barcode: f.barcode.trim() || null,
          ...shared(f),
          trackInventory: f.trackInventory,
          allowBackorder: f.allowBackorder,
          preorderEnabled: f.preorderEnabled,
          preorderShipsOn: f.preorderEnabled ? f.preorderShipsOn || null : null,
          preorderMessage: f.preorderEnabled ? f.preorderMessage.trim() || null : null,
          imageMediaId: f.imageMediaId,
        });
      }
      toast.success(dirtyVariants.length === 1 ? `Variant ${(forms[dirtyVariants[0]?.id ?? ""] as FormState).sku.trim()} saved` : `${dirtyVariants.length} variants saved`);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Failed to save the variant"));
    }
  }

  async function remove() {
    if (!active) return;
    try {
      await deleteMutation.mutateAsync({ id: active.id });
      toast.success(`Variant ${active.sku} deleted`);
      setConfirmDelete(false);
      onChanged();
      const left = rail.filter((v) => v.id !== active.id);
      if (left.length === 0) {
        onOpenChange(false);
        return;
      }
      setRemoved((prev) => new Set(prev).add(active.id));
      setActiveId(left[0]?.id ?? "");
    } catch (err) {
      setConfirmDelete(false);
      setError(errorMessage(err, "Failed to delete the variant"));
    }
  }

  const showRail = !isNew && rail.length > 1;
  const saveLabel = busy ? "Saving..." : isNew ? "Add variant" : dirtyVariants.length > 1 ? `Save ${dirtyVariants.length} variants` : "Save variant";

  return (
    <>
      <SheetHeader className="border-b border-border p-5 sm:p-8">
        <SheetTitle>{isNew ? "Add variant" : (active?.title ?? "Variant")}</SheetTitle>
        <SheetDescription>
          {isNew
            ? "Add one more way this product can be bought."
            : `SKU ${active?.sku ?? ""}. ${showRail ? "Switch variants on the left; save once to keep every change." : "Changes apply to this variant only."}`}
        </SheetDescription>
      </SheetHeader>

      <div className={cn("flex", showRail ? "flex-col sm:flex-row" : "flex-col")}>
        {showRail ? (
          <nav
            aria-label="Variants"
            className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border p-3 sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4"
          >
            {rail.map((v) => {
              const url = railUrl((forms[v.id]?.imageMediaId ?? v.imageMediaId) as string | null);
              const current = v.id === activeKey;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    setError(null);
                    setActiveId(v.id);
                  }}
                  className={cn(
                    "flex min-w-36 shrink-0 items-center gap-2.5 rounded-md border px-2 py-1.5 text-left transition-colors sm:min-w-0",
                    current ? "border-foreground/30 bg-muted" : "border-transparent hover:bg-muted/50",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/30">
                    {url ? <img src={url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{forms[v.id]?.title || v.title}</span>
                  {isDirty(v) ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
                </button>
              );
            })}
          </nav>
        ) : null}

        <div key={activeKey} className="grid min-w-0 flex-1 gap-8 p-5 text-xs sm:p-8">
          {isNew && optionNames.length > 0 ? (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-foreground">Option values</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {optionNames.map((name) => (
                  <div key={name} className="grid gap-1.5">
                    <FieldLabel htmlFor={`new-opt-${name}`}>{name}</FieldLabel>
                    <Input
                      id={`new-opt-${name}`}
                      value={form.optionInputs[name] ?? ""}
                      onChange={(e) => patch({ optionInputs: { ...form.optionInputs, [name]: e.target.value } })}
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
                <Input id="vd-title" value={form.title} onChange={(e) => patch({ title: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-sku">SKU</FieldLabel>
                <Input id="vd-sku" value={form.sku} onChange={(e) => patch({ sku: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-barcode">Barcode (ISBN, UPC, GTIN)</FieldLabel>
                <Input id="vd-barcode" value={form.barcode} onChange={(e) => patch({ barcode: e.target.value })} />
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Pricing</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-price">Price (₹)</FieldLabel>
                <Input id="vd-price" type="number" step="0.01" min="0" disabled={priceOnRequest} value={priceOnRequest ? "0.00" : form.price} onChange={(e) => patch({ price: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-compare">Compare-at (₹)</FieldLabel>
                <Input id="vd-compare" type="number" step="0.01" min="0" disabled={priceOnRequest} value={priceOnRequest ? "" : form.compare} onChange={(e) => patch({ compare: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-cost">Cost per item (₹)</FieldLabel>
                <Input id="vd-cost" type="number" step="0.01" min="0" value={form.cost} onChange={(e) => patch({ cost: e.target.value })} />
              </div>
            </div>
            {priceOnRequest ? <p className="text-muted-foreground">Price on request is on for this product, so buyers see a quote form instead of a price.</p> : null}
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Weight and size</h3>
            <p className="text-muted-foreground">Used for weight-based delivery rates and courier packing.</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-weight">Weight ({activeWeightUnit})</FieldLabel>
                <Input
                  id="vd-weight"
                  type="number"
                  step={activeWeightUnit === "g" ? "1" : activeWeightUnit === "oz" ? "0.01" : "0.001"}
                  min="0"
                  value={form.weight}
                  onChange={(e) => patch({ weight: e.target.value })}
                  placeholder={activeWeightUnit === "g" ? "e.g. 250" : activeWeightUnit === "kg" ? "e.g. 0.25" : activeWeightUnit === "lb" ? "e.g. 1" : "e.g. 8"}
                />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-length">Length (cm)</FieldLabel>
                <Input id="vd-length" type="number" step="0.1" min="0" value={form.length} onChange={(e) => patch({ length: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-width">Width (cm)</FieldLabel>
                <Input id="vd-width" type="number" step="0.1" min="0" value={form.width} onChange={(e) => patch({ width: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="vd-height">Height (cm)</FieldLabel>
                <Input id="vd-height" type="number" step="0.1" min="0" value={form.height} onChange={(e) => patch({ height: e.target.value })} />
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Image</h3>
            <div className="flex flex-wrap items-center gap-3">
              {displayUrl ? (
                <div className="group relative size-14 overflow-hidden rounded border border-border bg-background">
                  <img src={displayUrl} alt={form.title} className="size-full object-cover" />
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
                      onClick={() => patch({ imageMediaId: m.mediaId })}
                      className={cn("size-9 overflow-hidden rounded border transition-all hover:opacity-80", form.imageMediaId === m.mediaId ? "border-primary ring-2 ring-primary" : "border-border")}
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
              {form.imageMediaId ? (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => patch({ imageMediaId: null })}>
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
                if (selected[0]) patch({ imageMediaId: selected[0].id });
              }}
              title="Select variant image"
            />
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">Stock rules</h3>
            <Field orientation="horizontal" className="justify-between">
              <div>
                <FieldLabel htmlFor="vd-track" className="cursor-pointer text-sm font-normal">Track stock</FieldLabel>
                <p className="text-muted-foreground">Count units and stop selling at zero.</p>
              </div>
              <Switch id="vd-track" checked={form.trackInventory} onCheckedChange={(c) => patch({ trackInventory: Boolean(c) })} />
            </Field>
            <Field orientation="horizontal" className="justify-between">
              <div>
                <FieldLabel htmlFor="vd-backorder" className="cursor-pointer text-sm font-normal">Allow backorders</FieldLabel>
                <p className="text-muted-foreground">Keep selling when stock runs out.</p>
              </div>
              <Switch id="vd-backorder" checked={form.allowBackorder} onCheckedChange={(c) => patch({ allowBackorder: Boolean(c) })} />
            </Field>
            {isNew ? <p className="text-muted-foreground">Set the opening stock from the Inventory page after saving.</p> : null}
          </section>

          {!isNew ? (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-foreground">Pre-order</h3>
              <Field orientation="horizontal" className="justify-between">
                <div>
                  <FieldLabel htmlFor="vd-preorder" className="cursor-pointer text-sm font-normal">Enable pre-order</FieldLabel>
                  <p className="text-muted-foreground">Sell at zero stock with an expected dispatch date.</p>
                </div>
                <Switch id="vd-preorder" checked={form.preorderEnabled} onCheckedChange={(c) => patch({ preorderEnabled: Boolean(c) })} />
              </Field>
              {form.preorderEnabled ? (
                <div className="grid gap-3 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor="vd-ships-on">Expected ship date *</FieldLabel>
                    <Input id="vd-ships-on" type="date" value={form.preorderShipsOn} onChange={(e) => patch({ preorderShipsOn: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor="vd-preorder-msg">Customer message (optional)</FieldLabel>
                    <Input id="vd-preorder-msg" maxLength={200} placeholder="e.g. Dispatches in 2 weeks" value={form.preorderMessage} onChange={(e) => patch({ preorderMessage: e.target.value })} />
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
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-popover px-5 py-4 sm:px-8">
        <div>
          {!isNew ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || !canDelete || rail.length <= 1} onClick={() => setConfirmDelete(true)} title={canDelete && rail.length > 1 ? undefined : "A product needs at least one variant"}>
              <Trash2 className="mr-1.5 size-3.5" aria-hidden /> Delete variant
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {saveLabel}
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
