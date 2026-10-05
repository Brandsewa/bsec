import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Mail,
  MessageSquareQuote,
  MoreHorizontal,
  Phone,
  RotateCcw,
  Send,
  ShoppingBag,
  Trash2,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  EmptyState,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
  toast,
} from "@bs/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bs/ui";
import { Textarea } from "@bs/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@bs/ui";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { ColumnsMenu, FilterChips, type FilterChip } from "../../components/data-table/toolbar-parts.tsx";
import {
  compactSearch,
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
} from "../../components/data-table/use-table-state.ts";
import { money } from "../../components/order-parts.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

type QuoteView = "all" | "needs_reply" | "quote_sent" | "expired" | "accepted" | "closed";
type QuoteSort = "created_desc" | "created_asc" | "number_desc" | "number_asc";
type DateRange = "any" | "7d" | "30d" | "90d";
type CustomerType = "all" | "account" | "guest";

const VIEWS: ReadonlyArray<{ id: QuoteView; label: string }> = [
  { id: "all", label: "All quotes" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "quote_sent", label: "Quote sent" },
  { id: "expired", label: "Expired" },
  { id: "accepted", label: "Accepted" },
  { id: "closed", label: "Closed" },
];

const SORTS: ReadonlyArray<{ id: QuoteSort; label: string }> = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "number_desc", label: "Lead number (high to low)" },
  { id: "number_asc", label: "Lead number (low to high)" },
];

const DATE_RANGES: ReadonlyArray<{ value: DateRange; label: string }> = [
  { value: "any", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const CUSTOMER_TYPES: ReadonlyArray<{ value: CustomerType; label: string }> = [
  { value: "all", label: "All customers" },
  { value: "account", label: "With account" },
  { value: "guest", label: "Guest" },
];

export interface QuotesSearch {
  view: QuoteView;
  q?: string | undefined;
  sort: QuoteSort;
  dateRange: DateRange;
  customerType: CustomerType;
  page: number;
  size: number;
}

export function parseQuotesSearch(raw: Record<string, unknown>): QuotesSearch {
  return {
    view: oneOf(raw["view"], VIEWS.map((v) => v.id)) ?? "all",
    q: text(raw["q"]),
    sort: oneOf(raw["sort"], SORTS.map((s) => s.id)) ?? "created_desc",
    dateRange: oneOf(raw["dateRange"], DATE_RANGES.map((d) => d.value)) ?? "any",
    customerType: oneOf(raw["customerType"], CUSTOMER_TYPES.map((c) => c.value)) ?? "all",
    ...parsePaging(raw),
  };
}

export function quotesListInput(
  s: QuotesSearch,
  paging: { pageSize: number; page: number } = { pageSize: s.size, page: s.page },
) {
  return {
    view: s.view,
    sort: s.sort,
    dateRange: s.dateRange,
    customerType: s.customerType,
    ...(s.q ? { search: s.q } : {}),
    ...paging,
  };
}

type QuoteRow = Awaited<ReturnType<typeof client.admin.quotes.list>>["items"][number];

const EXPORT_HEADER = [
  "Lead Number",
  "Requested Date",
  "Customer Name",
  "Customer Email",
  "Phone",
  "Company",
  "Product",
  "Variant",
  "Quantity",
  "Quoted Total (INR)",
  "Stage",
  "Customer Message",
  "Admin Note",
];

const exportRow = (r: QuoteRow) => [
  r.number,
  new Date(r.createdAt).toISOString(),
  r.name,
  r.email,
  r.phone ?? "",
  r.company ?? "",
  r.productTitle,
  r.variantTitle ?? "",
  String(r.quantity),
  r.quotedTotal != null ? (r.quotedTotal / 100).toFixed(2) : "",
  r.derivedStage,
  r.message ?? "",
  r.adminNote ?? "",
];

export const Route = createFileRoute("/_store/quotes")({
  validateSearch: (raw: Record<string, unknown>): Partial<QuotesSearch> =>
    compactSearch(parseQuotesSearch(raw), {
      view: "all",
      sort: "created_desc",
      dateRange: "any",
      customerType: "all",
      page: 1,
      size: 25,
    }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={7} />
    </PageSkeleton>
  ),
  component: QuotesRoute,
});

function QuotesRoute() {
  const navigate = useNavigate();
  return <QuotesPage navigate={(to, opts) => void navigate({ to, ...opts })} />;
}

function QuoteStatsStrip() {
  const stats = useQuery(orpc.admin.quotes.stats.queryOptions());
  if (stats.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }
  const data = stats.data ?? {
    needsReply: 0,
    quoteSent: 0,
    expired: 0,
    accepted: 0,
    totalQuotesValue: 0,
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      <MetricCard label="Needs reply" value={data.needsReply.toLocaleString("en-IN")} icon={Clock} />
      <MetricCard label="Quote sent" value={data.quoteSent.toLocaleString("en-IN")} icon={Send} />
      <MetricCard label="Expired" value={data.expired.toLocaleString("en-IN")} icon={AlertCircle} />
      <MetricCard label="Accepted" value={data.accepted.toLocaleString("en-IN")} icon={CheckCircle2} />
      <MetricCard
        label="Total quoted"
        value={money(data.totalQuotesValue)}
        icon={ShoppingBag}
        className="col-span-2 lg:col-span-1"
      />
    </div>
  );
}

function StageBadge({ stage }: { stage: QuoteRow["derivedStage"] }) {
  switch (stage) {
    case "needs_reply":
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400">
          Needs reply
        </Badge>
      );
    case "quote_sent":
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-400">
          Quote sent
        </Badge>
      );
    case "accepted":
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-400">
          Accepted
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
          Expired
        </Badge>
      );
    case "closed":
      return (
        <Badge variant="outline" className="bg-zinc-500/10 text-zinc-700 border-zinc-300 dark:text-zinc-400">
          Closed
        </Badge>
      );
  }
}

