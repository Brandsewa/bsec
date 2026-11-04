import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, Upload, X } from "lucide-react";
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, Input, PageSkeleton, SimpleSelect, Tabs, TabsContent, TabsList, TabsTrigger, toast } from "@bs/ui";
import type { ProductStatePricing } from "@bs/contracts";
import { formatMoney } from "@bs/contracts/money";
import { EditableGrid, type GridColumn, type GridNode } from "../../../components/data-grid/editable-grid.tsx";
import { Pagination } from "../../../components/data-table/pagination.tsx";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { downloadCsv, parseCsv } from "../../../lib/csv.ts";
import { useStoreCurrency } from "../../../lib/use-store-currency.ts";
import { PageContainer, PageHeader } from "@bs/ui";
import {
  buildChanges,
  buildExportCsv,
  cellProblem,
  editKey,
  MAX_INLINE_STATES,
  planImport,
  savedText,
  type StateOption,
} from "../../../lib/state-pricing-grid.ts";

export const Route = createFileRoute("/_store/apps/state-pricing")({
  pendingComponent: () => <PageSkeleton />,
  component: StatePricingPage,
});

/** A product row (group or single-variant) or one of its variants. */
type Row = { kind: "product"; product: ProductStatePricing } | { kind: "variant"; product: ProductStatePricing; variant: ProductStatePricing["variants"][number] };

const MODE_OPTIONS = [
  { value: "auto", label: "Automatic: detect the shopper's state" },
  { value: "manual", label: "Manual: ask the shopper for their pincode" },
];

function nodesFor(products: ProductStatePricing[]): GridNode<Row>[] {
  return products.map((p) => ({
    id: p.productId,
    data: { kind: "product", product: p },
    children: p.variants.map((v) => ({ id: v.variantId, data: { kind: "variant", product: p, variant: v } })),
  }));
}

