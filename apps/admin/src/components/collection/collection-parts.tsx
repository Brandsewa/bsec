import { Boxes, ImageIcon, Plus, Trash2, X, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  SimpleSelect,
} from "@bs/ui";
import type { CollectionRule } from "@bs/contracts";
import { formatMoney } from "@bs/contracts/money";
import { useStoreCurrency } from "../../lib/use-store-currency.ts";
import { ProductPickerDialog, type PickedProduct } from "../product/product-picker-dialog.tsx";

/** Manual and Automated side by side in one row. Shared by collections and categories. */
export function CollectionTypeCard({
  value,
  onChange,
  noun,
  idPrefix,
  manualHelp,
  automatedHelp,
}: {
  value: "manual" | "automated";
  onChange: (v: "manual" | "automated") => void;
  /** "collection" or "category", for the card copy. */
  noun: string;
  idPrefix: string;
  manualHelp?: string;
  automatedHelp?: string;
}) {
  const option = (kind: "manual" | "automated", icon: ReactNode, label: string, help: string) => (
    <label
      htmlFor={`${idPrefix}-type-${kind}`}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
        value === kind ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
      }`}
    >
      <RadioGroupItem value={kind} id={`${idPrefix}-type-${kind}`} className="mt-1" />
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 font-medium">
          {icon}
          {label}
        </div>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{noun === "category" ? "Category" : "Collection"} Type</CardTitle>
        <CardDescription>Choose how products are added to this {noun}.</CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup value={value} onValueChange={(v: string) => onChange(v as "manual" | "automated")} className="grid gap-4 sm:grid-cols-2">
          {option(
            "manual",
            <Boxes className="size-4 text-muted-foreground" aria-hidden />,
            `Manual ${noun === "category" ? "Category" : "Collection"}`,
            manualHelp ?? "Add products to this collection one by one and custom order them.",
          )}
          {option(
            "automated",
            <Zap className="size-4 text-muted-foreground" aria-hidden />,
            `Automated ${noun === "category" ? "Category" : "Collection"}`,
            automatedHelp ?? "Existing and future products matching conditions will be automatically added.",
          )}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

/** Manual product assignment: an "Add products" popup lists the whole catalog; the chosen products show below in order. */
export function ProductAssignmentsCard({
  products,
  onChange,
  description = "Pick the products included in this collection, then arrange their order.",
}: {
  products: PickedProduct[];
  onChange: (next: PickedProduct[]) => void;
  description?: string;
}) {
  const storeCurrency = useStoreCurrency();
  const [open, setOpen] = useState(false);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= products.length) return;
    const next = [...products];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold">Product Assignments</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-3.5" aria-hidden />
          Add products
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected Products ({products.length})</div>
        {products.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No products added yet. Choose "Add products" to pick from your catalog.
          </div>
        ) : (
          <ul className="space-y-1">
            {products.map((p, idx) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{idx + 1}</span>
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/30">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.title}</span>
                    {p.priceMin != null ? <span className="block text-xs text-muted-foreground">From {formatMoney(p.priceMin, storeCurrency)}</span> : null}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move ${p.title} up`} disabled={idx === 0} onClick={() => move(idx, idx - 1)}>
                    ↑
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move ${p.title} down`} disabled={idx === products.length - 1} onClick={() => move(idx, idx + 1)}>
                    ↓
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${p.title}`} onClick={() => onChange(products.filter((x) => x.id !== p.id))}>
                    <X className="size-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ProductPickerDialog open={open} onOpenChange={setOpen} selected={products} onSave={onChange} />
    </Card>
  );
}

export const SORT_OPTIONS = [
  { value: "manual", label: "Manually" },
  { value: "best_selling", label: "Best selling" },
  { value: "title_asc", label: "Alphabetically (A-Z)" },
  { value: "title_desc", label: "Alphabetically (Z-A)" },
  { value: "price_asc", label: "Price (low to high)" },
  { value: "price_desc", label: "Price (high to low)" },
  { value: "created_desc", label: "Date: Newest first" },
  { value: "created_asc", label: "Date: Oldest first" },
];

const RULE_FIELDS = [
  { value: "title", label: "Product title" },
  { value: "product_type", label: "Product type" },
  { value: "tag", label: "Product tag" },
  { value: "brand", label: "Brand" },
  { value: "category", label: "Category" },
  { value: "price", label: "Price (minor units)" },
  { value: "in_stock", label: "In stock" },
];

const RULE_OPERATORS = [
  { value: "equals", label: "is equal to" },
  { value: "not_equals", label: "is not equal to" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

export const NEW_RULE: CollectionRule = { field: "tag", operator: "equals", value: "" };

/** Product Sorting card: the default order of products on the page. */
export function ProductSortingCard({ value, onChange, noun }: { value: string; onChange: (v: string) => void; noun: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Product Sorting</CardTitle>
        <CardDescription>Default display order of products in this {noun}.</CardDescription>
      </CardHeader>
      <CardContent>
        <SimpleSelect value={value} options={SORT_OPTIONS} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

/** Conditions of an automated collection or category: products must match all or any of the rules. */
export function RulesBuilderCard({
  rules,
  onRulesChange,
  match,
  onMatchChange,
  idPrefix,
}: {
  rules: CollectionRule[];
  onRulesChange: (next: CollectionRule[]) => void;
  match: "all" | "any";
  onMatchChange: (m: "all" | "any") => void;
  idPrefix: string;
}) {
  const update = (index: number, patch: Partial<CollectionRule>) => onRulesChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Conditions</CardTitle>
        <CardDescription>Products must match these criteria to be included.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Products must match:</span>
          <RadioGroup value={match} onValueChange={(val: string) => onMatchChange(val as "all" | "any")} className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="all" id={`${idPrefix}-match-all`} />
              <label htmlFor={`${idPrefix}-match-all`} className="cursor-pointer">All conditions</label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="any" id={`${idPrefix}-match-any`} />
              <label htmlFor={`${idPrefix}-match-any`} className="cursor-pointer">Any condition</label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-3">
          {rules.map((rule, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <div className="w-36">
                <SimpleSelect value={rule.field} options={RULE_FIELDS} onChange={(val: string) => update(idx, { field: val as CollectionRule["field"] })} />
              </div>
              <div className="w-36">
                <SimpleSelect value={rule.operator} options={RULE_OPERATORS} onChange={(val: string) => update(idx, { operator: val as CollectionRule["operator"] })} />
              </div>
              {!["is_set", "is_not_set"].includes(rule.operator) && (
                <Input placeholder="Condition value" value={String(rule.value ?? "")} onChange={(e) => update(idx, { value: e.target.value })} className="min-w-[140px] flex-1" />
              )}
              {rules.length > 1 && (
                <Button type="button" variant="ghost" size="sm" aria-label="Remove condition" onClick={() => onRulesChange(rules.filter((_, i) => i !== idx))}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onRulesChange([...rules, { ...NEW_RULE }])}>
            <Plus className="mr-1.5 size-3.5" />
            Add another condition
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
