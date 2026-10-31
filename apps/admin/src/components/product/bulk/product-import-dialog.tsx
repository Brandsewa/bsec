import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Progress, RadioGroup, RadioGroupItem, SimpleSelect, toast } from "@bs/ui";
import { autoMapHeaders, CUSTOM_FIELD_PREFIX, parseProductRows, PRODUCT_COLUMNS, type ImportProduct, type ParseIssue } from "@bs/contracts/product-bulk-io";
import { downloadCsv, parseCsv, toCsv } from "../../../lib/csv.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { client, orpc } from "../../../lib/orpc.ts";
import { useStoreCurrency } from "../../../lib/use-store-currency.ts";

type Policy = "skip" | "update" | "replace";
type Mode = "create_only" | "update_only" | "create_and_update";
type Preview = Awaited<ReturnType<typeof client.admin.products.importPreview>>;
type Run = Awaited<ReturnType<typeof client.admin.products.importRun>>;
type Problem = { row: number; handle: string; kind: string; message: string };

type Phase =
  | { step: "pick" }
  | { step: "map" }
  | { step: "review"; products: ImportProduct[]; parseIssues: ParseIssue[]; preview: Preview }
  | { step: "running"; runId: string; sending: boolean; sent: number; total: number }
  | { step: "done"; run: Run };

const SKIP = "";
const MAX_PRODUCTS = 10_000;
const BATCH = 50;
const POLL_MS = 2000;
const MAP_STORAGE_PREFIX = "bs-product-import-map:";

const STATE_LABEL: Record<string, string> = {
  new: "New",
  exists: "Already exists",
  sku_conflict: "SKU conflict",
  unknown_category: "Unknown collection",
  missing_price: "Missing price",
};

const pct = (done: number, total: number) => (total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100)));
const n = (v: number) => v.toLocaleString("en-IN");

function loadSavedMap(headers: string[]): Array<string | null> | null {
  try {
    const raw = window.localStorage.getItem(MAP_STORAGE_PREFIX + headers.join("|").toLowerCase());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) && parsed.length === headers.length ? (parsed as Array<string | null>) : null;
  } catch {
    return null;
  }
}
function saveMap(headers: string[], mapping: Array<string | null>) {
  try {
    window.localStorage.setItem(MAP_STORAGE_PREFIX + headers.join("|").toLowerCase(), JSON.stringify(mapping));
  } catch {
    // Remembering the mapping is a convenience only.
  }
}

/** Header-only template plus one example row, so a merchant can start from our own format. */
function downloadTemplate() {
  const header = PRODUCT_COLUMNS.map((c) => c.header);
  const example: Record<string, string> = {
    handle: "blue-cotton-tee", title: "Blue Cotton Tee", shortDescription: "Soft everyday tee", description: "Line one.\n\nLine two.", status: "draft",
    primaryCategory: "Tops", tags: "summer|cotton", option1Name: "Size", option1Value: "M", sku: "TEE-BLUE-M", price: "499.00", compareAtPrice: "599.00",
    imageUrl: "https://example.com/images/blue-tee.jpg", seoTitle: "Blue Cotton Tee", seoDescription: "A soft blue cotton tee.", trackInventory: "yes",
  };
  downloadCsv("products-import-template.csv", toCsv(header, [PRODUCT_COLUMNS.map((c) => example[c.key] ?? "")]));
}

/**
 * Bulk product import (docs/PRODUCT-BULK-IO-PLAN.md section 4 and 7): upload, map columns, review conflicts, then watch
 * products and images finish. Products are sent in batches from this tab; images keep downloading on the server.
 */