function StatePricingPage() {
  const apps = useQuery(orpc.admin.apps.list.queryOptions());
  const app = apps.data?.find((a) => a.key === "state-pricing");

  if (apps.isLoading) return <PageSkeleton />;
  if (!app || !app.installed || app.suspended) {
    return (
      <PageContainer>
        <PageHeader title="State Pricing" description="Different prices in different states." />
        <Alert role="alert">
          State Pricing is not installed on this store. <Link to="/apps" className="font-medium underline">Open the Apps page</Link> to install it.
        </Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="State Pricing" description="Give products a different price in any state. Every other state pays the default price." />
      <Tabs defaultValue="prices">
        <TabsList>
          <TabsTrigger value="prices">Prices</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="prices" className="mt-4">
          <PricesGrid />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab mode={String(app.settings.mode ?? "auto")} onSaved={() => void apps.refetch()} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function SettingsTab({ mode, onSaved }: { mode: string; onSaved: () => void }) {
  async function change(next: string) {
    try {
      await client.admin.apps.updateSettings({ key: "state-pricing", settings: { mode: next } });
      toast.success("Settings saved");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <div className="max-w-md rounded-lg border border-border bg-background p-5">
      <Field id="state-pricing-mode" label="How to find the shopper's state">
        <SimpleSelect value={mode} onChange={(v) => void change(v)} options={MODE_OPTIONS} />
      </Field>
      <p className="mt-2 text-xs text-muted-foreground">
        Automatic uses the shopper's location from their connection. Manual shows a pincode box as soon as the store opens, and the price follows the pincode they enter.
      </p>
    </div>
  );
}

function PricesGrid() {
  const currency = useStoreCurrency();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState<{ variantId: string; label: string } | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  // Saved prices of every variant loaded so far (across pages and searches), to tell unsaved edits from saved values.
  const [seen, setSeen] = useState<ReadonlyMap<string, Record<string, { price: number }>>>(new Map());
  const [lastData, setLastData] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const states = useQuery(orpc.admin.apps.states.queryOptions());
  const grid = useQuery({
    ...orpc.admin.apps.listGrid.queryOptions({ input: { ...(term ? { search: term } : {}), limit: pageSize, offset: (page - 1) * pageSize } }),
    placeholderData: (prev) => prev,
  });

  const stateList: StateOption[] = states.data ?? [];
  const nameOf = (code: string) => stateList.find((s) => s.code === code)?.name ?? code;

  // New data arrived: remember its saved prices, and start the state columns as the states this store already prices.
  if (grid.data && grid.data !== lastData) {
    setLastData(grid.data);
    setSeen((prev) => {
      const next = new Map(prev);
      for (const row of grid.data?.rows ?? []) for (const v of row.variants) next.set(v.variantId, v.prices);
      return next;
    });
    if (shown === null) setShown(grid.data.usedStates);
  }

  const shownStates = shown ?? [];
  const inline = shownStates.slice(0, MAX_INLINE_STATES);
  const overflow = shownStates.slice(MAX_INLINE_STATES);
  const nodes = useMemo(() => nodesFor(grid.data?.rows ?? []), [grid.data]);

  const { changes, invalid } = useMemo(() => buildChanges(edits, seen), [edits, seen]);

  function textOf(variantId: string, state: string, prices: Record<string, { price: number }>): string {
    const k = editKey(variantId, state);
    return k in edits ? (edits[k] as string) : savedText(prices, state);
  }

  const columns: GridColumn<Row>[] = [
    {
      id: "name",
      header: "Product",
      width: "17rem",
      render: (node, ctx) => {
        const d = node.data;
        if (d.kind === "product") return ctx.isGroup ? <span>{d.product.productTitle} <span className="font-normal text-muted-foreground">· {ctx.childCount} variants</span></span> : <span className="px-1">{d.product.productTitle}</span>;
        const single = d.product.variants.length === 1;
        return single ? <span className="px-1">{d.product.productTitle}{d.variant.title !== "Default" ? <span className="text-muted-foreground"> · {d.variant.title}</span> : null}</span> : <span className="px-1 text-muted-foreground">{d.variant.title}</span>;
      },
    },
    { id: "sku", header: "SKU", width: "9rem", render: (node) => <span className="px-1 text-muted-foreground">{node.data.kind === "variant" ? (node.data.variant.sku ?? "") : ""}</span> },
    {
      id: "default",
      header: "Default price",
      width: "8rem",
      align: "right",
      render: (node) => <span className="px-2 tabular-nums">{node.data.kind === "variant" ? formatMoney(node.data.variant.basePrice, currency) : ""}</span>,
    },
    ...inline.map(
      (code): GridColumn<Row> => ({
        id: code,
        header: (
          <span className="flex items-center justify-between gap-1">
            <span className="truncate">{nameOf(code)}</span>
            <button
              type="button"
              aria-label={`Hide ${nameOf(code)}`}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setShown((s) => (s ?? []).filter((c) => c !== code))}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ),
        width: "8.5rem",
        align: "right",
        edit: {
          cell: (node) => {
            if (node.data.kind !== "variant") return { value: "", dirty: false, readOnly: true };
            const v = node.data.variant;
            const k = editKey(v.variantId, code);
            const value = textOf(v.variantId, code, v.prices);
            return { value, dirty: k in edits && value !== savedText(v.prices, code), error: cellProblem(value) ?? undefined, placeholder: "default" };
          },
        },
      }),
    ),
  ];

  function setCell(variantId: string, state: string, value: string) {
    setEdits((e) => ({ ...e, [editKey(variantId, state)]: value }));
  }

  function onPaste(start: { node: GridNode<Row>; columnId: string }, matrix: string[][], rows: GridNode<Row>[]) {
    const first = inline.indexOf(start.columnId);
    if (first < 0) return;
    setEdits((e) => {
      const next = { ...e };
      matrix.forEach((cells, r) => {
        const row = rows[r]?.data;
        if (!row || row.kind !== "variant") return;
        cells.forEach((text, c) => {
          const code = inline[first + c];
          if (code) next[editKey(row.variant.variantId, code)] = text.trim().replace(/^₹\s*/, "");
        });
      });
      return next;
    });
  }

  async function save() {
    if (invalid) {
      toast.error("Fix the highlighted prices first");
      return;
    }
    setSaving(true);
    try {
      let saved = 0;
      let removed = 0;
      for (let i = 0; i < changes.length; i += 1000) {
        const res = await client.admin.apps.setPricesBulk({ items: changes.slice(i, i + 1000) });
        saved += res.saved;
        removed += res.removed;
      }
      toast.success(`Saved ${saved} price${saved === 1 ? "" : "s"}${removed ? `, removed ${removed}` : ""}`);
      setEdits({});
      setImportNote(null);
      setSeen(new Map());
      setLastData(null);
      await grid.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function exportCsv() {
    try {
      const all: ProductStatePricing[] = [];
      for (let offset = 0; ; offset += 100) {
        const res = await client.admin.apps.listGrid({ ...(term ? { search: term } : {}), limit: 100, offset });
        all.push(...res.rows);
        if (offset + 100 >= res.total) break;
      }
      const codes = [...new Set([...shownStates, ...(grid.data?.usedStates ?? [])])];
      downloadCsv("state-prices.csv", buildExportCsv(all, stateList, codes));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      const skus = rows.slice(1).map((r) => (r[rows[0]?.findIndex((h) => h.trim().toLowerCase() === "sku") ?? 0] ?? "").trim()).filter(Boolean);
      if (skus.length === 0) throw new Error("No SKUs found in the file");
      const matches = await client.admin.apps.lookupSkus({ skus: skus.slice(0, 2000) });
      const plan = planImport(rows, stateList, new Map(matches.map((m) => [m.sku, m.variantId])));
      setEdits((e) => ({ ...e, ...plan.edits }));
      setShown((s) => [...new Set([...(s ?? []), ...plan.stateCodes])]);
      const parts = [`${Object.keys(plan.edits).length} prices from ${plan.rowsMatched} variants are ready to save`];
      if (plan.unmatchedSkus.length) parts.push(`${plan.unmatchedSkus.length} SKUs not found (${plan.unmatchedSkus.slice(0, 5).join(", ")}${plan.unmatchedSkus.length > 5 ? "…" : ""})`);
      if (plan.badCells.length) parts.push(`${plan.badCells.length} invalid prices skipped (${plan.badCells.slice(0, 3).join(", ")}${plan.badCells.length > 3 ? "…" : ""})`);
      setImportNote(parts.join(". ") + ".");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const available = stateList.filter((s) => !shownStates.includes(s.code));
  // While a cell is invalid there are no sendable changes, but the bar must stay so the problem and Discard stay visible.
  const dirtyCount = invalid ? Object.keys(edits).length : changes.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search products or SKUs" className="pl-8" placeholder="Search product or SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={() => setExpanded(expanded.size ? new Set() : new Set(nodes.filter((n) => (n.children?.length ?? 0) > 1).map((n) => n.id)))}>
          {expanded.size ? "Collapse all" : "Expand all"}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="mr-1.5 size-3.5" aria-hidden /> Import CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
            <Download className="mr-1.5 size-3.5" aria-hidden /> Export CSV
          </Button>
        </div>
      </div>

      {importNote ? <Alert role="status">{importNote}</Alert> : null}

      {dirtyCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span>
            {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
            {invalid ? " · some prices need fixing" : ""}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setEdits({}); setImportNote(null); }}>
              Discard
            </Button>
            <Button size="sm" disabled={saving || invalid !== null} onClick={() => void save()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </span>
        </div>
      ) : null}

      {grid.isError ? (
        <Alert role="alert">{errorMessage(grid.error)}</Alert>
      ) : grid.isLoading ? (
        <PageSkeleton />
      ) : (
        <EditableGrid
          className="max-h-[65vh]"
          columns={columns}
          nodes={nodes}
          expanded={expanded}
          onToggleExpanded={(id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onCellChange={(node, col, value) => node.data.kind === "variant" && setCell(node.data.variant.variantId, col, value)}
          onRevert={(node, col) => node.data.kind === "variant" && setEdits((e) => { const { [editKey(node.data.kind === "variant" ? node.data.variant.variantId : "", col)]: _gone, ...rest } = e; return rest; })}
          onPaste={onPaste}
          empty={<p className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">{term ? "No products match your search." : "No products yet."}</p>}
          trailingHeader={
            <div className="w-44">
              <SimpleSelect
                value=""
                placeholder="Add a state"
                onChange={(code) => code && setShown((s) => [...(s ?? []), code])}
                options={available.map((s) => ({ value: s.code, label: s.name }))}
              />
            </div>
          }
          trailingCell={(node) =>
            overflow.length > 0 && node.data.kind === "variant" ? (
              <Button variant="ghost" size="sm" onClick={() => node.data.kind === "variant" && setMore({ variantId: node.data.variant.variantId, label: `${node.data.product.productTitle}${node.data.variant.title !== "Default" ? ` · ${node.data.variant.title}` : ""}` })}>
                +{overflow.length} more
              </Button>
            ) : null
          }
        />
      )}

      <Pagination page={page} pageSize={pageSize} total={grid.data?.total ?? 0} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} disabled={grid.isFetching} />

      <Dialog open={more !== null} onOpenChange={(o) => !o && setMore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>More states</DialogTitle>
            <DialogDescription>{more?.label}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            {more
              ? overflow.map((code) => {
                  const prices = seen.get(more.variantId) ?? {};
                  const value = textOf(more.variantId, code, prices);
                  const problem = cellProblem(value);
                  return (
                    <div key={code} className="flex items-center gap-2">
                      <span className="w-48 truncate text-sm">{nameOf(code)}</span>
                      <Input aria-label={`${nameOf(code)} price`} inputMode="decimal" className="w-36" placeholder="default" aria-invalid={problem ? true : undefined} value={value} onChange={(e) => setCell(more.variantId, code, e.target.value)} />
                      {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
                    </div>
                  );
                })
              : null}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setMore(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
