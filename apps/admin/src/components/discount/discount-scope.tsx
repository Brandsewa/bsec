import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Tag, Truck, X } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Field, FieldDescription, FieldGroup, FieldLabel, Input, SimpleSelect } from "@bs/ui";
import type { DiscountAppliesTo, DiscountRules } from "@bs/contracts/discount-rules";
import { orpc } from "../../lib/orpc.ts";
import { ProductPickerDialog, type PickedProduct } from "../product/product-picker-dialog.tsx";

/** The three families of discount a merchant picks from (Shopify's classes): what the discount takes money off. */
export type DiscountKind = "products" | "order" | "shipping";

export type DiscountType = "percent" | "fixed" | "free_shipping";

export interface ScopeState {
  target: "products" | "collections";
  products: PickedProduct[];
  collectionIds: string[];
  /** Whole currency units, "" = no cap. */
  maxDiscount: string;
  excludeOnSale: boolean;
  oncePerOrder: boolean;
}

export const emptyScope: ScopeState = { target: "products", products: [], collectionIds: [], maxDiscount: "", excludeOnSale: false, oncePerOrder: false };

/** The kind and the scope fields a stored discount starts the edit form with. */
export function scopeFromDiscount(d: {
  type: string;
  appliesTo: DiscountAppliesTo;
  appliesToItems?: Array<{ id: string; title: string }> | undefined;
  rules: DiscountRules;
}): { kind: DiscountKind; scope: ScopeState } {
  const kind: DiscountKind = d.type === "free_shipping" ? "shipping" : d.appliesTo.type === "all" ? "order" : "products";
  return {
    kind,
    scope: {
      target: d.appliesTo.type === "collections" ? "collections" : "products",
      products: d.appliesTo.type === "products" ? (d.appliesToItems ?? d.appliesTo.productIds.map((id) => ({ id, title: "Product" }))).map((p) => ({ id: p.id, title: p.title })) : [],
      collectionIds: d.appliesTo.type === "collections" ? d.appliesTo.collectionIds : [],
      maxDiscount: d.rules.maxDiscount ? String(d.rules.maxDiscount / 100) : "",
      excludeOnSale: d.rules.excludeOnSale ?? false,
      oncePerOrder: d.rules.oncePerOrder ?? false,
    },
  };
}

/** True when the scope fields describe a valid discount of this kind. */
export function scopeValid(kind: DiscountKind, type: DiscountType, scope: ScopeState): boolean {
  if (kind === "products") {
    if (scope.target === "products" ? scope.products.length === 0 : scope.collectionIds.length === 0) return false;
  }
  if (scope.maxDiscount.trim() !== "" && type === "percent") {
    const n = Number(scope.maxDiscount);
    if (!Number.isFinite(n) || n <= 0) return false;
  }
  return true;
}

/** The `appliesTo` and `rules` the API takes, from the form. Amounts go from whole currency units to minor units. */
export function buildSetup(kind: DiscountKind, type: DiscountType, scope: ScopeState): { appliesTo: DiscountAppliesTo; rules: DiscountRules } {
  const appliesTo: DiscountAppliesTo =
    kind !== "products"
      ? { type: "all" }
      : scope.target === "products"
        ? { type: "products", productIds: scope.products.map((p) => p.id) }
        : { type: "collections", collectionIds: scope.collectionIds };
  const rules: DiscountRules = {};
  if (type === "percent" && scope.maxDiscount.trim() !== "") rules.maxDiscount = Math.round(Number(scope.maxDiscount) * 100);
  if (kind !== "shipping" && scope.excludeOnSale) rules.excludeOnSale = true;
  if (kind === "products" && type === "fixed" && scope.oncePerOrder) rules.oncePerOrder = true;
  return { appliesTo, rules };
}

const KINDS: Array<{ kind: DiscountKind; title: string; text: string; icon: typeof Package }> = [
  { kind: "products", title: "Amount off products", text: "A percentage or amount off chosen products or collections.", icon: Package },
  { kind: "order", title: "Amount off order", text: "A percentage or amount off the whole order.", icon: Tag },
  { kind: "shipping", title: "Free shipping", text: "Waive the shipping charge on an order.", icon: Truck },
];