export function QuotesPage({
  navigate,
}: {
  navigate?: (to: string, opts?: { search?: Record<string, unknown> }) => void;
}) {
  const go = navigate ?? (() => undefined);
  const queryClient = useQueryClient();
  const [s, update] = useUrlTableState(parseQuotesSearch);

  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (v) =>
    update({ q: v.trim() || undefined, page: undefined }),
  );

  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuoteRow | null>(null);

  const listQueryInput = useMemo(
    () => quotesListInput(s, { pageSize: s.size, page: s.page }),
    [s],
  );

  const quotesQuery = useQuery({
    ...orpc.admin.quotes.list.queryOptions({ input: listQueryInput }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.quotes.list.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.quotes.stats.key() });
  };

  const markLostMutation = useMutation(
    orpc.admin.quotes.markLost.mutationOptions({
      onSuccess: () => {
        toast.success("Quote marked as lost");
        invalidate();
      },
      onError: (err: Error) => toast.error(errorMessage(err)),
    }),
  );

  const reopenMutation = useMutation(
    orpc.admin.quotes.reopen.mutationOptions({
      onSuccess: () => {
        toast.success("Quote reopened");
        invalidate();
      },
      onError: (err: Error) => toast.error(errorMessage(err)),
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.quotes.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Quote lead deleted");
        setDeleteTarget(null);
        if (activeQuoteId === deleteTarget?.id) setActiveQuoteId(null);
        invalidate();
      },
      onError: (err: Error) => toast.error(errorMessage(err)),
    }),
  );

  const columns: Column<QuoteRow>[] = useMemo(
    () => [
      {
        id: "requested",
        header: "Requested",
        cell: (row) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {new Date(row.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        id: "number",
        header: "Lead #",
        cell: (row) => (
          <button
            type="button"
            onClick={() => setActiveQuoteId(row.id)}
            className="font-mono text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            {row.number}
          </button>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        cell: (row) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.name}</span>
            <span className="text-xs text-muted-foreground">{row.email}</span>
            {row.company && (
              <span className="text-[11px] text-muted-foreground/80 font-medium">{row.company}</span>
            )}
          </div>
        ),
      },
      {
        id: "product",
        header: "Product / Qty",
        cell: (row) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.productTitle}</span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {row.variantTitle && row.variantTitle !== "Default" && <span>{row.variantTitle} ·</span>}
              <span className="font-semibold text-foreground">Qty: {row.quantity}</span>
            </div>
          </div>
        ),
      },
      {
        id: "quotedTotal",
        header: "Quoted Total",
        cell: (row) => (
          <span className="font-medium text-foreground">
            {row.quotedTotal != null ? money(row.quotedTotal) : <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        id: "stage",
        header: "Stage",
        cell: (row) => <StageBadge stage={row.derivedStage} />,
      },
    ],
    [],
  );

  const visibility = useColumnVisibility("quotes", columns);
  const shownColumns = useMemo(
    () => columns.filter((c) => !c.optional || visibility.isVisible(c.id)),
    [columns, visibility],
  );

  const filterChips: FilterChip[] = useMemo(() => {
    const list: FilterChip[] = [];
    if (s.q) {
      list.push({
        key: "q",
        label: `Search: ${s.q}`,
        onRemove: () => update({ q: undefined, page: undefined }),
      });
    }
    if (s.dateRange !== "any") {
      const label = DATE_RANGES.find((d) => d.value === s.dateRange)?.label ?? s.dateRange;
      list.push({
        key: "dateRange",
        label: `Date: ${label}`,
        onRemove: () => update({ dateRange: "any", page: undefined }),
      });
    }
    if (s.customerType !== "all") {
      const label = CUSTOMER_TYPES.find((c) => c.value === s.customerType)?.label ?? s.customerType;
      list.push({
        key: "customerType",
        label: `Customer: ${label}`,
        onRemove: () => update({ customerType: "all", page: undefined }),
      });
    }
    return list;
  }, [s.customerType, s.dateRange, s.q, update]);

  const [exporting, setExporting] = useState(false);
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const { rows: allRows } = await fetchAllPages(
        (offset, limit) => {
          const page = Math.floor(offset / limit) + 1;
          return client.admin.quotes.list(quotesListInput(s, { pageSize: limit, page }));
        },
      );

      const csvContent = toCsv(EXPORT_HEADER, (allRows as QuoteRow[]).map(exportRow));
      downloadCsv(`quotes-${s.view}-${new Date().toISOString().slice(0, 10)}.csv`, csvContent);
      toast.success(`Exported ${allRows.length} quote leads`);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const rows = quotesQuery.data?.items ?? [];
  const total = quotesQuery.data?.total ?? 0;

  const rowMenu = (row: QuoteRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Quote actions" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => setActiveQuoteId(row.id)}>
          View details
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => go("/orders/new", { search: { quoteId: row.id } })}
        >
          Create quote order
        </DropdownMenuItem>
        {row.derivedStage !== "closed" && row.derivedStage !== "accepted" && (
          <DropdownMenuItem onClick={() => markLostMutation.mutate({ id: row.id })}>
            Mark as lost
          </DropdownMenuItem>
        )}
        {(row.derivedStage === "closed" || row.derivedStage === "expired") && (
          <DropdownMenuItem onClick={() => reopenMutation.mutate({ id: row.id })}>
            <RotateCcw className="mr-2 size-3.5" /> Reopen quote
          </DropdownMenuItem>
        )}
        {(row.status === "new" || row.status === "lost") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 className="mr-2 size-3.5" /> Delete lead
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Orders", href: "/orders" }, { label: "Quotes" }]} />
      <PageHeader
        title="Quotes"
        description="Review custom quote requests and convert them into draft orders with tailored pricing."
        aside={
          <Button variant="outline" size="sm" disabled={exporting || total === 0} onClick={handleExportCsv}>
            <Download className="mr-1.5 size-3.5" />
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        }
      />

      <PageSection>
        <QuoteStatsStrip />
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-1 gap-3">
          <ScrollTabs
            tabs={VIEWS}
            value={s.view}
            onChange={(v) => update({ view: v as QuoteView, page: undefined })}
          />

          <TableToolbar
            searchLabel="Search quotes"
            searchPlaceholder="Search quote #, customer, product..."
            searchText={searchText}
            onSearchText={setSearchText}
            resultCount={total}
            noun="quotes"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="created_desc"
            onSort={(v) => update({ sort: v as QuoteSort, page: undefined })}
            trailing={
              <div className="flex items-center gap-2">
                <SimpleSelect
                  value={s.dateRange}
                  onChange={(v) => update({ dateRange: v as DateRange, page: undefined })}
                  options={DATE_RANGES}
                />
                <SimpleSelect
                  value={s.customerType}
                  onChange={(v) => update({ customerType: v as CustomerType, page: undefined })}
                  options={CUSTOMER_TYPES}
                />
                <ColumnsMenu
                  columns={columns as unknown as Column<unknown>[]}
                  isVisible={visibility.isVisible}
                  onToggle={visibility.toggle}
                  onReset={visibility.reset}
                />
              </div>
            }
          />

          <FilterChips chips={filterChips} onClear={() => update({ q: undefined, dateRange: "any", customerType: "all", page: undefined })} />

          <DataTable
            columns={shownColumns}
            rows={rows}
            getRowId={(r) => r.id}
            isLoading={quotesQuery.isLoading}
            isFetching={quotesQuery.isFetching}
            error={quotesQuery.isError ? { message: errorMessage(quotesQuery.error), onRetry: () => void quotesQuery.refetch() } : null}
            empty={
              <EmptyState
                icon={MessageSquareQuote}
                title="No quote requests found"
                description="Inquiries submitted via 'Price on request' products will appear here."
              />
            }
            onRowClick={(r) => setActiveQuoteId(r.id)}
            rowActions={(r) => rowMenu(r)}
          />

          {total > s.size && (
            <Pagination
              page={s.page}
              pageSize={s.size}
              total={total}
              onPageChange={(p) => update({ page: p })}
              onPageSizeChange={(sz) => update({ size: sz, page: 1 })}
            />
          )}
        </div>
      </PageSection>

      {/* Quote Detail Sheet */}
      {activeQuoteId && (
        <QuoteDetailSheet
          id={activeQuoteId}
          open={Boolean(activeQuoteId)}
          onClose={() => setActiveQuoteId(null)}
          onChanged={invalidate}
          onCreateOrder={(quoteId) => go("/orders/new", { search: { quoteId } })}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete quote lead ${deleteTarget?.number}?`}
        description="This will permanently delete this quote request lead from the system. This action is audited and cannot be undone."
        confirmLabel="Delete lead"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
        }}
      />
    </PageContainer>
  );
}

function QuoteDetailSheet({
  id,
  open,
  onClose,
  onChanged,
  onCreateOrder,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onCreateOrder: (quoteId: string) => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(orpc.admin.quotes.get.queryOptions({ input: { id } }));

  const quote = detailQuery.data;
  const [editedNote, setEditedNote] = useState<string | null>(null);
  const note = editedNote ?? quote?.adminNote ?? "";

  const updateNoteMutation = useMutation(
    orpc.admin.quotes.updateNote.mutationOptions({
      onSuccess: () => {
        toast.success("Internal note saved");
        setEditedNote(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.quotes.get.key({ input: { id } }) });
        onChanged();
      },
      onError: (err: Error) => toast.error(errorMessage(err)),
    }),
  );

  const markLostMutation = useMutation(
    orpc.admin.quotes.markLost.mutationOptions({
      onSuccess: () => {
        toast.success("Quote marked as lost");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.quotes.get.key({ input: { id } }) });
        onChanged();
      },
      onError: (err: Error) => toast.error(errorMessage(err)),
    }),
  );

  const reopenMutation = useMutation(
    orpc.admin.quotes.reopen.mutationOptions({
      onSuccess: () => {
        toast.success("Quote reopened");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.quotes.get.key({ input: { id } }) });
        onChanged();
      },
      onError: (err: Error) => toast.error(errorMessage(err)),
    }),
  );

  const copyToClipboard = (textToCopy: string, label: string) => {
    void navigator.clipboard.writeText(textToCopy);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto p-0 flex flex-col">
        <SheetHeader className="p-6 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base font-bold">Quote {quote?.number ?? "..."}</SheetTitle>
            {quote && <StageBadge stage={quote.derivedStage} />}
          </div>
          <SheetDescription className="text-xs">
            {quote
              ? `Requested on ${new Date(quote.createdAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}`
              : "Loading quote details..."}
          </SheetDescription>
        </SheetHeader>

        {quote ? (
          <div className="flex-1 p-6 space-y-6">
            {/* Customer Details */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <User className="size-3.5" /> Customer Details
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {quote.customerId ? "Registered account" : "Guest lead"}
                </Badge>
              </div>

              <div>
                <p className="font-semibold text-foreground text-sm">{quote.name}</p>
                {quote.company && (
                  <p className="text-xs text-muted-foreground font-medium">{quote.company}</p>
                )}
              </div>

              <div className="grid gap-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Mail className="size-3" /> Email
                  </span>
                  <a
                    href={`mailto:${quote.email}`}
                    className="text-primary hover:underline font-mono"
                  >
                    {quote.email}
                  </a>
                </div>

                {quote.phone && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Phone className="size-3" /> Phone
                    </span>
                    <a href={`tel:${quote.phone}`} className="text-primary hover:underline font-mono">
                      {quote.phone}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Requested Product */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <MessageSquareQuote className="size-3.5" /> Requested Items
              </span>

              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="font-semibold text-foreground text-sm">{quote.productTitle}</p>
                  {quote.variantTitle && quote.variantTitle !== "Default" && (
                    <p className="text-xs text-muted-foreground">{quote.variantTitle}</p>
                  )}
                </div>
                <Badge variant="secondary" className="font-semibold">
                  Qty: {quote.quantity}
                </Badge>
              </div>

              {quote.message && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-foreground">
                  <span className="font-semibold block mb-1 text-muted-foreground">Inquiry Message:</span>
                  <p className="whitespace-pre-wrap leading-relaxed">{quote.message}</p>
                </div>
              )}
            </div>

            {/* Quoted Offer Information (if created) */}
            {quote.quotedTotal != null && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                  Quoted Offer
                </span>

                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-muted-foreground">Agreed Total:</span>
                  <span className="text-lg font-bold text-foreground">{money(quote.quotedTotal)}</span>
                </div>

                {quote.validUntil && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Valid Until:</span>
                    <span className="font-medium text-foreground">
                      {new Date(quote.validUntil).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}

                {quote.orderNumber && (
                  <div className="pt-2 border-t border-blue-500/20 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Pending Order:</span>
                      <span className="font-mono font-semibold text-primary">{quote.orderNumber}</span>
                    </div>

                    <div className="flex gap-2 pt-1">
                      {quote.orderViewUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() =>
                            copyToClipboard(
                              `${window.location.origin}${quote.orderViewUrl}`,
                              "Shopper order link",
                            )
                          }
                        >
                          <Copy className="mr-1.5 size-3" /> Copy order link
                        </Button>
                      )}
                      {quote.orderConfirmUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() =>
                            copyToClipboard(
                              `${window.location.origin}${quote.orderConfirmUrl}`,
                              "COD confirm link",
                            )
                          }
                        >
                          <ExternalLink className="mr-1.5 size-3" /> Copy confirm link
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Internal Staff Notes */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Internal Staff Note
              </span>
              <Textarea
                placeholder="Private notes about negotiations, volume discounts, or follow-ups..."
                rows={3}
                value={note}
                onChange={(e) => setEditedNote(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={updateNoteMutation.isPending || note === (quote.adminNote ?? "")}
                  onClick={() => updateNoteMutation.mutate({ id: quote.id, adminNote: note })}
                >
                  {updateNoteMutation.isPending ? "Saving..." : "Save note"}
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2 border-t border-border">
              <Button
                className="w-full"
                onClick={() => {
                  onClose();
                  onCreateOrder(quote.id);
                }}
              >
                <ShoppingBag className="mr-2 size-4" /> Create quote order
              </Button>

              <div className="flex gap-2">
                {quote.derivedStage !== "closed" && quote.derivedStage !== "accepted" && (
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    disabled={markLostMutation.isPending}
                    onClick={() => markLostMutation.mutate({ id: quote.id })}
                  >
                    Mark as lost
                  </Button>
                )}

                {(quote.derivedStage === "closed" || quote.derivedStage === "expired") && (
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    disabled={reopenMutation.isPending}
                    onClick={() => reopenMutation.mutate({ id: quote.id })}
                  >
                    <RotateCcw className="mr-1.5 size-3.5" /> Reopen quote
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">Loading details...</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
