import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  Field,
  FieldLabel,
  Input,
  SimpleSelect,
  Switch,
} from "@bs/ui";
import { categoryLabel } from "../../lib/category-label.ts";

export type ProductStatus = "draft" | "active" | "unlisted" | "archived";

/** Status dropdown and the featured switch. Same card on the add and the edit page. */
export function StatusVisibilityCard({
  status,
  onStatusChange,
  isFeatured,
  onFeaturedChange,
  hasPrimaryCategory,
}: {
  status: ProductStatus;
  onStatusChange: (s: ProductStatus) => void;
  isFeatured: boolean;
  onFeaturedChange: (v: boolean) => void;
  hasPrimaryCategory: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Status & Visibility</CardTitle>
        <CardDescription>Control how and where this product is listed.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="product-status">Product Status</FieldLabel>
          <SimpleSelect
            id="product-status"
            value={status}
            onChange={(val) => onStatusChange(val as ProductStatus)}
            options={[
              { value: "draft", label: "Draft" },
              { value: "active", label: "Active" },
              { value: "unlisted", label: "Unlisted" },
              { value: "archived", label: "Archived" },
            ]}
          />
          {status === "unlisted" && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Unlisted products are reachable only by direct URL link; hidden from catalog lists, search, and sitemap.
            </p>
          )}
          {(status === "active" || status === "unlisted") && !hasPrimaryCategory && (
            <p className="mt-1 text-xs text-destructive">A primary category is required to publish or list this product.</p>
          )}
        </div>

        <Field orientation="horizontal" className="justify-between border-t border-border pt-3">
          <div>
            <FieldLabel htmlFor="is-featured" className="cursor-pointer text-sm font-medium">
              Featured product
            </FieldLabel>
            <p className="text-xs text-muted-foreground">Highlight this product on the home page and featured grids.</p>
          </div>
          <Switch id="is-featured" checked={isFeatured} onCheckedChange={(c) => onFeaturedChange(Boolean(c))} />
        </Field>
      </CardContent>
    </Card>
  );
}

export interface PreorderValue {
  enabled: boolean;
  shipsOn: string;
  message: string;
}