/** Step one: what kind of discount this is. */
export function DiscountKindCards({ kind, onChange }: { kind: DiscountKind; onChange: (k: DiscountKind) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discount type</CardTitle>
        <CardDescription>What should the discount take money off?</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Discount type">
          {KINDS.map(({ kind: k, title, text, icon: Icon }) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => onChange(k)}
              className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${kind === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                <Icon className="size-4" aria-hidden /> {title}
              </span>
              <span className="text-muted-foreground">{text}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Step two for product discounts and the extras for order ones: which items, the cap, sale items. */
export function DiscountScopeCard({
  kind,
  type,
  sym,
  scope,
  onChange,
}: {
  kind: DiscountKind;
  type: DiscountType;
  sym: string;
  scope: ScopeState;
  onChange: (next: ScopeState) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const collections = useQuery({ ...orpc.admin.collections.list.queryOptions({ input: {} }), enabled: kind === "products" && scope.target === "collections" });
  const set = (patch: Partial<ScopeState>) => onChange({ ...scope, ...patch });

  if (kind === "shipping") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{kind === "products" ? "Applies to" : "Options"}</CardTitle>
        {kind === "products" ? <CardDescription>Only matching items in the cart get the discount.</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {kind === "products" ? (
            <>
              <Field>
                <FieldLabel htmlFor="discount-target">Choose by</FieldLabel>
                <SimpleSelect
                  id="discount-target"
                  value={scope.target}
                  onChange={(v) => set({ target: v as ScopeState["target"] })}
                  options={[
                    { value: "products", label: "Specific products" },
                    { value: "collections", label: "Specific collections" },
                  ]}
                />
              </Field>
              {scope.target === "products" ? (
                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel>Products ({scope.products.length})</FieldLabel>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                      {scope.products.length ? "Change products" : "Browse products"}
                    </Button>
                  </div>
                  {scope.products.length > 0 ? (
                    <ul className="grid gap-1">
                      {scope.products.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                          <span className="truncate">{p.title}</span>
                          <button type="button" aria-label={`Remove ${p.title}`} className="text-muted-foreground hover:text-foreground" onClick={() => set({ products: scope.products.filter((x) => x.id !== p.id) })}>
                            <X className="size-4" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <FieldDescription>No products chosen yet.</FieldDescription>
                  )}
                  <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} selected={scope.products} onSave={(products) => set({ products: products.map((p) => ({ id: p.id, title: p.title })) })} />
                </Field>
              ) : (
                <Field>
                  <FieldLabel>Collections ({scope.collectionIds.length})</FieldLabel>
                  {collections.isLoading ? (
                    <FieldDescription>Loading collections…</FieldDescription>
                  ) : (collections.data ?? []).length === 0 ? (
                    <FieldDescription>You have no collections yet. Create one under Products, then come back.</FieldDescription>
                  ) : (
                    <ul className="grid max-h-56 gap-1 overflow-y-auto">
                      {(collections.data ?? []).map((c) => (
                        <li key={c.id}>
                          <label className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
                            <Checkbox
                              checked={scope.collectionIds.includes(c.id)}
                              onCheckedChange={(on) => set({ collectionIds: on ? [...scope.collectionIds, c.id] : scope.collectionIds.filter((x) => x !== c.id) })}
                            />
                            <span className="truncate">{c.title}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </Field>
              )}
            </>
          ) : null}

          {type === "percent" ? (
            <Field>
              <FieldLabel htmlFor="discount-cap">Maximum discount ({sym}, optional)</FieldLabel>
              <Input id="discount-cap" type="number" min={1} step="1" value={scope.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} placeholder="No maximum" />
              <FieldDescription>For example, 20% off up to {sym}500.</FieldDescription>
            </Field>
          ) : null}

          {kind === "products" && type === "fixed" ? (
            <Field orientation="horizontal">
              <Checkbox id="discount-once" checked={scope.oncePerOrder} onCheckedChange={(c) => set({ oncePerOrder: c === true })} />
              <FieldLabel htmlFor="discount-once" className="font-normal">
                Take the amount off once per order (otherwise it comes off every item)
              </FieldLabel>
            </Field>
          ) : null}

          <Field orientation="horizontal">
            <Checkbox id="discount-sale" checked={scope.excludeOnSale} onCheckedChange={(c) => set({ excludeOnSale: c === true })} />
            <FieldLabel htmlFor="discount-sale" className="font-normal">
              Leave out items that are already on sale
            </FieldLabel>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
