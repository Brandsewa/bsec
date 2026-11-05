import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Redo2, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, PageContainer, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ProductDetail } from "@bs/contracts";
import { MediaPickerDialog } from "@bs/content-admin/media/media-picker-dialog.tsx";
import {
  BulkGrid,
  CheckCell,
  GridColumnsMenu,
  MultiCell,
  PopoverCell,
  SelectCell,
  TextCell,
  emptyDash,
  type BulkColumn,
  type BulkRow,
  useGridLayout,
} from "../../../components/data-grid/bulk-grid.tsx";
import { useColumnVisibility } from "../../../components/data-table/use-table-state.ts";
import { buildProductItems } from "../../../lib/bulk-edit-products.ts";
import { descriptionText, editKey, formatMoneyText, seoOf, useEdits } from "../../../lib/bulk-edit.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { client, orpc } from "../../../lib/orpc.ts";
import { useStoreCurrency } from "../../../lib/use-store-currency.ts";

export const BULK_PRODUCTS_KEY = "bulk-edit:products";
/** Products fetched per request: the grid loads the next batch only when the user scrolls to the bottom. */
const PAGE = 25;
type Many = Awaited<ReturnType<typeof client.admin.products.getMany>>;

/** Joins the batches loaded so far into one list, one stock map and one custom-field value map. */
function combineBatches(results: UseQueryResult<Many, Error>[]) {
  const first = results.find((r) => r.data)?.data?.customFields;
  return {
    items: results.flatMap((r) => r.data?.items ?? []),
    stock: Object.assign({}, ...results.map((r) => r.data?.stock ?? {})) as Record<string, number>,
    cf: first ? { ...first, values: Object.assign({}, ...results.map((r) => r.data?.customFields.values ?? {})) as typeof first.values } : undefined,
    firstLoading: results[0]?.isLoading ?? false,
    anyLoading: results.some((r) => r.isLoading),
    error: results.find((r) => r.isError)?.error ?? null,
  };
}

export const Route = createFileRoute("/_store/products/bulk-edit")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={12} columns={6} />
    </PageSkeleton>
  ),
  component: ProductsBulkEditPage,
});

type Variant = ProductDetail["variants"][number];
interface PRow extends BulkRow {
  product: ProductDetail;
  /** The variant this row edits: the product's only variant on a collapsed row, or a child row's own. */
  variant?: Variant | undefined;
  isChild: boolean;
}

const STATUS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "unlisted", label: "Unlisted" },
  { value: "archived", label: "Archived" },
];

