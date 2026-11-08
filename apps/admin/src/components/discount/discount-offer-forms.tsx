import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Field, FieldDescription, FieldGroup, FieldLabel, Input, SimpleSelect } from "@bs/ui";
import type { DiscountAppliesTo, DiscountRules } from "@bs/contracts/discount-rules";
import { orpc } from "../../lib/orpc.ts";
import { ProductPickerDialog, type PickedProduct } from "../product/product-picker-dialog.tsx";

/** A choice of items: everything, chosen products, or chosen collections. Used for the "buy", "get" and bundle parts of an offer. */
export interface ItemScope {
  target: "all" | "products" | "collections";
  products: PickedProduct[];
  collectionIds: string[];
}

export const emptyItemScope: ItemScope = { target: "all", products: [], collectionIds: [] };

export function itemScopeValid(s: ItemScope): boolean {
  return s.target === "all" || (s.target === "products" ? s.products.length > 0 : s.collectionIds.length > 0);
}

export function itemScopeToApplies(s: ItemScope): DiscountAppliesTo {
  return s.target === "products" ? { type: "products", productIds: s.products.map((p) => p.id) } : s.target === "collections" ? { type: "collections", collectionIds: s.collectionIds } : { type: "all" };
}

/** Shows the names of chosen products when the server sent them; otherwise a placeholder until the picker is opened. */
export function itemScopeFromApplies(a: DiscountAppliesTo, names?: Map<string, string>): ItemScope {
  if (a.type === "products") return { target: "products", products: a.productIds.map((id) => ({ id, title: names?.get(id) ?? "Product" })), collectionIds: [] };
  if (a.type === "collections") return { target: "collections", products: [], collectionIds: a.collectionIds };
  return emptyItemScope;
}

