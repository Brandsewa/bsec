import { ImageIcon, Plus, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldLabel,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import type { ProductDetail, ProductVariant } from "@bs/contracts";
import { client, orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { useBulkRunner } from "../data-table/use-bulk-runner.ts";
import { MAX_OPTIONS, MAX_VARIANTS, MAX_VALUES, cleanOptions, optionCombinations, previewGrid, sameCombo, type DraftOption } from "../../lib/variant-grid.ts";
import { VariantDrawer } from "./variant-drawer.tsx";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);

/** Values of one option as removable chips; Enter or a comma adds, Backspace on an empty field removes the last. */
function ValueChips({ values, onChange, label }: { values: string[]; onChange: (next: string[]) => void; label: string }) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      next.push(p);
    }
    onChange(next);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-muted/30 px-2 py-1.5 focus-within:border-ring">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
          {v}
          <button
            type="button"
            className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(text)}
        placeholder={values.length === 0 ? "Type a value and press Enter" : "Add another"}
        className="min-w-32 flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export interface VariantBuilderProps {
  product: ProductDetail;
  priceOnRequest: boolean;
  onChanged: () => void;
}

/**
 * Variants builder (owner request 2026-10-17): define options such as Size and Colour, see how many variants that makes,
 * apply, then manage each variant (SKU, price, weight, barcode, image...) in a side drawer or set prices in bulk.
 */
