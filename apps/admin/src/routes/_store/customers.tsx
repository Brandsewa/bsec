import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Ban, Copy, Download, ExternalLink, MoreHorizontal, ShieldCheck, ShoppingBag, Tag, Trash2, Upload, UserCheck, Users, UsersRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@bs/ui";
import { Input } from "@bs/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@bs/ui";
import { parseCsv } from "../../lib/csv.ts";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import {
  compactSearch,
  dayAfterIso,
  dayStartIso,
  day,
  flag,
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
} from "../../components/data-table/use-table-state.ts";
import { DateRangePicker } from "@bs/ui";
import { money } from "../../components/order-parts.tsx";
import { ScrollTabs } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";
import { useQuery as useSegmentsQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type View = "all" | "accounts" | "guests" | "blocked";
type Sort = "created_desc" | "created_asc" | "name_asc" | "name_desc" | "spent_desc" | "spent_asc" | "orders_desc" | "orders_asc";
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "all", label: "All" },
  { id: "accounts", label: "Customers" },
  { id: "guests", label: "Guests" },
  { id: "blocked", label: "Blocked" },
];
const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "name_asc", label: "Name (A to Z)" },
  { id: "name_desc", label: "Name (Z to A)" },
  { id: "spent_desc", label: "Highest spend" },
  { id: "spent_asc", label: "Lowest spend" },
  { id: "orders_desc", label: "Most orders" },
  { id: "orders_asc", label: "Fewest orders" },
];
const MARKETING_STATES = [
  ["subscribed", "Subscribed"],
  ["unsubscribed", "Unsubscribed"],
  ["not_subscribed", "Not subscribed"],
  ["invalid", "Invalid"],
] as const;
const MARKETING_SELECT = [
  { value: "any", label: "Marketing: any" },
  ...MARKETING_STATES.map(([value, label]) => ({ value, label })),
];

export interface CustomersSearch {
  view: View;
  q?: string | undefined;
  tag?: string | undefined;
  mkt?: (typeof MARKETING_STATES)[number][0] | undefined;
  loc?: string | undefined;
  repeat?: true | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Phase 2: filter by segment (manual members or automatic rules). */
  segment?: string | undefined;
  sort: Sort;
  page: number;
  size: number;
}

/** Coerces whatever is in the address bar into a valid state. */
export function parseCustomersSearch(raw: Record<string, unknown>): CustomersSearch {
  return {
    view: oneOf(raw["view"], VIEWS.map((v) => v.id)) ?? "all",
    q: text(raw["q"]),
    tag: text(raw["tag"]),
    mkt: oneOf(raw["mkt"], MARKETING_STATES.map(([k]) => k)),
    loc: text(raw["loc"]),
    repeat: flag(raw["repeat"]),
    from: day(raw["from"]),
    to: day(raw["to"]),
    segment: text(raw["segment"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "created_desc",
    ...parsePaging(raw),
  };
}

/** The API request for a URL state (also the query key, so tests can build it). */
export function customersListInput(s: CustomersSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    view: s.view,
    sort: s.sort,
    ...(s.q ? { search: s.q } : {}),
    ...(s.tag ? { tag: s.tag } : {}),
    ...(s.mkt ? { marketingState: s.mkt } : {}),
    ...(s.loc ? { location: s.loc } : {}),
    ...(s.segment ? { segmentId: s.segment } : {}),
    ...(s.repeat ? { repeat: true } : {}),
    ...(s.from ? { createdFrom: dayStartIso(s.from) } : {}),
    ...(s.to ? { createdTo: dayAfterIso(s.to) } : {}),
    ...paging,
  };
}

type CustomerRow = Awaited<ReturnType<typeof client.admin.customers.list>>["items"][number];

const MARKETING_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  subscribed: { label: "Subscribed", variant: "default" },
  unsubscribed: { label: "Unsubscribed", variant: "outline" },
  not_subscribed: { label: "Not subscribed", variant: "secondary" },
  invalid: { label: "Invalid", variant: "destructive" },
};

