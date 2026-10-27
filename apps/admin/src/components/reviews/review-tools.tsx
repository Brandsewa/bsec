import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Star, Upload } from "lucide-react";
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, SimpleSelect, Textarea, toast } from "@bs/ui";
import { downloadCsv, parseCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";
import { fetchAllPages } from "../data-table/fetch-all.ts";

const refresh = (queryClient: ReturnType<typeof useQueryClient>) => {
  void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
};

const EXPORT_HEADER = ["product_handle", "reviewer_name", "rating", "title", "body", "status", "date", "source", "reply"];

/** Export every review that matches the current filters as CSV (the same columns the importer reads). */
export function ExportReviewsButton({ filters }: { filters: Parameters<typeof client.admin.reviews.list>[0] }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const { rows } = await fetchAllPages((offset, limit) => client.admin.reviews.list({ ...(filters ?? {}), limit, offset }));
      downloadCsv(
        `reviews-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(
          EXPORT_HEADER,
          rows.map((r) => [r.productSlug ?? "", r.reviewerName, r.rating, r.title ?? "", r.body, r.status, r.createdAt.slice(0, 10), r.source ?? "customer", r.replyText ?? ""]),
        ),
      );
      toast.success(`Exported ${rows.length} reviews.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
      <Download className="mr-1.5 size-3.5" aria-hidden /> Export
    </Button>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => onChange(n)} className="rounded p-0.5">
          <Star className={`size-6 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
        </button>
      ))}
    </div>
  );
}

/** Add a review by hand. */
export function AddReviewButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<"published" | "on_hold">("published");
  const products = useQuery({ ...orpc.admin.products.list.queryOptions({ input: { limit: 100 } }), enabled: open });

  const create = useMutation(
    orpc.admin.reviews.create.mutationOptions({
      onSuccess: () => {
        toast.success("Review added.");
        refresh(queryClient);
        setOpen(false);
        setName("");
        setTitle("");
        setBody("");
        setDate("");
        setRating(5);
      },
    }),
  );
  const options = (products.data?.items ?? []).map((p: { id: string; title: string }) => ({ value: p.id, label: p.title }));
  const ready = productId !== "" && name.trim() !== "" && body.trim() !== "";

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-3.5" aria-hidden /> Add review
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a review</DialogTitle>
            <DialogDescription>For feedback you collected yourself. It is marked as added by the store and is not a verified purchase.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <label className="grid gap-1 text-sm font-medium">
              Product
              <SimpleSelect value={productId} onChange={setProductId} options={options} placeholder={products.isLoading ? "Loading products..." : "Choose a product"} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Reviewer name
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="grid gap-1 text-sm font-medium">
              Rating
              <StarPicker value={rating} onChange={setRating} />
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Title (optional)
              <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Review
              <Textarea rows={4} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Review date (optional)
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Show on the store
                <SimpleSelect
                  value={status}
                  onChange={(v) => setStatus(v as "published" | "on_hold")}
                  options={[
                    { value: "published", label: "Yes, publish now" },
                    { value: "on_hold", label: "No, keep on hold" },
                  ]}
                />
              </label>
            </div>
            {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!ready || create.isPending}
              onClick={() =>
                create.mutate({
                  productId,
                  reviewerName: name.trim(),
                  rating,
                  ...(title.trim() ? { title: title.trim() } : {}),
                  body: body.trim(),
                  status,
                  ...(date ? { reviewedAt: new Date(date).toISOString() } : {}),
                })
              }
            >
              {create.isPending ? "Adding..." : "Add review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ImportRow = Parameters<typeof client.admin.reviews.import>[0]["rows"][number];

const STATUS_WORDS: Record<string, ImportRow["status"]> = { published: "published", approved: "published", on_hold: "on_hold", pending: "on_hold", hold: "on_hold", spam: "spam", archived: "archived" };

/** Maps CSV rows (header names as exported) onto import rows; rows that cannot be read are reported by line. */
function readCsv(text: string): { rows: ImportRow[]; problems: string[] } {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iProduct = col("product_handle", "handle", "product");
  const iName = col("reviewer_name", "name", "reviewer");
  const iRating = col("rating", "stars");
  const iTitle = col("title");
  const iBody = col("body", "review", "content", "text");
  const iStatus = col("status");
  const iDate = col("date", "created_at", "reviewed_at");
  const problems: string[] = [];
  if (iProduct < 0 || iRating < 0 || iBody < 0) return { rows: [], problems: ["The file needs the columns product_handle, rating and body (reviewer_name, title, status and date are optional)."] };
  const rows: ImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const rating = Number(r[iRating]);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return void problems.push(`Line ${i + 2}: the rating must be 1 to 5.`);
    const statusWord = (iStatus >= 0 ? (r[iStatus] ?? "").trim().toLowerCase() : "") || "published";
    const iso = iDate >= 0 && r[iDate]?.trim() ? new Date(r[iDate] as string) : null;
    rows.push({
      productHandle: (r[iProduct] ?? "").trim(),
      reviewerName: iName >= 0 ? (r[iName] ?? "").trim() : "",
      rating,
      ...(iTitle >= 0 && r[iTitle]?.trim() ? { title: (r[iTitle] as string).trim() } : {}),
      body: (r[iBody] ?? "").trim(),
      status: STATUS_WORDS[statusWord] ?? "published",
      ...(iso && !Number.isNaN(iso.getTime()) ? { reviewedAt: iso.toISOString() } : {}),
    });
  });
  return { rows, problems };
}

/** Import reviews from a CSV file: check first (dry run), then add. */
export function ImportReviewsButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<{ rows: ImportRow[]; problems: string[] } | null>(null);
  const [preview, setPreview] = useState<{ created: number; skipped: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [fileName, setFileName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => client.admin.reviews.import({ dryRun, rows: (parsed?.rows ?? []).slice(0, 500) }),
    onSuccess: (res, dryRun) => {
      setPreview(res);
      if (!dryRun) {
        toast.success(`Imported ${res.created} reviews${res.skipped ? `, skipped ${res.skipped} duplicates` : ""}.`);
        refresh(queryClient);
        setOpen(false);
        setParsed(null);
        setPreview(null);
      }
    },
  });

  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    if (file.size > 2_000_000) return setParsed({ rows: [], problems: ["The file is larger than 2 MB."] });
    const text = await file.text();
    const result = readCsv(text);
    if (result.rows.length > 500) result.problems.unshift("Only the first 500 reviews are imported at a time; import the rest in another file.");
    setParsed(result);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 size-3.5" aria-hidden /> Import
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setParsed(null);
            setPreview(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import reviews</DialogTitle>
            <DialogDescription>
              Upload a CSV with the columns product_handle, rating and body (reviewer_name, title, status and date are optional). Export first to get a file in the right shape. Repeated reviews are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => input.current?.click()}>
              {fileName || "Choose a CSV file"}
            </Button>
            {parsed ? (
              <p className="text-sm text-muted-foreground">
                {parsed.rows.length} review{parsed.rows.length === 1 ? "" : "s"} read from the file.
              </p>
            ) : null}
            {parsed?.problems.length ? (
              <Alert variant="destructive">
                <ul className="list-disc pl-4">
                  {parsed.problems.slice(0, 6).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {preview ? (
              <Alert>
                Ready: {preview.created} to add, {preview.skipped} duplicate{preview.skipped === 1 ? "" : "s"} skipped
                {preview.errors.length ? `, ${preview.errors.length} with problems (${preview.errors.slice(0, 3).map((e) => `row ${e.row}: ${e.message}`).join(" ")})` : ""}.
              </Alert>
            ) : null}
            {run.isError ? <Alert variant="destructive">{errorMessage(run.error)}</Alert> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={!parsed?.rows.length || run.isPending} onClick={() => run.mutate(true)}>
              Check file
            </Button>
            <Button disabled={!preview || preview.created === 0 || run.isPending} onClick={() => run.mutate(false)}>
              {run.isPending ? "Working..." : `Import ${preview?.created ?? 0}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