export function VariantBuilderCard({ product, priceOnRequest, onChanged }: VariantBuilderProps) {
  const initial: DraftOption[] = useMemo(() => product.options.map((o) => ({ name: o.name, values: [...o.values] })), [product.options]);
  const [draft, setDraft] = useState<DraftOption[]>(initial);
  const [drawerVariant, setDrawerVariant] = useState<ProductVariant | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkCompare, setBulkCompare] = useState("");
  const bulk = useBulkRunner();

  const setOptions = useMutation(orpc.admin.products.setOptions.mutationOptions());

  const cleaned = useMemo(() => cleanOptions(draft), [draft]);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(cleanOptions(initial));
  const preview = useMemo(() => previewGrid(draft, product.variants), [draft, product.variants]);
  const optionNames = product.options.map((o) => o.name);

  // Variants that match no combination of the saved options (the builder never deletes these by itself).
  const savedCombos = useMemo(() => optionCombinations(cleanOptions(initial)), [initial]);
  const outsideGrid = (v: ProductVariant) =>
    savedCombos.length > 0 && !savedCombos.some((c) => sameCombo(v.optionValues as Record<string, string> | null, c));

  const mediaUrl = (mediaId: string | null | undefined) => product.media.find((m) => m.mediaId === mediaId)?.url;

  async function apply() {
    if (preview.error) return;
    try {
      const options = cleaned.filter((o) => o.name && o.values.length > 0);
      await setOptions.mutateAsync({ id: product.id, options });
      toast.success(preview.toCreate > 0 ? `Options saved. ${preview.toCreate} variant${preview.toCreate === 1 ? "" : "s"} added.` : "Options saved.");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the options"));
    }
  }

  function openDrawer(v: ProductVariant | null) {
    setDrawerVariant(v);
    setDrawerOpen(true);
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allSelected = product.variants.length > 0 && product.variants.every((v) => selected.has(v.id));

  async function applyBulk() {
    const priceOk = bulkPrice === "" || (Number.isFinite(Number(bulkPrice)) && Number(bulkPrice) >= 0);
    const compareOk = bulkCompare === "" || (Number.isFinite(Number(bulkCompare)) && Number(bulkCompare) >= 0);
    if (!priceOk || !compareOk || (bulkPrice === "" && bulkCompare === "")) {
      toast.error("Enter a valid price or compare-at price.");
      return;
    }
    setBulkOpen(false);
    await bulk.run({
      rows: product.variants.filter((v) => selected.has(v.id)),
      getId: (v) => v.id,
      getLabel: (v) => v.sku,
      verb: "Updating",
      done: "updated",
      noun: "variant",
      action: (v) =>
        client.admin.variants.update({
          id: v.id,
          ...(bulkPrice !== "" ? { price: toPaise(bulkPrice) } : {}),
          ...(bulkCompare !== "" ? { compareAtPrice: toPaise(bulkCompare) } : {}),
        }),
      onFinished: () => {
        setSelected(new Set());
        setBulkPrice("");
        setBulkCompare("");
        onChanged();
      },
    });
  }

  const showOptionsEditor = draft.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Variants & Pricing</CardTitle>
        <CardDescription>
          Add options like size or colour to sell this product in different versions. Click a variant to edit its SKU, price, weight and more.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {/* Options */}
        <section className="grid gap-3" aria-label="Options">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Options</h3>
            {draft.length < MAX_OPTIONS ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft((d) => [...d, { name: "", values: [] }]);
                }}
              >
                <Plus className="mr-1.5 size-3.5" aria-hidden /> Add option
              </Button>
            ) : null}
          </div>

          {showOptionsEditor && draft.length > 0 ? (
            <div className="grid gap-3">
              {draft.map((opt, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor={`opt-name-${i}`}>Option name</FieldLabel>
                    <Input
                      id={`opt-name-${i}`}
                      value={opt.name}
                      placeholder="e.g. Size"
                      maxLength={40}
                      onChange={(e) => setDraft((d) => d.map((o, j) => (j === i ? { ...o, name: e.target.value } : o)))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <FieldLabel>Values ({opt.values.length} of {MAX_VALUES})</FieldLabel>
                    <ValueChips
                      label={`Values for ${opt.name || "option"}`}
                      values={opt.values}
                      onChange={(next) => setDraft((d) => d.map((o, j) => (j === i ? { ...o, values: next } : o)))}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive sm:mt-6"
                    onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                    aria-label={`Remove option ${opt.name || i + 1}`}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={preview.error ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"} role={preview.error ? "alert" : undefined}>
                  {preview.error
                    ? preview.error
                    : dirty
                      ? `${preview.total} variant${preview.total === 1 ? "" : "s"} in total. ${preview.toCreate} new will be added; existing variants keep their price, SKU and stock. Limit ${MAX_VARIANTS}.`
                      : `${preview.total} variant${preview.total === 1 ? "" : "s"} from these options.`}
                </p>
                <div className="flex items-center gap-2">
                  {dirty ? (
                    <Button type="button" variant="ghost" size="sm" disabled={setOptions.isPending} onClick={() => setDraft(initial)}>
                      Discard
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" disabled={!dirty || Boolean(preview.error) || setOptions.isPending} onClick={() => void apply()}>
                    {setOptions.isPending ? "Applying..." : "Apply options"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No options yet. This product is sold as a single version. Add an option to create variants.</p>
          )}
        </section>

        {/* Variants */}
        <section className="grid gap-3" aria-label="Variants">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Variants ({product.variants.length})</h3>
            <div className="flex items-center gap-2">
              {selected.size > 0 ? (
                <Button type="button" variant="outline" size="sm" disabled={bulk.busy || priceOnRequest} onClick={() => setBulkOpen(true)}>
                  Set price for {selected.size}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" disabled={product.variants.length >= MAX_VARIANTS} onClick={() => openDrawer(null)}>
                <Plus className="mr-1.5 size-3.5" aria-hidden /> Add variant
              </Button>
            </div>
          </div>

          {bulk.progress ? (
            <p role="status" className="text-xs text-muted-foreground">
              {bulk.progress.label}… {bulk.progress.done}/{bulk.progress.total}
            </p>
          ) : null}

          {product.variants.length === 0 ? (
            <EmptyState title="No variants" description="This product has no variants yet." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-10 px-3">
                      <Checkbox
                        aria-label="Select all variants"
                        checked={allSelected}
                        onCheckedChange={(c) => setSelected(c ? new Set(product.variants.map((v) => v.id)) : new Set())}
                      />
                    </TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="w-24 text-right">&nbsp;</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {product.variants.map((v) => {
                    const url = mediaUrl(v.imageMediaId);
                    return (
                      <TableRow key={v.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openDrawer(v)}>
                        <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label={`Select ${v.title}`} checked={selected.has(v.id)} onCheckedChange={(c) => toggle(v.id, Boolean(c))} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/30">
                              {url ? <img src={url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{v.title}</div>
                              {outsideGrid(v) ? <div className="text-[11px] text-amber-600 dark:text-amber-400">Not in the option grid</div> : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{v.sku}</TableCell>
                        <TableCell className="text-right text-sm">{priceOnRequest ? "Quote only" : inr.format(v.price / 100)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{v.weightGrams != null ? `${v.weightGrams} g` : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDrawer(v);
                            }}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </CardContent>

      <VariantDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        productId={product.id}
        productMedia={product.media}
        priceOnRequest={priceOnRequest}
        variant={drawerVariant}
        optionNames={optionNames}
        canDelete={product.variants.length > 1}
        onChanged={onChanged}
      />

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set price for {selected.size} variant{selected.size === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>Leave a field empty to keep each variant's current value.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="bulk-price">Price (₹)</FieldLabel>
              <Input id="bulk-price" type="number" step="0.01" min="0" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="bulk-compare">Compare-at (₹)</FieldLabel>
              <Input id="bulk-compare" type="number" step="0.01" min="0" value={bulkCompare} onChange={(e) => setBulkCompare(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void applyBulk()}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