const EXPORT_HEADER = ["Name", "Email", "Phone", "Status", "Orders", "Total spent (INR)", "Last order", "Marketing state", "Consent updated", "Tags", "Joined"];
const exportRow = (c: CustomerRow) => [
  c.name,
  c.email,
  c.phone,
  c.status,
  c.ordersCount,
  (c.totalSpent / 100).toFixed(2),
  c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : "",
  MARKETING_BADGE[c.marketingState]?.label ?? c.marketingState,
  c.marketingUpdatedAt ? new Date(c.marketingUpdatedAt).toISOString() : "",
  c.tags.join("; "),
  new Date(c.createdAt).toISOString(),
];
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// Stats strip: its own query and its own boundary, independent of the list filters.
// ---------------------------------------------------------------------------------------------------------------

function CustomerStatsStrip() {
  const stats = useQuery(orpc.admin.customers.stats.queryOptions());
  if (stats.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }
  const d = stats.data ?? { total: 0, newThisMonth: 0, repeat: 0, subscribers: 0, totalSpend: 0, averageOrderValue: 0 };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
      <MetricCard label="Total customers" value={d.total.toLocaleString("en-IN")} icon={Users} />
      <MetricCard label="New this month" value={d.newThisMonth.toLocaleString("en-IN")} icon={UsersRound} />
      <MetricCard label="Repeat customers" value={d.repeat.toLocaleString("en-IN")} icon={UserCheck} />
      <MetricCard label="Marketing subscribers" value={d.subscribers.toLocaleString("en-IN")} icon={ShieldCheck} />
      <MetricCard label="Total spend" value={money(d.totalSpend)} icon={ShoppingBag} />
      <MetricCard label="Average order value" value={money(d.averageOrderValue)} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// CSV import: parse in the browser, dry-run preview, then commit (over 500 rows the server queues it).
// ---------------------------------------------------------------------------------------------------------------

const IMPORT_HEADERS = ["name", "email", "phone", "tags", "marketing_consent"];

type ImportRowPayload = { name?: string; email: string; phone?: string; tags?: string[]; marketingConsent?: string };
type ImportPhase =
  | { step: "pick" }
  | { step: "preview"; preview: Awaited<ReturnType<typeof client.admin.customers.importPreview>>; rows: ImportRowPayload[] }
  | { step: "committing" }
  | { step: "done"; message: string; errors: Array<{ row: number; email: string; error: string }> };

function ImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void }) {
  const [phase, setPhase] = useState<ImportPhase>({ step: "pick" });
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase({ step: "pick" });
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const table = parseCsv(text);
    if (table.length < 2) {
      toast.error("The file needs a header row and at least one customer row.");
      return;
    }
    const header = (table[0] ?? []).map((h) => h.trim().toLowerCase().replaceAll(" ", "_"));
    const emailIdx = header.indexOf("email");
    if (emailIdx === -1) {
      toast.error('The file needs an "email" column.');
      return;
    }
    const idx = (name: string) => header.indexOf(name);
    const rows = table.slice(1).map((cells) => ({
      name: idx("name") >= 0 ? (cells[idx("name")] ?? "").trim() : undefined,
      email: (cells[emailIdx] ?? "").trim(),
      phone: idx("phone") >= 0 ? (cells[idx("phone")] ?? "").trim() : undefined,
      tags: idx("tags") >= 0 ? (cells[idx("tags")] ?? "").split(/[;|]/).map((t) => t.trim()).filter(Boolean) : undefined,
      marketingConsent: idx("marketing_consent") >= 0 ? (cells[idx("marketing_consent")] ?? "").trim() : undefined,
    }));
    try {
      const preview = await client.admin.customers.importPreview({ rows });
      setPhase({ step: "preview", preview, rows: rows as ImportRowPayload[] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const commit = async (rows: ImportRowPayload[]) => {
    setPhase({ step: "committing" });
    try {
      const result = await client.admin.customers.importCommit({ rows });
      if ("queued" in result && result.queued) {
        setPhase({ step: "done", message: `The file is queued for import (${result.total.toLocaleString("en-IN")} rows). It will appear in the list as it is processed.`, errors: [] });
      } else {
        const r = result as { created: number; updated: number; errors: Array<{ row: number; email: string; error: string }> };
        setPhase({
          step: "done",
          message: `${r.created} customer${r.created === 1 ? "" : "s"} created, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} failed` : ""}.`,
          errors: r.errors,
        });
      }
      onImported();
    } catch (e) {
      toast.error(errorMessage(e));
      setPhase({ step: "pick" });
    }
  };

  const downloadErrors = (errors: Array<{ row: number; email: string; error: string }>) => {
    downloadCsv(`customers-import-errors-${stamp()}.csv`, toCsv(["Row", "Email", "Problem"], errors.map((e) => [e.row, e.email, e.error])));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import customers from CSV</DialogTitle>
          <DialogDescription>
            Columns: {IMPORT_HEADERS.join(", ")}. Email is required; tags are separated with ; or |.
          </DialogDescription>
        </DialogHeader>

        {phase.step === "pick" ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              You are responsible for having the customer&apos;s consent before importing them as marketing subscribers.
              Consent is only recorded for rows whose <code className="text-xs">marketing_consent</code> is yes, subscribed or true.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
            {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
          </div>
        ) : null}

        {phase.step === "preview" ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p>{phase.preview.total.toLocaleString("en-IN")} rows in the file</p>
              <p>{phase.preview.created.toLocaleString("en-IN")} new customers</p>
              <p>{phase.preview.updated.toLocaleString("en-IN")} existing updated (name and tags only)</p>
              <p>{phase.preview.subscribeCount.toLocaleString("en-IN")} will be marked subscribed</p>
              {phase.preview.duplicatesInFile > 0 ? <p className="text-amber-600">{phase.preview.duplicatesInFile} duplicate rows skipped</p> : null}
              {phase.preview.invalid.length > 0 ? <p className="text-destructive">{phase.preview.invalid.length} invalid rows</p> : null}
            </div>
            {phase.preview.invalid.length > 0 ? (
              <div className="max-h-32 overflow-auto rounded-md border border-border p-2 text-xs text-muted-foreground">
                {phase.preview.invalid.slice(0, 10).map((e, i) => (
                  <p key={i}>
                    Row {e.row}: {e.email || "(no email)"} — {e.error}
                  </p>
                ))}
                {phase.preview.invalid.length > 10 ? <p>…and {phase.preview.invalid.length - 10} more</p> : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                Pick another file
              </Button>
              <Button size="sm" disabled={phase.preview.created + phase.preview.updated === 0} onClick={() => void commit(phase.rows)}>
                Import {phase.preview.created + phase.preview.updated > 500 ? `${(phase.preview.created + phase.preview.updated).toLocaleString("en-IN")} rows` : "customers"}
              </Button>
            </div>
          </div>
        ) : null}

        {phase.step === "committing" ? <p className="text-sm text-muted-foreground">Importing…</p> : null}

        {phase.step === "done" ? (
          <div className="grid gap-3">
            <p className="text-sm text-foreground">{phase.message}</p>
            {phase.errors.length > 0 ? (
              <Button variant="outline" size="sm" className="justify-start" onClick={() => downloadErrors(phase.errors)}>
                <Download className="mr-1.5 size-3.5" aria-hidden /> Download error file
              </Button>
            ) : null}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { reset(); onOpenChange(false); }}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export const Route = createFileRoute("/_store/customers")({

  validateSearch: (raw: Record<string, unknown>): Partial<CustomersSearch> =>
    compactSearch(parseCustomersSearch(raw), { view: "all", sort: "created_desc", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: CustomersPage,
});

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function CustomersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parseCustomersSearch);
  const bulk = useBulkRunner();

  const go = (customerId: string) => void navigate({ to: "/customers/$customerId", params: { customerId } });
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) => update({ q: v.trim() || undefined, page: undefined }));

  const list = useQuery({ ...orpc.admin.customers.list.queryOptions({ input: customersListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const options = useQuery(orpc.admin.customers.tags.queryOptions());
  const segmentOptions = useSegmentsQuery(orpc.admin.segments.list.queryOptions({ input: { limit: 100 } }));
  const manualSegments = (segmentOptions.data?.items ?? []).filter((sg) => sg.kind === "manual");

  const hasFilters = Boolean(s.q || s.tag || s.mkt || s.loc || s.repeat || s.from || s.to || s.segment);
  const activeFilterCount = [s.tag, s.mkt, s.loc, s.repeat, s.from || s.to, s.segment].filter(Boolean).length;
  const clearFilters = () => {
    setSearchText("");
    update({ q: undefined, tag: undefined, mkt: undefined, loc: undefined, repeat: undefined, from: undefined, to: undefined, segment: undefined, page: undefined });
  };

  const sel = useTableSelection({
    rows,
    getId: (c: CustomerRow) => c.id,
    total,
    resetKey: JSON.stringify([s.view, s.q, s.tag, s.mkt, s.loc, s.repeat, s.from, s.to, s.segment]),
  });

  // ----- bulk and row actions -----
  const [tagAsk, setTagAsk] = useState<"add" | "remove" | null>(null);
  const [tagValue, setTagValue] = useState("");
  const [blockAsk, setBlockAsk] = useState<CustomerRow[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [subscribedOnly, setSubscribedOnly] = useState(true);
  const [addToSegmentOpen, setAddToSegmentOpen] = useState(false);
  const [pickedSegmentId, setPickedSegmentId] = useState("");
  const [newSegmentName, setNewSegmentName] = useState("");
  const [deleteAsk, setDeleteAsk] = useState<CustomerRow[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = (succeeded: Iterable<string>) => {
    sel.release(succeeded);
    void queryClient.invalidateQueries({ queryKey: orpc.admin.customers.key() });
  };

  const runTags = (mode: "add" | "remove", tag: string, targets: CustomerRow[]) =>
    bulk.run({
      rows: targets,
      getId: (c) => c.id,
      getLabel: (c) => c.name || c.email,
      verb: mode === "add" ? "Adding tag to" : "Removing tag from",
      done: mode === "add" ? "tagged" : "untagged",
      noun: "customer",
      action: (c) => {
        const next = mode === "add" ? (c.tags.includes(tag) ? c.tags : [...c.tags, tag]) : c.tags.filter((t) => t !== tag);
        return client.admin.customers.setTags({ id: c.id, tags: next });
      },
      onFinished: refresh,
    });

  const runStatus = (status: "active" | "blocked", targets: CustomerRow[]) =>
    bulk.run({
      rows: targets,
      getId: (c) => c.id,
      getLabel: (c) => c.name || c.email,
      verb: status === "blocked" ? "Blocking" : "Unblocking",
      done: status === "blocked" ? "blocked" : "unblocked",
      noun: "customer",
      eligible: (c) => c.status !== status,
      action: (c) => client.admin.customers.setStatus({ id: c.id, status }),
      onFinished: refresh,
    });

  const runAddToSegment = async () => {
    const customerIds = sel.picked.map((c) => c.id);
    try {
      let segmentId = pickedSegmentId;
      if (!segmentId && newSegmentName.trim()) {
        const created = await client.admin.segments.create({ name: newSegmentName.trim(), kind: "manual" });
        segmentId = created.id;
      }
      if (!segmentId) {
        toast.error("Pick a segment or name a new one.");
        return;
      }
      const res = await client.admin.segments.members.add({ id: segmentId, customerIds });
      const parts = [`${res.added} added`, res.alreadyIn > 0 ? `${res.alreadyIn} already in` : "", res.notFound.length > 0 ? `${res.notFound.length} not found` : ""].filter(Boolean);
      toast.success(`Added to segment: ${parts.join(", ")}.`);
      sel.release([]);
      setAddToSegmentOpen(false);
      setPickedSegmentId("");
      setNewSegmentName("");
      void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const runDelete = (targets: CustomerRow[]) =>
    bulk.run({
      rows: targets,
      getId: (c) => c.id,
      getLabel: (c) => c.name || c.email,
      verb: "Deleting",
      done: "deleted",
      noun: "customer",
      action: (c) => client.admin.customers.delete({ id: c.id }),
      onFinished: refresh,
    });

  async function exportCustomers(source: "selection" | "matching") {
    try {
      if (source === "selection" && !sel.allResults) {
        downloadCsv(`customers-${stamp()}.csv`, toCsv(EXPORT_HEADER, sel.picked.map(exportRow)));
        toast.success(`Exported ${sel.picked.length} customer${sel.picked.length === 1 ? "" : "s"}.`);
        return;
      }
      const exportInput = (offset: number, limit: number) => ({
        ...customersListInput(s, { limit, offset }),
        ...(source === "matching" && subscribedOnly ? { marketingState: "subscribed" as const } : {}),
      });
      const { rows: all, total: count } = await fetchAllPages((offset, limit) => client.admin.customers.list(exportInput(offset, limit)), {
        onProgress: (done, of) => bulk.setProgress({ label: "Exporting customers", done, total: of }),
      });
      downloadCsv(`customers-${stamp()}.csv`, toCsv(EXPORT_HEADER, all.map(exportRow)));
      toast.success(all.length < count ? `Exported the first ${all.length.toLocaleString("en-IN")} of ${count.toLocaleString("en-IN")} customers.` : `Exported ${all.length.toLocaleString("en-IN")} customers.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulk.setProgress(null);
    }
  }

  // ----- columns -----
  const columns: Column<CustomerRow>[] = [
    {
      id: "customer",
      header: "Customer",
      sort: { asc: "name_asc", desc: "name_desc" },
      cell: (c) => (
        <div className="flex max-w-60 flex-col">
          <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
            <span className="truncate">{c.name || "Unnamed"}</span>
            {c.isGuest ? <Badge variant="outline">Guest</Badge> : null}
            {c.status === "blocked" ? <Badge variant="destructive">Blocked</Badge> : null}
          </span>
          <span className="truncate text-muted-foreground">{c.email}</span>
        </div>
      ),
    },
    { id: "phone", header: "Phone", optional: true, defaultHidden: true, className: "text-muted-foreground", cell: (c) => c.phone },
    { id: "orders", header: "Orders", sort: { asc: "orders_asc", desc: "orders_desc" }, className: "font-medium text-foreground", cell: (c) => `${c.ordersCount} orders` },
    { id: "spent", header: "Total spent", sort: { asc: "spent_asc", desc: "spent_desc" }, className: "text-right font-medium text-foreground", cell: (c) => money(c.totalSpent) },
    {
      id: "lastOrder",
      header: "Last order",
      className: "text-muted-foreground",
      cell: (c) => (c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"),
    },
    {
      id: "marketing",
      header: "Marketing",
      cell: (c) => {
        const b = MARKETING_BADGE[c.marketingState] ?? { label: c.marketingState, variant: "outline" as const };
        return <Badge variant={b.variant}>{b.label}</Badge>;
      },
    },
    {
      id: "tags",
      header: "Tags",
      optional: true,
      cell: (c) => (
        <div className="flex flex-wrap items-center gap-1">
          {c.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
          {c.tags.length > 2 ? <span className="text-muted-foreground">+{c.tags.length - 2}</span> : null}
        </div>
      ),
    },
    {
      id: "joined",
      header: "Joined",
      optional: true,
      defaultHidden: true,
      sort: { asc: "created_asc", desc: "created_desc" },
      className: "text-muted-foreground",
      cell: (c) => new Date(c.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    },
  ];
  const visibility = useColumnVisibility("customers", columns);
  const shown = columns.filter((c) => !c.optional || visibility.isVisible(c.id));

  // ----- filter chips -----
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const mktLabel = MARKETING_STATES.find(([k]) => k === s.mkt)?.[1];
  const chips: FilterChip[] = [
    ...(s.q ? [{ key: "q", label: `Search: ${s.q}`, onRemove: () => { setSearchText(""); setFilter({ q: undefined }); } }] : []),
    ...(s.tag ? [{ key: "tag", label: `Tag: ${s.tag}`, onRemove: () => setFilter({ tag: undefined }) }] : []),
    ...(s.mkt ? [{ key: "mkt", label: `Marketing: ${mktLabel}`, onRemove: () => setFilter({ mkt: undefined }) }] : []),
    ...(s.loc ? [{ key: "loc", label: `Location: ${s.loc}`, onRemove: () => setFilter({ loc: undefined }) }] : []),
    ...(s.segment ? [{ key: "segment", label: `Segment: ${segmentOptions.data?.items.find((sg) => sg.id === s.segment)?.name ?? "selected"}`, onRemove: () => setFilter({ segment: undefined }) }] : []),
    ...(s.repeat ? [{ key: "repeat", label: "Repeat customers", onRemove: () => setFilter({ repeat: undefined }) }] : []),
    ...(s.from || s.to
      ? [{ key: "joined", label: `Joined: ${s.from ? fmtDay(s.from) : "…"} – ${s.to ? fmtDay(s.to) : "…"}`, onRemove: () => setFilter({ from: undefined, to: undefined }) }]
      : []),
  ];

  const locationSelect = [
    { value: "any", label: "Location: any" },
    ...(options.data?.locationStates ?? []).map((st) => ({ value: st, label: st })),
  ];
  const tagSelect = [
    { value: "any", label: "Tag: any" },
    ...(options.data?.tags ?? []).map((t) => ({ value: t, label: t })),
  ];

  const filterControls = (
    <>
      <SimpleSelect ariaLabel="Tag" className="w-full md:w-auto md:min-w-32" value={s.tag ?? "any"} options={tagSelect} onChange={(v) => setFilter({ tag: v === "any" ? undefined : v })} />
      <SimpleSelect ariaLabel="Marketing consent" className="w-full md:w-auto md:min-w-40" value={s.mkt ?? "any"} options={MARKETING_SELECT} onChange={(v) => setFilter({ mkt: v === "any" ? undefined : (v as CustomersSearch["mkt"]) })} />
      <SimpleSelect ariaLabel="Location" className="w-full md:w-auto md:min-w-32" value={s.loc ?? "any"} options={locationSelect} onChange={(v) => setFilter({ loc: v === "any" ? undefined : v })} />
      <SimpleSelect ariaLabel="Segment" className="w-full md:w-auto md:min-w-40" value={s.segment ?? "any"} options={[{ value: "any", label: "Segment: any" }, ...(segmentOptions.data?.items ?? []).map((sg) => ({ value: sg.id, label: sg.name }))]} onChange={(v) => setFilter({ segment: v === "any" ? undefined : v })} />
      <Button variant={s.repeat ? "default" : "outline"} size="sm" className="justify-start md:justify-center" aria-pressed={Boolean(s.repeat)} onClick={() => setFilter({ repeat: s.repeat ? undefined : true })}>
        Repeat customers
      </Button>
      <DateRangePicker className="w-full justify-start md:w-auto" emptyLabel="Joined: any date" from={s.from} to={s.to} onChange={(from, to) => setFilter({ from, to })} />
    </>
  );

  const rowMenu = (c: CustomerRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${c.name || c.email}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => go(c.id)}>
          <ExternalLink /> Open customer
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(c.email);
            toast.success(`Copied ${c.email}`);
          }}
        >
          <Copy /> Copy email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {c.status === "blocked" ? (
          <DropdownMenuItem disabled={bulk.busy} onClick={() => void runStatus("active", [c])}>
            <ShieldCheck /> Unblock customer
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" disabled={bulk.busy} onClick={() => setBlockAsk([c])}>
            <Ban /> Block customer
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={bulk.busy} onClick={() => setDeleteAsk([c])}>
          <Trash2 /> Delete customer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const empty =
    hasFilters || s.view !== "all" ? (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No customers match</p>
        <p className="text-muted-foreground">Try a different search or remove some filters.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
          Clear filters
        </Button>
      </div>
    ) : (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No customers yet</p>
        <p className="text-muted-foreground">Customers appear here after their first order.</p>
      </div>
    );

  const blockedTargets = blockAsk ?? [];
  const deleteTargets = deleteAsk ?? [];
  const deleteSummary =
    deleteTargets.length === 1
      ? deleteTargets[0] && deleteTargets[0].ordersCount > 0
        ? "This customer has orders: their personal details are erased and replaced with a placeholder, their sessions are destroyed, and their orders are kept for accounts and tax. This cannot be undone."
        : "This customer has no orders: their record is deleted completely. This cannot be undone."
      : `${deleteTargets.filter((c) => c.ordersCount > 0).length} of the selected customers have orders and will be anonymised (details erased, orders kept); the rest are deleted completely. This cannot be undone.`;
  return (
    <PageContainer size="full">
      <PageHeader
        title="Customers"
        description="Profiles, order history, addresses, tags and marketing consent for everyone who bought or signed up."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              Import CSV
            </Button>
            <Popover open={exportOpen} onOpenChange={setExportOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" disabled={bulk.busy || total === 0} />}>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export CSV
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={subscribedOnly} onCheckedChange={(v) => setSubscribedOnly(v === true)} aria-label="Subscribed only" />
                Marketing subscribers only
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Off exports every matching customer.</p>
              <Button size="sm" className="mt-3 w-full" disabled={bulk.busy} onClick={() => { setExportOpen(false); void exportCustomers("matching"); }}>
                <Download className="mr-1.5 size-3.5" aria-hidden /> Export filtered list
              </Button>
            </PopoverContent>
          </Popover>
          </div>
        }
      />

      <CustomerStatsStrip />

      <ScrollTabs value={s.view} onChange={(v) => setFilter({ view: v === "all" ? undefined : v })} tabs={VIEWS} />

      <PageSection>
        <div className="grid grid-cols-1 gap-3">
          <TableToolbar
            searchLabel="Search customers"
            searchPlaceholder="Search name, email, phone"
            searchText={searchText}
            onSearchText={setSearchText}
            filters={filterControls}
            activeFilterCount={activeFilterCount}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            resultCount={total}
            noun="customers"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="created_desc"
            onSort={(v) => setFilter({ sort: v })}
            trailing={<ColumnsMenu columns={columns} isVisible={visibility.isVisible} onToggle={visibility.toggle} onReset={visibility.reset} />}
          />

          <FilterChips chips={chips} onClear={clearFilters} />

          <BulkBar
            count={sel.count}
            noun="customer"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note={sel.allResults ? "Bulk actions work on customers you tick yourself. Export covers every matching customer." : undefined}
          >
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => { setTagValue(""); setTagAsk("add"); }}>
              <Tag className="mr-1.5" /> Add tag
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => { setTagValue(""); setTagAsk("remove"); }}>
              <Tag className="mr-1.5" /> Remove tag
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => void runStatus("active", sel.picked)}>
              <ShieldCheck className="mr-1.5" /> Set active
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => setBlockAsk(sel.picked)}>
              <Ban className="mr-1.5" /> Block
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy} onClick={() => void exportCustomers("selection")}>
              <Download className="mr-1.5" /> Export
            </Button>
            <Button variant="outline" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => { setPickedSegmentId(""); setNewSegmentName(""); setAddToSegmentOpen(true); }}>
              <Tag className="mr-1.5" /> Add to segment
            </Button>
            <Button variant="destructive" size="sm" disabled={bulk.busy || sel.allResults} onClick={() => setDeleteAsk(sel.picked)}>
              <Trash2 className="mr-1.5" /> Delete
            </Button>
            {bulk.progress ? (
              <span role="status" className="text-muted-foreground">
                {bulk.progress.label}… {bulk.progress.done}/{bulk.progress.total}
              </span>
            ) : null}
          </BulkBar>

          <DataTable
            columns={shown}
            rows={rows}
            getRowId={(c) => c.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            sort={s.sort}
            onSortChange={(v) => setFilter({ sort: v === "created_desc" ? undefined : v })}
            onRowClick={(c) => go(c.id)}
            rowActions={rowMenu}
            renderCard={(c, ctx) => (
              <div className="flex items-start gap-3 p-3" onClick={() => go(c.id)}>
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${c.name || c.email}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">{c.name || "Unnamed"}</span>
                      {c.isGuest ? <Badge variant="outline">Guest</Badge> : null}
                    </span>
                    <span className="font-medium text-foreground">{money(c.totalSpent)}</span>
                  </div>
                  <p className="truncate text-muted-foreground">{c.email}</p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>{rowMenu(c)}</div>
              </div>
            )}
          />

          <Pagination
            page={s.page}
            pageSize={s.size}
            total={total}
            disabled={list.isFetching}
            onPageChange={(p) => update({ page: p === 1 ? undefined : p })}
            onPageSizeChange={(n) => update({ size: n === 25 ? undefined : n, page: undefined })}
          />
        </div>
      </PageSection>

      <ConfirmDialog
        open={tagAsk !== null}
        onOpenChange={(open) => !open && setTagAsk(null)}
        title={tagAsk === "add" ? "Add tag to customers" : "Remove tag from customers"}
        description={`${sel.picked.length} selected customer${sel.picked.length === 1 ? "" : "s"} will be updated. Customers missing the tag are skipped.`}
        confirmLabel={tagAsk === "add" ? "Add tag" : "Remove tag"}
        onConfirm={() => {
          const tag = tagValue.trim();
          setTagAsk(null);
          if (tag) void runTags(tagAsk ?? "add", tag, sel.picked);
        }}
      >
        <Input aria-label="Tag" value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder="e.g. VIP" autoFocus />
      </ConfirmDialog>

      <ConfirmDialog
        open={blockAsk !== null}
        onOpenChange={(open) => !open && setBlockAsk(null)}
        title={blockedTargets.length === 1 ? `Block ${blockedTargets[0]?.name || blockedTargets[0]?.email}?` : `Block ${blockedTargets.length} customers?`}
        description="Blocked customers cannot sign in or place orders. Their past orders are kept. You can unblock them at any time."
        confirmLabel={blockedTargets.length === 1 ? "Block customer" : "Block customers"}
        destructive
        onConfirm={() => {
          const targets = blockAsk ?? [];
          setBlockAsk(null);
          void runStatus("blocked", targets);
        }}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => refresh([])} />

      <ConfirmDialog
        open={deleteAsk !== null}
        onOpenChange={(open) => !open && setDeleteAsk(null)}
        title={deleteTargets.length === 1 ? `Delete ${deleteTargets[0]?.name || deleteTargets[0]?.email}?` : `Delete ${deleteTargets.length} customers?`}
        description={deleteSummary}
        confirmLabel={deleteTargets.length === 1 ? "Delete customer" : "Delete customers"}
        destructive
        onConfirm={() => {
          const targets = deleteAsk ?? [];
          setDeleteAsk(null);
          void runDelete(targets);
        }}
      />

      <ConfirmDialog
        open={addToSegmentOpen}
        onOpenChange={setAddToSegmentOpen}
        title={`Add ${sel.picked.length} customer${sel.picked.length === 1 ? "" : "s"} to a segment`}
        description="Pick a manual segment, or name a new one to create and fill. Automatic segments cannot be edited by hand."
        confirmLabel="Add to segment"
        onConfirm={() => void runAddToSegment()}
      >
        <div className="grid gap-3">
          <SimpleSelect
            ariaLabel="Pick a segment"
            value={pickedSegmentId || "any"}
            options={[{ value: "any", label: newSegmentName.trim() ? "Create a new segment" : "Pick a segment…" }, ...manualSegments.map((sg) => ({ value: sg.id, label: sg.name }))]}
            onChange={setPickedSegmentId}
          />
          <Input aria-label="New segment name" value={newSegmentName} onChange={(e) => setNewSegmentName(e.target.value)} placeholder="…or name a new manual segment" maxLength={100} />
        </div>
      </ConfirmDialog>
    </PageContainer>
  );
}
export default CustomersPage;