export function ProductImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void }) {
  const currency = useStoreCurrency();
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Array<string | null>>([]);
  const [policy, setPolicy] = useState<Policy>("update");
  const [mode, setMode] = useState<Mode>("create_and_update");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "row" | "conflict" | "image">("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const defs = useQuery({ ...orpc.admin.customFields.listDefinitions.queryOptions({ input: { resourceType: "product" } }), enabled: open });
  const customDefs = useMemo(() => (defs.data?.enabled ? defs.data.definitions.filter((d) => !d.archived) : []), [defs.data]);

  // Progress polling: keeps going after the last batch so image downloads are tracked until the run closes.
  const runId = phase.step === "running" ? phase.runId : null;
  const [live, setLive] = useState<Run | null>(null);
  const importedRef = useRef(onImported);
  useEffect(() => {
    importedRef.current = onImported;
  }, [onImported]);
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await client.admin.products.importRun({ id: runId });
        if (stop) return;
        setLive(r);
        if (r.status !== "running") {
          setPhase({ step: "done", run: r });
          importedRef.current();
          return;
        }
      } catch {
        // A missed poll is harmless; the next one catches up.
      }
      if (!stop) timer = setTimeout(() => void tick(), POLL_MS);
    };
    let timer = setTimeout(() => void tick(), 500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const reset = () => {
    setPhase({ step: "pick" });
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping([]);
    setLive(null);
    setFilter("all");
    if (fileRef.current) fileRef.current.value = "";
  };

  const readFile = async (file: File) => {
    const table = parseCsv(await file.text());
    if (table.length < 2) {
      toast.error("The file needs a header row and at least one product row.");
      return;
    }
    if (table.length - 1 > MAX_PRODUCTS * 5) {
      toast.error("The file has too many rows. Split it into smaller files.");
      return;
    }
    const head = (table[0] ?? []).map((h) => h.trim());
    setFileName(file.name);
    setHeaders(head);
    setRows(table.slice(1));
    setMapping(loadSavedMap(head) ?? autoMapHeaders(head, customDefs));
    setPhase({ step: "map" });
  };

  const fieldOptions = useMemo(
    () => [
      { value: SKIP, label: "Do not import" },
      ...PRODUCT_COLUMNS.map((c) => ({ value: c.key, label: c.header })),
      ...customDefs.map((d) => ({ value: `${CUSTOM_FIELD_PREFIX}${d.key}`, label: `Custom field: ${d.name}` })),
    ],
    [customDefs],
  );
  const used = new Set(mapping.filter(Boolean));
  const duplicateTargets = mapping.filter((m, i) => m && mapping.indexOf(m) !== i);
  const hasKey = used.has("handle") || used.has("title");

  const toReview = async () => {
    setBusy(true);
    try {
      saveMap(headers, mapping);
      const { products, issues } = parseProductRows(rows, mapping, currency);
      if (products.length > MAX_PRODUCTS) {
        toast.error(`A file can hold at most ${n(MAX_PRODUCTS)} products.`);
        return;
      }
      const preview = products.length ? await client.admin.products.importPreview({ products }) : null;
      setPhase({
        step: "review",
        products,
        parseIssues: issues,
        preview: preview ?? { total: 0, toCreate: 0, existing: 0, skuConflicts: 0, unknownCategories: 0, images: 0, issues: [], items: [] },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async (products: ImportProduct[], blocked: Set<string>) => {
    const send = products.filter((p) => !blocked.has(p.handle));
    setBusy(true);
    try {
      const run = await client.admin.products.importStart({ total: send.length, conflictPolicy: policy, mode, fileName });
      setLive(run);
      setPhase({ step: "running", runId: run.id, sending: true, sent: 0, total: send.length });
      for (let i = 0; i < send.length; i += BATCH) {
        const r = await client.admin.products.importBatch({ runId: run.id, products: send.slice(i, i + BATCH) });
        setLive(r);
        setPhase((p) => (p.step === "running" ? { ...p, sent: Math.min(send.length, i + BATCH) } : p));
      }
      setPhase((p) => (p.step === "running" ? { ...p, sending: false } : p));
    } catch (e) {
      toast.error(errorMessage(e));
      setPhase({ step: "pick" });
    } finally {
      setBusy(false);
    }
  };

  const downloadProblems = (problems: Problem[]) =>
    downloadCsv(`products-import-problems-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(["CSV row", "URL handle", "Type", "Problem"], problems.map((e) => [e.row || "", e.handle, e.kind, e.message])));

  const sending = phase.step === "running" && phase.sending;
  const close = (o: boolean) => {
    if (sending) return;
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            {phase.step === "pick" && "Use our template or a Shopify or WooCommerce export. You can map the columns in the next step."}
            {phase.step === "map" && `Match each column in ${fileName} to a product field.`}
            {phase.step === "review" && "Check the results and choose what happens when a product already exists."}
            {phase.step === "running" && "Importing. Keep this tab open while products are being saved."}
            {phase.step === "done" && "The import has finished."}
          </DialogDescription>
        </DialogHeader>

        {phase.step === "pick" ? (
          <div className="grid gap-3">
            <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="CSV file" className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              <li>Several rows with the same URL handle become one product with several variants and images.</li>
              <li>Image URLs must be https. They are downloaded in the background and added to the product.</li>
              <li>Primary collection must match an existing category by name. Products with an unknown name are not imported.</li>
              <li>Blank cells keep the current value when updating. Type [clear] in a cell to empty it.</li>
            </ul>
            <div>
              <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="mr-1.5 size-3.5" aria-hidden /> Download template</Button>
            </div>
          </div>
        ) : null}

        {phase.step === "map" ? (
          <div className="grid gap-3">
            <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">Column in your file</th><th className="px-3 py-2 font-medium">Example</th><th className="w-64 px-3 py-2 font-medium">Import as</th></tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={`${h}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{h || <span className="text-muted-foreground">(no name)</span>}</td>
                      <td className="max-w-48 truncate px-3 py-2 text-muted-foreground">{rows.find((r) => r[i]?.trim())?.[i]?.slice(0, 60) ?? ""}</td>
                      <td className="px-3 py-2">
                        <SimpleSelect ariaLabel={`Field for ${h}`} value={mapping[i] ?? SKIP} options={fieldOptions} onChange={(v) => setMapping((m) => m.map((x, j) => (j === i ? (v === SKIP ? null : v) : x)))} />
                        {(mapping[i] ?? SKIP) !== SKIP && duplicateTargets.includes(mapping[i] ?? SKIP) ? <p className="mt-1 text-xs text-destructive">Used by more than one column</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasKey ? <p className="text-sm text-destructive">Map a column to URL handle or Title so products can be told apart.</p> : null}
            <div className="flex justify-between gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Pick another file</Button>
              <Button size="sm" disabled={busy || !hasKey || duplicateTargets.length > 0} onClick={() => void toReview()}>{busy ? "Checking…" : "Review import"}</Button>
            </div>
          </div>
        ) : null}

        {phase.step === "review" ? (
          <ReviewStep
            phase={phase}
            policy={policy}
            setPolicy={setPolicy}
            mode={mode}
            setMode={setMode}
            busy={busy}
            onBack={() => setPhase({ step: "map" })}
            onDownload={downloadProblems}
            onStart={(blocked) => (policy === "replace" ? setConfirmReplace(true) : void start(phase.products, blocked))}
          />
        ) : null}

        {phase.step === "running" ? <ProgressView run={live} sendingNote={phase.sending ? `Saving products… ${n(phase.sent)} of ${n(phase.total)} sent` : "All products sent. Images are still downloading on the server; you can close this window; they keep downloading and appear on the products as they finish."} /> : null}

        {phase.step === "running" && !phase.sending ? (
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false); onImported(); }}>Close and keep downloading</Button></div>
        ) : null}

        {phase.step === "done" ? (
          <div className="grid gap-3">
            <ProgressView run={phase.run} sendingNote={null} />
            <ProblemList problems={phase.run.errors} truncated={phase.run.errorsTruncated} filter={filter} setFilter={setFilter} onDownload={() => downloadProblems(phase.run.errors)} />
            <div className="flex justify-end"><Button size="sm" onClick={() => { reset(); onOpenChange(false); }}>Close</Button></div>
          </div>
        ) : null}

        <ConfirmDialog
          open={confirmReplace}
          onOpenChange={setConfirmReplace}
          title="Replace existing products?"
          description="Products that already exist will be rewritten from the file: mapped columns left blank are cleared, and variants that are not in the file are removed (variants with past orders are kept). This cannot be undone."
          confirmLabel="Replace and import"
          destructive
          onConfirm={() => {
            setConfirmReplace(false);
            if (phase.step === "review") void start(phase.products, blockedHandles(phase.preview));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Products the server already knows it cannot import (unknown collection, SKU owned by another product, no price). */
function blockedHandles(preview: Preview): Set<string> {
  return new Set(preview.items.filter((i) => i.state === "unknown_category" || i.state === "sku_conflict" || i.state === "missing_price").map((i) => i.handle));
}

function ReviewStep({ phase, policy, setPolicy, mode, setMode, busy, onBack, onDownload, onStart }: {
  phase: Extract<Phase, { step: "review" }>;
  policy: Policy;
  setPolicy: (p: Policy) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  busy: boolean;
  onBack: () => void;
  onDownload: (p: Problem[]) => void;
  onStart: (blocked: Set<string>) => void;
}) {
  const { preview, parseIssues } = phase;
  const blocked = blockedHandles(preview);
  const importable = preview.toCreate + preview.existing;
  const problems: Problem[] = [...parseIssues.map((i) => ({ row: i.row, handle: i.handle, kind: "row", message: i.error })), ...preview.issues];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="New products" value={preview.toCreate} />
        <Stat label="Already exist" value={preview.existing} tone={preview.existing ? "warn" : undefined} />
        <Stat label="Will be skipped" value={blocked.size + parseIssues.length} tone={blocked.size + parseIssues.length ? "bad" : undefined} />
        <Stat label="Images to download" value={preview.images} />
      </div>

      {preview.existing > 0 || preview.skuConflicts > 0 ? (
        <section className="grid gap-2 rounded-md border border-border p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium"><AlertTriangle className="size-4 text-amber-600" aria-hidden /> {n(preview.existing)} product{preview.existing === 1 ? "" : "s"} already exist{preview.existing === 1 ? "s" : ""}. What should happen?</h3>
          <RadioGroup value={policy} onValueChange={(v) => setPolicy(v as Policy)} className="grid gap-2">
            <label className="flex items-start gap-2 text-sm"><RadioGroupItem value="skip" className="mt-0.5" /><span><b>Skip them.</b> Leave existing products untouched.</span></label>
            <label className="flex items-start gap-2 text-sm"><RadioGroupItem value="update" className="mt-0.5" /><span><b>Update them.</b> Change only the columns in the file; blank cells keep the current value.</span></label>
            <label className="flex items-start gap-2 text-sm"><RadioGroupItem value="replace" className="mt-0.5" /><span><b>Replace them.</b> Rewrite from the file, clear blank mapped columns and remove variants that are not in the file.</span></label>
          </RadioGroup>
        </section>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Import mode</span>
        <SimpleSelect ariaLabel="Import mode" className="w-56" value={mode} onChange={(v) => setMode(v as Mode)} options={[{ value: "create_and_update", label: "Create and update" }, { value: "create_only", label: "Create new only" }, { value: "update_only", label: "Update existing only" }]} />
      </div>

      {preview.items.length ? (
        <div className="max-h-48 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground"><tr><th className="px-3 py-1.5 font-medium">Row</th><th className="px-3 py-1.5 font-medium">Product</th><th className="px-3 py-1.5 font-medium">Result</th></tr></thead>
            <tbody>
              {preview.items.map((it) => (
                <tr key={`${it.row}-${it.handle}`} className="border-t border-border">
                  <td className="px-3 py-1.5">{it.row}</td>
                  <td className="px-3 py-1.5">{it.title || it.handle}</td>
                  <td className={`px-3 py-1.5 ${it.state === "new" || it.state === "exists" ? "" : "text-destructive"}`}>{STATE_LABEL[it.state]}{it.detail ? ` — ${it.detail}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.total > preview.items.length ? <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">Showing the first {preview.items.length} of {n(preview.total)} products.</p> : null}
        </div>
      ) : null}

      {problems.length ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => onDownload(problems)}><Download className="mr-1.5 size-3.5" aria-hidden /> Download {n(problems.length)} problem{problems.length === 1 ? "" : "s"}</Button>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>Back to mapping</Button>
        <Button size="sm" disabled={busy || importable === 0} onClick={() => onStart(blocked)}>
          <Upload className="mr-1.5 size-3.5" aria-hidden /> {busy ? "Starting…" : `Import ${n(importable)} product${importable === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" | undefined }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className={`text-lg font-semibold ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : ""}`}>{n(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ProgressView({ run, sendingNote }: { run: Run | null; sendingNote: string | null }) {
  if (!run) return <p className="text-sm text-muted-foreground">Starting…</p>;
  const imagesDone = run.imagesDone + run.imagesFailed;
  const finished = run.status !== "running";
  return (
    <div className="grid gap-3" role="status" aria-live="polite">
      <div className="grid gap-1">
        <div className="flex justify-between text-sm"><span>Products</span><span className="text-muted-foreground">{n(run.productsDone)} of {n(run.productsTotal)}</span></div>
        <Progress value={pct(run.productsDone, run.productsTotal)} />
      </div>
      <div className="grid gap-1">
        <div className="flex justify-between text-sm"><span>Images</span><span className="text-muted-foreground">{run.imagesTotal ? `${n(imagesDone)} of ${n(run.imagesTotal)}${run.imagesFailed ? `, ${n(run.imagesFailed)} failed` : ""}` : "none to download"}</span></div>
        <Progress value={run.imagesTotal ? pct(imagesDone, run.imagesTotal) : finished ? 100 : 0} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Created" value={run.created} />
        <Stat label="Updated" value={run.updated} />
        <Stat label="Skipped" value={run.skipped} tone={run.skipped ? "warn" : undefined} />
        <Stat label="Failed" value={run.failed} tone={run.failed ? "bad" : undefined} />
      </div>
      {sendingNote ? <p className="text-xs text-muted-foreground">{sendingNote}</p> : null}
      {finished ? (
        <p className={`flex items-center gap-1.5 text-sm ${run.status === "completed" ? "" : "text-amber-700"}`}>
          {run.status === "completed" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
          {run.status === "completed" ? "Import completed." : run.status === "completed_with_errors" ? "Import completed with problems. See the list below." : "Import failed."}
        </p>
      ) : null}
    </div>
  );
}

function ProblemList({ problems, truncated, filter, setFilter, onDownload }: { problems: Problem[]; truncated: number; filter: "all" | "row" | "conflict" | "image"; setFilter: (f: "all" | "row" | "conflict" | "image") => void; onDownload: () => void }) {
  if (!problems.length) return null;
  const shown = problems.filter((p) => filter === "all" || p.kind === filter);
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{n(problems.length + truncated)} problem{problems.length + truncated === 1 ? "" : "s"}</h3>
        <div className="flex items-center gap-2">
          <SimpleSelect ariaLabel="Filter problems" className="w-44" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: "All problems" }, { value: "row", label: "Row errors" }, { value: "conflict", label: "Conflicts" }, { value: "image", label: "Image failures" }]} />
          <Button variant="outline" size="sm" onClick={onDownload}><Download className="mr-1.5 size-3.5" aria-hidden /> Download</Button>
        </div>
      </div>
      <div className="max-h-56 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground"><tr><th className="px-3 py-1.5 font-medium">Row</th><th className="px-3 py-1.5 font-medium">Product</th><th className="px-3 py-1.5 font-medium">Type</th><th className="px-3 py-1.5 font-medium">Problem</th></tr></thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-3 py-1.5">{p.row || "—"}</td>
                <td className="px-3 py-1.5">{p.handle}</td>
                <td className="px-3 py-1.5">{p.kind === "image" ? "Image" : p.kind === "conflict" ? "Conflict" : "Row"}</td>
                <td className="px-3 py-1.5">{p.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated > 0 ? <p className="text-xs text-muted-foreground">Only the first {n(problems.length)} problems are kept; {n(truncated)} more were not stored.</p> : null}
    </section>
  );
}