/** Price on request and the product-wide pre-order switch (applied to every variant). */
export function PricingQuotesCard({
  priceOnRequest,
  onPriceOnRequestChange,
  preorder,
  onPreorderChange,
  mixedPreorder,
  errors,
}: {
  priceOnRequest: boolean;
  onPriceOnRequestChange: (v: boolean) => void;
  preorder: PreorderValue;
  onPreorderChange: (v: PreorderValue) => void;
  /** Some, but not all, variants are on pre-order (set individually in the variant drawer). */
  mixedPreorder?: boolean;
  errors?: Record<string, string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Pricing & Quotes</CardTitle>
        <CardDescription>Price on request hides checkout prices and routes buyers to quote requests.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field orientation="horizontal" className="justify-between">
          <div>
            <FieldLabel htmlFor="price-on-request" className="cursor-pointer font-medium">
              Price on request
            </FieldLabel>
            <p className="text-xs text-muted-foreground">Hide prices and require customers to submit quote requests.</p>
          </div>
          <Switch id="price-on-request" checked={priceOnRequest} onCheckedChange={(c) => onPriceOnRequestChange(Boolean(c))} />
        </Field>

        <Field orientation="horizontal" className="justify-between border-t border-border pt-3">
          <div>
            <FieldLabel htmlFor="product-preorder" className="cursor-pointer font-medium">
              Enable pre-order
            </FieldLabel>
            <p className="text-xs text-muted-foreground">
              Sell at zero stock with an expected dispatch date. Applies to every variant of this product.
            </p>
            {mixedPreorder ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Only some variants are on pre-order right now. Switching this on or off changes all of them.
              </p>
            ) : null}
          </div>
          <Switch
            id="product-preorder"
            checked={preorder.enabled}
            onCheckedChange={(c) => onPreorderChange({ ...preorder, enabled: Boolean(c) })}
          />
        </Field>

        {preorder.enabled ? (
          <div className="grid gap-3 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="preorder-ships-on">Expected ship date *</FieldLabel>
              <Input
                id="preorder-ships-on"
                type="date"
                value={preorder.shipsOn}
                onChange={(e) => onPreorderChange({ ...preorder, shipsOn: e.target.value })}
                aria-invalid={Boolean(errors?.["preorderShipsOn"])}
              />
              {errors?.["preorderShipsOn"] ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors["preorderShipsOn"]}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="preorder-message">Customer message (optional)</FieldLabel>
              <Input
                id="preorder-message"
                maxLength={200}
                placeholder="e.g. Handmade in small batches"
                value={preorder.message}
                onChange={(e) => onPreorderChange({ ...preorder, message: e.target.value })}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface PickItem {
  id: string;
  label: string;
}

/** Searchable tick-list in a popup. Changes apply only when Save is pressed. */
export function MultiPickDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  selected,
  onSave,
  emptyText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  items: PickItem[];
  selected: string[];
  onSave: (ids: string[]) => void;
  emptyText: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <PickBody
            title={title}
            description={description}
            items={items}
            selected={selected}
            emptyText={emptyText}
            onCancel={() => onOpenChange(false)}
            onSave={(ids) => {
              onSave(ids);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PickBody({
  title,
  description,
  items,
  selected,
  emptyText,
  onCancel,
  onSave,
}: {
  title: string;
  description: string;
  items: PickItem[];
  selected: string[];
  emptyText: string;
  onCancel: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const toggle = (id: string, on: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {items.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label={`Search ${title.toLowerCase()}`} className="pl-8" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing matches "{query}".</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer select-none items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                  <Checkbox checked={draft.has(i.id)} onCheckedChange={(c) => toggle(i.id, Boolean(c))} />
                  <span className="truncate">{i.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">{draft.size} selected</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave([...draft])}>
            Save
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function PickedChips({ labels, onRemove, emptyText }: { labels: Array<{ id: string; label: string }>; onRemove: (id: string) => void; emptyText: string }) {
  if (labels.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
          {l.label}
          <button
            type="button"
            aria-label={`Remove ${l.label}`}
            className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => onRemove(l.id)}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}

interface Category {
  id: string;
  name: string;
  parentId?: string | null | undefined;
}
interface Collection {
  id: string;
  title: string;
  type: string;
}

/** Primary category, extra categories and manual collections (both chosen in popups), and brand. */
export function OrganizationCard({
  categories,
  brands,
  collections,
  primaryCategoryId,
  onPrimaryCategoryChange,
  extraCategoryIds,
  onExtraCategoryIdsChange,
  brandId,
  onBrandChange,
  collectionIds,
  onCollectionIdsChange,
  primaryCategoryError,
}: {
  categories: Category[];
  brands: Array<{ id: string; name: string }>;
  collections: Collection[];
  primaryCategoryId: string;
  onPrimaryCategoryChange: (id: string) => void;
  extraCategoryIds: string[];
  onExtraCategoryIdsChange: (ids: string[]) => void;
  brandId: string;
  onBrandChange: (id: string) => void;
  collectionIds: string[];
  onCollectionIdsChange: (ids: string[]) => void;
  primaryCategoryError?: string | undefined;
}) {
  const [catOpen, setCatOpen] = useState(false);
  const [colOpen, setColOpen] = useState(false);

  const extraCategories = categories.filter((c) => c.id !== primaryCategoryId);
  const catItems = extraCategories.map((c) => ({ id: c.id, label: categoryLabel(c, categories) }));
  const pickedCats = catItems.filter((i) => extraCategoryIds.includes(i.id));
  const manual = collections.filter((c) => c.type === "manual");
  const colItems = manual.map((c) => ({ id: c.id, label: c.title }));
  const pickedCols = colItems.filter((i) => collectionIds.includes(i.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Organization</CardTitle>
        <CardDescription>Primary category, extra categories, brand, and collections.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="primary-category">
            Primary Category <span className="text-destructive">*</span>
          </FieldLabel>
          <SimpleSelect
            id="primary-category"
            value={primaryCategoryId}
            onChange={(val) => {
              onPrimaryCategoryChange(val);
              onExtraCategoryIdsChange(extraCategoryIds.filter((id) => id !== val));
            }}
            options={[
              { value: "", label: "Select primary category..." },
              ...categories.map((c) => ({ value: c.id, label: categoryLabel(c, categories) })),
            ]}
          />
          <p className="text-xs text-muted-foreground">Used as the main navigation breadcrumb and primary canonical taxonomy.</p>
          {primaryCategoryError ? (
            <p role="alert" className="text-xs text-destructive">
              {primaryCategoryError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>Additional Categories</FieldLabel>
            <Button type="button" variant="outline" size="sm" onClick={() => setCatOpen(true)}>
              Choose
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Optional extra categories this product also belongs to.</p>
          <PickedChips
            labels={pickedCats}
            emptyText="None selected"
            onRemove={(id) => onExtraCategoryIdsChange(extraCategoryIds.filter((x) => x !== id))}
          />
        </div>

        <div className="grid gap-1.5 border-t border-border pt-3">
          <FieldLabel htmlFor="product-brand">Brand</FieldLabel>
          <SimpleSelect
            id="product-brand"
            value={brandId}
            onChange={onBrandChange}
            options={[{ value: "", label: "No brand" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </div>

        <div className="grid gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>Manual Collections</FieldLabel>
            <Button type="button" variant="outline" size="sm" onClick={() => setColOpen(true)}>
              Choose
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Assign this product to specific curated collections.</p>
          <PickedChips
            labels={pickedCols}
            emptyText="None selected"
            onRemove={(id) => onCollectionIdsChange(collectionIds.filter((x) => x !== id))}
          />
        </div>
      </CardContent>

      <MultiPickDialog
        open={catOpen}
        onOpenChange={setCatOpen}
        title="Additional categories"
        description="Tick every category this product also belongs to."
        items={catItems}
        selected={extraCategoryIds}
        emptyText="No other categories yet."
        onSave={onExtraCategoryIdsChange}
      />
      <MultiPickDialog
        open={colOpen}
        onOpenChange={setColOpen}
        title="Manual collections"
        description="Tick the curated collections this product belongs to."
        items={colItems}
        selected={collectionIds}
        emptyText="No manual collections yet."
        onSave={onCollectionIdsChange}
      />
    </Card>
  );
}