function readIds(): string[] {
  try {
    const raw = sessionStorage.getItem(BULK_PRODUCTS_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function ProductsBulkEditPage() {
  const [ids] = useState(readIds);
  const currency = useStoreCurrency();
  const queryClient = useQueryClient();
  const ed = useEdits();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [mediaFor, setMediaFor] = useState<ProductDetail | null>(null);

  const [batches, setBatches] = useState(1);
  const data = useQueries({
    queries: Array.from({ length: Math.min(batches, Math.ceil(ids.length / PAGE)) }, (_, i) => ({
      ...orpc.admin.products.getMany.queryOptions({ input: { ids: ids.slice(i * PAGE, (i + 1) * PAGE) } }),
      staleTime: 0,
    })),
    combine: combineBatches,
  });
  const hasMore = batches * PAGE < ids.length;
  const loadMore = useCallback(() => setBatches((b) => (b * PAGE < ids.length ? b + 1 : b)), [ids.length]);
  const layout = useGridLayout("products");
  const categories = useQuery(orpc.admin.categories.list.queryOptions({ input: { status: "all" } }));
  const collections = useQuery(orpc.admin.collections.list.queryOptions({ input: { status: "all" } }));
  const brands = useQuery(orpc.admin.brands.list.queryOptions());
  const taxClasses = useQuery(orpc.admin.taxClasses.list.queryOptions({}));

  const products = data.items;
  const stock = data.stock;
  const cf = data.cf;
  const cfDefs = useMemo(() => (cf?.enabled ? cf.definitions.filter((d) => ["text", "number", "boolean", "dropdown"].includes(d.type)) : []), [cf]);
  const cfTypes = useMemo(() => Object.fromEntries(cfDefs.map((d) => [d.id, d.type])), [cfDefs]);

  const catOptions = useMemo(() => [{ value: "", label: "Uncategorized" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))], [categories.data]);
  const catMulti = useMemo(() => (categories.data ?? []).map((c) => ({ value: c.id, label: c.name })), [categories.data]);
  const colMulti = useMemo(() => (collections.data ?? []).map((c) => ({ value: c.id, label: c.title })), [collections.data]);
  const brandOptions = useMemo(() => [{ value: "", label: "None" }, ...(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))], [brands.data]);
  const taxOptions = useMemo(() => [{ value: "", label: "Store default" }, ...(taxClasses.data ?? []).map((t) => ({ value: t.id, label: t.name }))], [taxClasses.data]);

  const rows = useMemo<PRow[]>(() => {
    const out: PRow[] = [];
    for (const p of products) {
      if (p.variants.length > 1) {
        out.push({ id: p.id, product: p, isChild: false, childCount: p.variants.length });
        for (const v of p.variants) out.push({ id: v.id, parentId: p.id, product: p, variant: v, isChild: true });
      } else {
        out.push({ id: p.id, product: p, variant: p.variants[0], isChild: false });
      }
    }
    return out;
  }, [products]);

  const { items, errors } = useMemo(() => buildProductItems(products, ed.edits, currency, cfTypes), [products, ed.edits, currency, cfTypes]);
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    if (ed.count === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ed.count]);

  const save = useMutation({
    mutationFn: async () => {
      const results: Array<{ id: string; ok: boolean; error?: string | undefined }> = [];
      for (let i = 0; i < items.length; i += 100) {
        const r = await client.admin.products.bulkUpdate({ items: items.slice(i, i + 100) });
        results.push(...r.results);
      }
      return results;
    },
    onSuccess: async (results) => {
      const bad = results.filter((r) => !r.ok);
      setFailed(Object.fromEntries(bad.map((r) => [r.id, r.error ?? "Could not save"])));
      const badTargets = new Set<string>(bad.map((r) => r.id));
      for (const p of products) if (badTargets.has(p.id)) for (const v of p.variants) badTargets.add(v.id);
      ed.keepOnly(badTargets);
      await queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() });
      if (bad.length === 0) toast.success(`Saved ${results.length} product${results.length === 1 ? "" : "s"}`);
      else toast.error(`${results.length - bad.length} saved, ${bad.length} could not be saved. See the red rows.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // --- cell helpers ---------------------------------------------------------------------------------------------
  const err = (target: string, field: string) => errors[editKey(target, field)];
  /** Text opens a small box under the cell; short codes and numbers (`inline`, right-aligned) edit in place. */
  const text = (target: string, field: string, saved: string, o?: { align?: "right"; mono?: boolean; placeholder?: string; inline?: boolean; multiline?: boolean }) => {
    const { inline, ...rest } = o ?? {};
    return (
      <TextCell col={field} row={target} value={ed.get(target, field, saved)} onChange={(v) => ed.set(target, field, v, saved)} dirty={ed.isDirty(target, field)} error={err(target, field)} box={!inline && rest.align !== "right"} {...rest} />
    );
  };
  const sel = (target: string, field: string, saved: string, options: Array<{ value: string; label: string }>, label: string) => (
    <SelectCell label={label} value={ed.get(target, field, saved)} onChange={(v) => ed.set(target, field, v, saved)} options={options} dirty={ed.isDirty(target, field)} />
  );
  const check = (target: string, field: string, saved: boolean, label: string) => (
    <CheckCell label={label} checked={ed.get(target, field, saved)} onChange={(v) => ed.set(target, field, v, saved)} dirty={ed.isDirty(target, field)} />
  );
  const multi = (target: string, field: string, saved: string[], options: Array<{ value: string; label: string }>, placeholder: string) => (
    <MultiCell options={options} value={ed.get(target, field, saved)} onChange={(v) => ed.set(target, field, v, saved)} dirty={ed.isDirty(target, field)} placeholder={placeholder} />
  );

  /** A product-level cell: blank on variant child rows. */
  const P = (render: (p: ProductDetail) => ReactNode) => (r: PRow) => (r.isChild ? null : render(r.product));
  /** A variant-level cell: blank on a multi-variant parent row. */
  const V = (render: (v: Variant, p: ProductDetail) => ReactNode) => (r: PRow) => (r.variant ? render(r.variant, r.product) : r.isChild ? null : emptyDash);

  const dim = (v: Variant, f: "lengthCm" | "widthCm" | "heightCm") => {
    const n = ((v.dimensions ?? {}) as Record<string, number | undefined>)[f];
    return n ? String(n) : "";
  };

  const columns: BulkColumn<PRow>[] = [
    {
      id: "title",
      header: "Product title",
      group: "General",
      width: 280,
      locked: true,
      cell: (r) =>
        r.isChild ? (
          <span className="block truncate px-1.5 text-muted-foreground" title={r.variant?.title}>
            {r.variant?.title}
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">{text(r.product.id, "title", r.product.title)}</div>
            {failed[r.product.id] ? (
              <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive" title={failed[r.product.id]}>
                Not saved
              </span>
            ) : null}
          </div>
        ),
    },
    {
      id: "shortDescription",
      header: "Short description",
      group: "General",
      width: 220,
      cell: P((p) => text(p.id, "shortDescription", p.shortDescription ?? "", { multiline: true })),
    },
    {
      id: "description",
      header: "Long description",
      group: "General",
      width: 200,
      cell: P((p) => {
        const saved = descriptionText(p.descriptionJson);
        const v = ed.get(p.id, "description", saved);
        return (
          <PopoverCell title={`Description: ${p.title}`} summary={v || emptyDash} dirty={ed.isDirty(p.id, "description")} wide>
            <textarea
              aria-label="Long description"
              value={v}
              onChange={(e) => ed.set(p.id, "description", e.target.value, saved)}
              rows={10}
              className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </PopoverCell>
        );
      }),
    },
    {
      id: "media",
      header: "Product media",
      group: "General",
      width: 170,
      cell: P((p) => (
        <button type="button" onClick={() => setMediaFor(p)} className="flex h-7 w-full items-center gap-1 rounded-sm border border-transparent px-1.5 hover:border-border" aria-label={`Media for ${p.title}`}>
          {p.media.slice(0, 4).map((m) => (m.url ? <img key={m.id} src={m.url} alt="" className="size-5 rounded object-cover" /> : null))}
          {p.media.length > 4 ? <span className="text-muted-foreground">+{p.media.length - 4}</span> : null}
          {p.media.length === 0 ? <span className="text-muted-foreground">Add media</span> : null}
        </button>
      )),
    },
    { id: "status", header: "Status", group: "General", width: 120, cell: P((p) => sel(p.id, "status", p.status, STATUS, "Status")) },
    { id: "category", header: "Category", group: "General", width: 170, cell: P((p) => sel(p.id, "primaryCategoryId", p.primaryCategoryId ?? "", catOptions, "Category")) },
    {
      id: "moreCategories",
      header: "More categories",
      group: "General",
      width: 190,
      defaultHidden: true,
      cell: P((p) => multi(p.id, "extraCategoryIds", p.extraCategoryIds, catMulti, "None")),
    },
    { id: "collections", header: "Collections", group: "General", width: 190, cell: P((p) => multi(p.id, "collectionIds", p.collectionIds, colMulti, "None")) },
    { id: "tags", header: "Tags", group: "General", width: 170, defaultHidden: true, cell: P((p) => text(p.id, "tags", p.tags.join(", "), { placeholder: "tag, tag" })) },
    { id: "productType", header: "Product type", group: "General", width: 140, defaultHidden: true, cell: P((p) => text(p.id, "productType", p.productType ?? "")) },
    { id: "vendor", header: "Vendor", group: "General", width: 150, defaultHidden: true, cell: P((p) => sel(p.id, "brandId", p.brandId ?? "", brandOptions, "Vendor")) },
    { id: "isFeatured", header: "Featured", group: "General", width: 80, defaultHidden: true, cell: P((p) => check(p.id, "isFeatured", p.isFeatured, "Featured")) },

    { id: "sku", header: "SKU", group: "Inventory", width: 140, cell: V((v) => text(v.id, "sku", v.sku, { mono: true, inline: true })) },
    { id: "stock", header: "Stock quantity", group: "Inventory", width: 110, align: "right", cell: V((v) => text(v.id, "stock", String(stock[v.id] ?? 0), { align: "right" })) },
    { id: "trackInventory", header: "Track quantity", group: "Inventory", width: 100, defaultHidden: true, cell: V((v) => check(v.id, "trackInventory", v.trackInventory, "Track quantity")) },
    { id: "allowBackorder", header: "Sell when out of stock", group: "Inventory", width: 140, defaultHidden: true, cell: V((v) => check(v.id, "allowBackorder", v.allowBackorder, "Sell when out of stock")) },
    { id: "barcode", header: "Barcode", group: "Inventory", width: 140, defaultHidden: true, cell: V((v) => text(v.id, "barcode", v.barcode ?? "", { mono: true, inline: true })) },

    { id: "price", header: `Base price (${currency})`, group: "Pricing", width: 120, align: "right", cell: V((v) => text(v.id, "price", formatMoneyText(v.price, currency), { align: "right" })) },
    { id: "compareAtPrice", header: "Compare-at price", group: "Pricing", width: 120, align: "right", cell: V((v) => text(v.id, "compareAtPrice", formatMoneyText(v.compareAtPrice, currency), { align: "right" })) },
    { id: "costPrice", header: "Cost per item", group: "Pricing", width: 110, align: "right", cell: V((v) => text(v.id, "costPrice", formatMoneyText(v.costPrice, currency), { align: "right" })) },
    { id: "tax", header: "Tax class", group: "Pricing", width: 150, cell: P((p) => sel(p.id, "taxClassId", p.taxClassId ?? "", taxOptions, "Tax class")) },
    { id: "priceOnRequest", header: "Price on request", group: "Pricing", width: 110, defaultHidden: true, cell: P((p) => check(p.id, "priceOnRequest", p.priceOnRequest, "Price on request")) },

    { id: "seoTitle", header: "SEO title", group: "SEO", width: 220, cell: P((p) => text(p.id, "seoTitle", seoOf(p.seo).title)) },
    { id: "seoDescription", header: "Meta description", group: "SEO", width: 260, cell: P((p) => text(p.id, "seoDescription", seoOf(p.seo).description, { multiline: true })) },
    { id: "slug", header: "URL handle", group: "SEO", width: 200, cell: P((p) => text(p.id, "slug", p.slug, { mono: true })) },

    { id: "weightGrams", header: "Weight (g)", group: "Shipping", width: 100, align: "right", defaultHidden: true, cell: V((v) => text(v.id, "weightGrams", v.weightGrams != null ? String(v.weightGrams) : "", { align: "right" })) },
    { id: "lengthCm", header: "Length (cm)", group: "Shipping", width: 90, align: "right", defaultHidden: true, cell: V((v) => text(v.id, "lengthCm", dim(v, "lengthCm"), { align: "right" })) },
    { id: "widthCm", header: "Width (cm)", group: "Shipping", width: 90, align: "right", defaultHidden: true, cell: V((v) => text(v.id, "widthCm", dim(v, "widthCm"), { align: "right" })) },
    { id: "heightCm", header: "Height (cm)", group: "Shipping", width: 90, align: "right", defaultHidden: true, cell: V((v) => text(v.id, "heightCm", dim(v, "heightCm"), { align: "right" })) },
    { id: "hsn", header: "HSN code", group: "Shipping", width: 110, defaultHidden: true, cell: P((p) => text(p.id, "hsn", p.hsn ?? "", { mono: true, inline: true })) },
    { id: "requiresShipping", header: "Requires shipping", group: "Shipping", width: 110, defaultHidden: true, cell: P((p) => check(p.id, "requiresShipping", p.requiresShipping, "Requires shipping")) },
    { id: "returnable", header: "Returnable", group: "Shipping", width: 90, defaultHidden: true, cell: P((p) => check(p.id, "returnable", p.returnable ?? true, "Returnable")) },

    ...cfDefs.map(
      (d): BulkColumn<PRow> => ({
        id: `cf:${d.id}`,
        header: d.name,
        group: "Custom fields",
        width: 150,
        defaultHidden: true,
        cell: P((p) => {
          const raw = cf?.values[p.id]?.[d.id];
          const field = `cf:${d.id}`;
          if (d.type === "boolean") return check(p.id, field, raw === true, d.name);
          if (d.type === "dropdown") return sel(p.id, field, typeof raw === "string" ? raw : "", [{ value: "", label: "—" }, ...d.options.map((o) => ({ value: o.value, label: o.label }))], d.name);
          return text(p.id, field, raw == null ? "" : String(raw), d.type === "number" ? { align: "right" } : undefined);
        }),
      }),
    ),
  ];

  const hidden = useColumnVisibility("products-bulk", columns);
  const shown = layout.arrange(columns.filter((c) => c.locked || hidden.isVisible(c.id)));

  if (ids.length === 0) {
    return (
      <PageContainer size="full">
        <div className="grid justify-items-center gap-2 py-24 text-center">
          <p className="text-sm font-semibold text-foreground">No products selected</p>
          <p className="text-muted-foreground">Tick some products in the list, then press Edit.</p>
          <Button size="sm" nativeButton={false} render={<Link to="/products" />}>
            Go to products
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="full">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Back to products" nativeButton={false} render={<Link to="/products" />}>
          <ArrowLeft />
        </Button>
        <h1 className="text-sm font-semibold text-foreground">
          Editing {ids.length} product{ids.length === 1 ? "" : "s"}
        </h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="icon" aria-label="Undo" disabled={!ed.canUndo} onClick={ed.undo}>
            <Undo2 />
          </Button>
          <Button variant="outline" size="icon" aria-label="Redo" disabled={!ed.canRedo} onClick={ed.redo}>
            <Redo2 />
          </Button>
          <GridColumnsMenu columns={columns} isVisible={hidden.isVisible} onToggle={hidden.toggle} onReset={() => { hidden.reset(); layout.reset(); }} />
        </div>
      </div>

      {ed.count > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
          <span className="font-medium text-foreground">
            {items.length} product{items.length === 1 ? "" : "s"} changed
          </span>
          {errorCount > 0 ? <span className="text-destructive">{errorCount} cell{errorCount === 1 ? "" : "s"} need fixing</span> : null}
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => { ed.clear(); setFailed({}); }}>
              <X className="mr-1.5 size-3.5" aria-hidden /> Discard
            </Button>
            <Button size="sm" disabled={save.isPending || errorCount > 0 || items.length === 0} onClick={() => save.mutate()}>
              <Save className="mr-1.5 size-3.5" aria-hidden /> {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      {data.firstLoading ? (
        <TableSkeleton rows={12} columns={6} />
      ) : data.error ? (
        <p role="alert" className="text-destructive">{errorMessage(data.error)}</p>
      ) : (
        <BulkGrid
          columns={shown}
          rows={rows}
          collapsed={collapsed}
          onToggleCollapsed={(id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          className="max-h-[calc(100dvh-12rem)]"
          layout={layout}
          hasMore={hasMore}
          loadingMore={data.anyLoading}
          onLoadMore={loadMore}
          empty={<p className="py-16 text-center text-muted-foreground">These products could not be found.</p>}
        />
      )}

      {mediaFor ? <MediaEditor product={mediaFor} onClose={() => setMediaFor(null)} onChanged={() => queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() })} /> : null}
    </PageContainer>
  );
}

/** Attach and detach save at once (they are separate calls), unlike the cells, which save with the Save button. */
function MediaEditor({ product, onClose, onChanged }: { product: ProductDetail; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const attach = useMutation(orpc.admin.products.attachMedia.mutationOptions());
  const detach = useMutation(orpc.admin.products.detachMedia.mutationOptions());
  const [pick, setPick] = useState(false);
  const [media, setMedia] = useState(product.media);
  const busy = attach.isPending || detach.isPending;

  return (
    <div role="dialog" aria-label={`Media: ${product.title}`} className="fixed right-4 bottom-4 z-50 grid w-[440px] max-w-[92vw] grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-border bg-card p-5 shadow-lg">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={product.title}>
          Media: {product.title}
        </p>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {media.map((m) => (
          <div key={m.id} className="group relative size-20 overflow-hidden rounded-md border border-border bg-muted">
            {m.url ? <img src={m.url} alt={m.alt ?? ""} className="size-full object-cover" /> : null}
            <button
              type="button"
              aria-label="Remove media"
              disabled={busy}
              onClick={async () => {
                try {
                  await detach.mutateAsync({ id: product.id, productMediaId: m.id });
                  setMedia((cur) => cur.filter((x) => x.id !== m.id));
                  await onChanged();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
              className="absolute top-1 right-1 hidden size-5 place-items-center rounded bg-background/90 text-foreground group-hover:grid"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        ))}
        <button type="button" disabled={busy} onClick={() => setPick(true)} aria-label="Add media" className="grid size-20 place-items-center rounded-md border border-dashed border-muted-foreground/25 text-muted-foreground hover:text-foreground">
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      <p className="text-muted-foreground">Adding or removing media saves straight away. Reorder media on the product page.</p>
      <MediaPickerDialog
        open={pick}
        onOpenChange={setPick}
        accept={["image", "video"]}
        multiple
        title="Add media"
        onSelect={async (selected) => {
          try {
            for (const m of selected) {
              const r = await attach.mutateAsync({ id: product.id, mediaId: m.id });
              setMedia((cur) => [...cur, { id: r.id, productId: product.id, mediaId: m.id, position: r.position, isPrimary: r.isPrimary, url: r.url, kind: "image" as const }]);
            }
            await onChanged();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

export default ProductsBulkEditPage;
