import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";

/** What the picker and the assignment list need to know about a product (the list item and the collection detail both fit). */
export interface PickedProduct {
  id: string;
  title: string;
  status?: string | undefined;
  imageUrl?: string | null | undefined;
  priceMin?: number | null | undefined;
  priceMax?: number | null | undefined;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const PAGE = 50;

function priceText(p: PickedProduct): string {
  if (p.priceMin == null) return "";
  return p.priceMax != null && p.priceMax !== p.priceMin ? `${inr.format(p.priceMin / 100)} – ${inr.format(p.priceMax / 100)}` : inr.format(p.priceMin / 100);
}

/**
 * Pick products for a collection from everything in the store: search, tick, save. Each row shows the status,
 * price range, variant count and stock so the right product is easy to spot. Nothing changes until Save.
 */
export function ProductPickerDialog({
  open,
  onOpenChange,
  selected,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Products already in the collection, in their current order. */
  selected: PickedProduct[];
  /** The full selection after saving: kept products keep their order, new ones are appended. */
  onSave: (products: PickedProduct[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open ? (
          <PickerBody
            selected={selected}
            onCancel={() => onOpenChange(false)}
            onSave={(p) => {
              onSave(p);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ selected, onCancel, onSave }: { selected: PickedProduct[]; onCancel: () => void; onSave: (products: PickedProduct[]) => void }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<Map<string, PickedProduct>>(() => new Map(selected.map((p) => [p.id, p])));

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setLimit(PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery(
    orpc.admin.products.list.queryOptions({
      input: { ...(debounced ? { search: debounced } : {}), sort: "title_asc", limit, offset: 0 },
    }),
  );
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const toggle = (p: PickedProduct, on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (on) next.set(p.id, p);
      else next.delete(p.id);
      return next;
    });

  function save() {
    const kept = selected.filter((p) => picked.has(p.id));
    const keptIds = new Set(kept.map((p) => p.id));
    const added = [...picked.values()].filter((p) => !keptIds.has(p.id));
    onSave([...kept, ...added]);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add products</DialogTitle>
        <DialogDescription>Search your catalog and tick the products to include.</DialogDescription>
      </DialogHeader>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Search products" autoFocus placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="max-h-[22rem] overflow-y-auto rounded-md border border-border">
        {query.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading products...</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{debounced ? `No products match "${debounced}".` : "Your store has no products yet."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer select-none items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                  <Checkbox checked={picked.has(p.id)} onCheckedChange={(c) => toggle(p, Boolean(c))} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{p.title}</span>
                      {p.status !== "active" ? (
                        <Badge variant="outline" className="shrink-0 capitalize">
                          {p.status}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        p.variantCount != null ? `${p.variantCount} variant${p.variantCount === 1 ? "" : "s"}` : null,
                        priceText(p) || null,
                        p.stock != null ? (p.stock > 0 ? `${p.stock} in stock` : "Out of stock") : null,
                        p.primaryCategoryName ?? null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {items.length < total ? (
          <div className="border-t border-border p-2 text-center">
            <Button type="button" variant="ghost" size="sm" disabled={query.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
              {query.isFetching ? "Loading..." : `Show more (${total - items.length} left)`}
            </Button>
          </div>
        ) : null}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">{picked.size} selected</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={save}>
            Save
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