export function ItemScopePicker({ idPrefix, label, value, onChange }: { idPrefix: string; label: string; value: ItemScope; onChange: (next: ItemScope) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const collections = useQuery({ ...orpc.admin.collections.list.queryOptions({ input: {} }), enabled: value.target === "collections" });
  const set = (patch: Partial<ItemScope>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-2">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-target`}>{label}</FieldLabel>
        <SimpleSelect
          id={`${idPrefix}-target`}
          value={value.target}
          onChange={(v) => set({ target: v as ItemScope["target"] })}
          options={[
            { value: "all", label: "Any product" },
            { value: "products", label: "Specific products" },
            { value: "collections", label: "Specific collections" },
          ]}
        />
      </Field>
      {value.target === "products" ? (
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>Products ({value.products.length})</FieldLabel>
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              {value.products.length ? "Change products" : "Browse products"}
            </Button>
          </div>
          {value.products.length > 0 ? (
            <ul className="grid gap-1">
              {value.products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                  <span className="truncate">{p.title}</span>
                  <button type="button" aria-label={`Remove ${p.title}`} className="text-muted-foreground hover:text-foreground" onClick={() => set({ products: value.products.filter((x) => x.id !== p.id) })}>
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <FieldDescription>No products chosen yet.</FieldDescription>
          )}
          <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} selected={value.products} onSave={(products) => set({ products: products.map((p) => ({ id: p.id, title: p.title })) })} />
        </Field>
      ) : null}
      {value.target === "collections" ? (
        <Field>
          <FieldLabel>Collections ({value.collectionIds.length})</FieldLabel>
          {collections.isLoading ? (
            <FieldDescription>Loading collections…</FieldDescription>
          ) : (collections.data ?? []).length === 0 ? (
            <FieldDescription>You have no collections yet. Create one under Products, then come back.</FieldDescription>
          ) : (
            <ul className="grid max-h-56 gap-1 overflow-y-auto">
              {(collections.data ?? []).map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
                    <Checkbox checked={value.collectionIds.includes(c.id)} onCheckedChange={(on) => set({ collectionIds: on ? [...value.collectionIds, c.id] : value.collectionIds.filter((x) => x !== c.id) })} />
                    <span className="truncate">{c.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Buy X get Y

export interface BxgyState {
  trigger: "quantity" | "amount";
  /** Items to buy, or whole currency units to spend. */
  buyValue: string;
  buyScope: ItemScope;
  getQuantity: string;
  getScope: ItemScope;
  effect: "free" | "percent" | "fixed_price";
  /** A percentage, or whole currency units for a fixed price. */
  effectValue: string;
  /** "" = as often as the cart allows (quantity) or once (amount). */
  maxUses: string;
  /** Add the free items to the cart by itself. Only for a free offer. */
  autoAdd: boolean;
}

export const emptyBxgy: BxgyState = { trigger: "quantity", buyValue: "2", buyScope: emptyItemScope, getQuantity: "1", getScope: emptyItemScope, effect: "free", effectValue: "", maxUses: "", autoAdd: true };

const wholeAtLeast1 = (raw: string) => raw.trim() !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 1;
const positive = (raw: string) => raw.trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0;

export function bxgyValid(b: BxgyState): boolean {
  if (b.trigger === "quantity" ? !wholeAtLeast1(b.buyValue) : !positive(b.buyValue)) return false;
  if (!wholeAtLeast1(b.getQuantity) || !itemScopeValid(b.buyScope) || !itemScopeValid(b.getScope)) return false;
  if (b.effect === "percent" && !(positive(b.effectValue) && Number(b.effectValue) <= 100)) return false;
  if (b.effect === "fixed_price" && !positive(b.effectValue)) return false;
  return b.maxUses.trim() === "" || wholeAtLeast1(b.maxUses);
}

export function bxgyToRules(b: BxgyState): NonNullable<DiscountRules["bxgy"]> {
  return {
    buy: { trigger: b.trigger, value: b.trigger === "amount" ? Math.round(Number(b.buyValue) * 100) : Math.round(Number(b.buyValue)), appliesTo: itemScopeToApplies(b.buyScope) },
    get: {
      quantity: Math.round(Number(b.getQuantity)),
      appliesTo: itemScopeToApplies(b.getScope),
      effect: b.effect,
      ...(b.effect === "percent" ? { value: Math.round(Number(b.effectValue)) } : b.effect === "fixed_price" ? { value: Math.round(Number(b.effectValue) * 100) } : {}),
    },
    ...(b.maxUses.trim() !== "" ? { maxUsesPerOrder: Math.round(Number(b.maxUses)) } : {}),
    ...(b.effect === "free" ? { autoAdd: b.autoAdd } : {}),
  };
}

export function bxgyFromRules(r: NonNullable<DiscountRules["bxgy"]>, names?: Map<string, string>): BxgyState {
  return {
    trigger: r.buy.trigger,
    buyValue: r.buy.trigger === "amount" ? String(r.buy.value / 100) : String(r.buy.value),
    buyScope: itemScopeFromApplies(r.buy.appliesTo, names),
    getQuantity: String(r.get.quantity),
    getScope: itemScopeFromApplies(r.get.appliesTo, names),
    effect: r.get.effect,
    effectValue: r.get.value === undefined ? "" : r.get.effect === "fixed_price" ? String(r.get.value / 100) : String(r.get.value),
    maxUses: r.maxUsesPerOrder === undefined ? "" : String(r.maxUsesPerOrder),
    autoAdd: r.autoAdd ?? r.get.effect === "free",
  };
}

export function BxgyCard({ sym, value, onChange }: { sym: string; value: BxgyState; onChange: (next: BxgyState) => void }) {
  const set = (patch: Partial<BxgyState>) => onChange({ ...value, ...patch });
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Customer buys</CardTitle>
          <CardDescription>What the customer has to put in the cart first.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="bxgy-trigger">Minimum requirement</FieldLabel>
                <SimpleSelect
                  id="bxgy-trigger"
                  value={value.trigger}
                  onChange={(v) => set({ trigger: v as BxgyState["trigger"] })}
                  options={[
                    { value: "quantity", label: "Number of items" },
                    { value: "amount", label: "Amount spent" },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="bxgy-buy">{value.trigger === "quantity" ? "Items to buy" : `Amount to spend (${sym})`}</FieldLabel>
                <Input id="bxgy-buy" type="number" min={1} step={value.trigger === "quantity" ? "1" : "0.01"} value={value.buyValue} onChange={(e) => set({ buyValue: e.target.value })} />
              </Field>
            </div>
            <ItemScopePicker idPrefix="bxgy-buy-scope" label="Any items from" value={value.buyScope} onChange={(buyScope) => set({ buyScope })} />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer gets</CardTitle>
          <CardDescription>The cheapest matching items in the cart get the offer. For a free gift, choose the gift product and a spend amount above.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="bxgy-get-qty">Items they get</FieldLabel>
                <Input id="bxgy-get-qty" type="number" min={1} step="1" value={value.getQuantity} onChange={(e) => set({ getQuantity: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="bxgy-effect">At a discounted value of</FieldLabel>
                <SimpleSelect
                  id="bxgy-effect"
                  value={value.effect}
                  onChange={(v) => set({ effect: v as BxgyState["effect"] })}
                  options={[
                    { value: "free", label: "Free" },
                    { value: "percent", label: "Percentage off" },
                    { value: "fixed_price", label: `Fixed price (${sym})` },
                  ]}
                />
              </Field>
            </div>
            {value.effect !== "free" ? (
              <Field>
                <FieldLabel htmlFor="bxgy-effect-value">{value.effect === "percent" ? "Percentage off (%)" : `Price each (${sym})`}</FieldLabel>
                <Input id="bxgy-effect-value" type="number" min={1} max={value.effect === "percent" ? 100 : undefined} step={value.effect === "percent" ? "1" : "0.01"} value={value.effectValue} onChange={(e) => set({ effectValue: e.target.value })} />
              </Field>
            ) : null}
            <ItemScopePicker idPrefix="bxgy-get-scope" label="Any items from" value={value.getScope} onChange={(getScope) => set({ getScope })} />
            {value.effect === "free" ? (
              <Field orientation="horizontal">
                <Checkbox id="bxgy-auto-add" checked={value.autoAdd} onCheckedChange={(c) => set({ autoAdd: c === true })} />
                <FieldLabel htmlFor="bxgy-auto-add" className="font-normal">
                  Add the free items to the cart automatically
                </FieldLabel>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="bxgy-max">Uses per order (optional)</FieldLabel>
              <Input id="bxgy-max" type="number" min={1} step="1" value={value.maxUses} onChange={(e) => set({ maxUses: e.target.value })} placeholder={value.trigger === "quantity" ? "As often as the cart allows" : "Once"} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Bundle

export interface BundleState {
  quantity: string;
  /** Whole currency units. */
  price: string;
  scope: ItemScope;
}

export const emptyBundle: BundleState = { quantity: "3", price: "", scope: emptyItemScope };

export function bundleValid(b: BundleState): boolean {
  return Number.isInteger(Number(b.quantity)) && Number(b.quantity) >= 2 && positive(b.price) && itemScopeValid(b.scope);
}

export function bundleToRules(b: BundleState): NonNullable<DiscountRules["bundle"]> {
  return { quantity: Math.round(Number(b.quantity)), price: Math.round(Number(b.price) * 100), appliesTo: itemScopeToApplies(b.scope) };
}

export function bundleFromRules(r: NonNullable<DiscountRules["bundle"]>, names?: Map<string, string>): BundleState {
  return { quantity: String(r.quantity), price: String(r.price / 100), scope: itemScopeFromApplies(r.appliesTo, names) };
}

export function BundleCard({ sym, value, onChange }: { sym: string; value: BundleState; onChange: (next: BundleState) => void }) {
  const set = (patch: Partial<BundleState>) => onChange({ ...value, ...patch });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bundle</CardTitle>
        <CardDescription>Any group of this many items together costs the bundle price. Items left over pay full price.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="bundle-qty">Items in a bundle</FieldLabel>
              <Input id="bundle-qty" type="number" min={2} step="1" value={value.quantity} onChange={(e) => set({ quantity: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="bundle-price">Bundle price ({sym})</FieldLabel>
              <Input id="bundle-price" type="number" min={1} step="0.01" value={value.price} onChange={(e) => set({ price: e.target.value })} />
            </Field>
          </div>
          <ItemScopePicker idPrefix="bundle-scope" label="Items that count" value={value.scope} onChange={(scope) => set({ scope })} />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
