import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Progress, RadioGroup, RadioGroupItem, toast } from "@bs/ui";
import { CUSTOM_FIELD_PREFIX, PRODUCT_COLUMNS, type ColumnGroup } from "@bs/contracts/product-bulk-io";
import { downloadCsv, toCsv } from "../../../lib/csv.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { client, orpc } from "../../../lib/orpc.ts";

const GROUPS: Array<{ id: ColumnGroup; label: string }> = [
  { id: "basics", label: "Basics" },
  { id: "organisation", label: "Collection and tags" },
  { id: "pricing", label: "Variants and pricing" },
  { id: "images", label: "Images" },
  { id: "seo", label: "SEO" },
  { id: "flags", label: "Settings" },
];
const DEFAULT_PICK = ["title", "shortDescription", "description", "status", "primaryCategory", "sku", "price", "compareAtPrice", "imageUrl", "seoTitle", "seoDescription"];

export interface ExportFilter {
  status?: "draft" | "active" | "unlisted" | "archived" | undefined;
  search?: string | undefined;
}

type Scope = "all" | "filter" | "selected" | "categories";

/**
 * Bulk product export (docs/PRODUCT-BULK-IO-PLAN.md section 3): choose the products (all, current filter, ticked rows or
 * categories) and the columns (all or a custom list), then pages of 200 products are fetched and saved as one CSV.
 */
export function ProductExportDialog({ open, onOpenChange, selectedIds, filter }: { open: boolean; onOpenChange: (open: boolean) => void; selectedIds: string[]; filter: ExportFilter }) {
  const hasFilter = Boolean(filter.status || filter.search?.trim());
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "selected" : "all");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [fieldMode, setFieldMode] = useState<"all" | "custom">("all");
  const [picked, setPicked] = useState<string[]>(DEFAULT_PICK);
  const [progress, setProgress] = useState<{ done: number } | null>(null);

  const categories = useQuery({ ...orpc.admin.categories.list.queryOptions(), enabled: open });
  const defs = useQuery({ ...orpc.admin.customFields.listDefinitions.queryOptions({ input: { resourceType: "product" } }), enabled: open });
  const customDefs = defs.data?.enabled ? defs.data.definitions.filter((d) => !d.archived) : [];

  const busy = progress !== null;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const canRun = !busy && (scope !== "categories" || categoryIds.length > 0) && (fieldMode === "all" || picked.length > 0);
  const effectiveScope: Scope = scope === "selected" && !selectedIds.length ? "all" : scope === "filter" && !hasFilter ? "all" : scope;

  const run = async () => {
    setProgress({ done: 0 });
    try {
      let header: string[] = [];
      const rows: string[][] = [];
      let cursor: string | undefined;
      let products = 0;
      do {
        const page = await client.admin.products.exportRows({
          fields: fieldMode === "all" ? "all" : picked,
          ...(effectiveScope === "categories" ? { categoryIds } : {}),
          ...(effectiveScope === "selected" ? { productIds: selectedIds } : {}),
          ...(effectiveScope === "filter" ? { ...(filter.status ? { status: filter.status } : {}), ...(filter.search?.trim() ? { search: filter.search.trim() } : {}) } : {}),
          ...(cursor ? { cursor } : {}),
          limit: 200,
        });
        header = page.header;
        rows.push(...page.rows);
        products += page.products;
        setProgress({ done: products });
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      if (products === 0) {
        toast.error("No products match this selection.");
      } else {
        downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, rows));
        toast.success(`Exported ${products.toLocaleString("en-IN")} product${products === 1 ? "" : "s"} (${rows.length.toLocaleString("en-IN")} rows).`);
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  const grouped = useMemo(() => GROUPS.map((g) => ({ ...g, cols: PRODUCT_COLUMNS.filter((c) => c.group === g.id && c.key !== "handle") })), []);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export products</DialogTitle>
          <DialogDescription>One row per variant. The file can be edited and imported back.</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1">
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Which products</h3>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="grid gap-2">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="all" /> All products</label>
              <label className={`flex items-center gap-2 text-sm ${hasFilter ? "" : "opacity-50"}`}><RadioGroupItem value="filter" disabled={!hasFilter} /> Products matching the current filter</label>
              <label className={`flex items-center gap-2 text-sm ${selectedIds.length ? "" : "opacity-50"}`}><RadioGroupItem value="selected" disabled={!selectedIds.length} /> Selected products ({selectedIds.length})</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="categories" /> Products in chosen categories</label>
            </RadioGroup>
            {scope === "categories" ? (
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border border-border p-2">
                {(categories.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">{categories.isLoading ? "Loading categories…" : "No categories yet."}</p> : null}
                {(categories.data ?? []).map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={categoryIds.includes(c.id)} onCheckedChange={() => toggle(categoryIds, setCategoryIds, c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Which fields</h3>
            <RadioGroup value={fieldMode} onValueChange={(v) => setFieldMode(v as "all" | "custom")} className="grid gap-2">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="all" /> All fields{customDefs.length ? ` (including ${customDefs.length} custom field${customDefs.length === 1 ? "" : "s"})` : ""}</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="custom" /> Choose fields</label>
            </RadioGroup>
            {fieldMode === "custom" ? (
              <div className="grid gap-3 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">URL handle is always included so the file can be imported back.</p>
                {grouped.map((g) => (
                  <div key={g.id} className="grid gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{g.label}</p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {g.cols.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={picked.includes(c.key)} onCheckedChange={() => toggle(picked, setPicked, c.key)} />
                          {c.header}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {customDefs.length ? (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Custom fields</p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {customDefs.map((d) => {
                        const key = `${CUSTOM_FIELD_PREFIX}${d.key}`;
                        return (
                          <label key={d.id} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={picked.includes(key)} onCheckedChange={() => toggle(picked, setPicked, key)} />
                            {d.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {busy ? (
            <div className="grid gap-1.5" role="status" aria-live="polite">
              <Progress value={null} />
              <p className="text-xs text-muted-foreground">Preparing the file… {progress?.done.toLocaleString("en-IN")} products so far</p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!canRun} onClick={() => void run()}>
            <Download className="mr-1.5 size-3.5" aria-hidden /> Export CSV
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
