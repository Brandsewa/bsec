import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  Camera,
  Copy,
  Download,
  ExternalLink,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  ConfirmDialog,
  EmptyState,
  MetricCard,
  MetricCardSkeleton,
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
import { Checkbox } from "@bs/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bs/ui";
import { Input } from "@bs/ui";
import { Textarea } from "@bs/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@bs/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bs/ui";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "../../components/data-table/toolbar-parts.tsx";
import { useBulkRunner } from "../../components/data-table/use-bulk-runner.ts";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import {
  oneOf,
  parsePaging,
  text,
  useColumnVisibility,
  useDebouncedValue,
  useUrlTableState,
  day,
  dayAfterIso,
  dayStartIso,
} from "../../components/data-table/use-table-state.ts";
import { DateRangePicker, ScrollTabs, SimpleSelect } from "@bs/ui";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/returns")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={6} columns={6} />
    </PageSkeleton>
  ),
  component: ReturnsWorkbenchPage,
});

type ReturnView = "all" | "needs_review" | "approved" | "received" | "resolved" | "rejected_closed" | "archived";
type ReturnSort = "created_desc" | "created_asc" | "amount_desc" | "amount_asc";
type ResolutionFilter = "all" | "refund" | "replacement";

const VIEWS: ReadonlyArray<{ id: ReturnView; label: string }> = [
  { id: "all", label: "All returns" },
  { id: "needs_review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "received", label: "Received" },
  { id: "resolved", label: "Resolved" },
  { id: "rejected_closed", label: "Rejected / Closed" },
  { id: "archived", label: "Archived" },
];

const SORTS: ReadonlyArray<{ id: ReturnSort; label: string }> = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "amount_desc", label: "Refund value (high to low)" },
  { id: "amount_asc", label: "Refund value (low to high)" },
];

const RESOLUTIONS: ReadonlyArray<{ value: ResolutionFilter; label: string }> = [
  { value: "all", label: "All resolutions" },
  { value: "refund", label: "Refund only" },
  { value: "replacement", label: "Exchange / replacement" },
];

export interface ReturnsSearch {
  view: ReturnView;
  q?: string | undefined;
  resolution: ResolutionFilter;
  from?: string | undefined;
  to?: string | undefined;
  sort: ReturnSort;
  page: number;
  size: number;
}

export function parseReturnsSearch(raw: Record<string, unknown>): ReturnsSearch {
  return {
    view: (oneOf(raw["view"], VIEWS.map((v) => v.id)) as ReturnView) ?? "all",
    q: text(raw["q"]),
    resolution: (oneOf(raw["resolution"], RESOLUTIONS.map((r) => r.value)) as ResolutionFilter) ?? "all",
    from: day(raw["from"]),
    to: day(raw["to"]),
    sort: (oneOf(raw["sort"], SORTS.map((s) => s.id)) as ReturnSort) ?? "created_desc",
    ...parsePaging(raw),
  };
}

function returnsListInput(s: ReturnsSearch, overrides?: { pageSize?: number; page?: number }) {
  return {
    view: s.view,
    search: s.q ? s.q.trim() : undefined,
    resolution: s.resolution !== "all" ? s.resolution : undefined,
    dateFrom: s.from ? dayStartIso(s.from) : undefined,
    dateTo: s.to ? dayAfterIso(s.to) : undefined,
    sort: s.sort,
    page: overrides?.page ?? s.page,
    pageSize: overrides?.pageSize ?? s.size,
  };
}

type ReturnRow = {
  id: string;
  number: string;
  status: string;
  reason: string;
  resolution: string;
  requestedResolution?: string | null | undefined;
  customerComment?: string | null | undefined;
  exchangeRequest?: string | null | undefined;
  decisionMessage?: string | null | undefined;
  adminNote?: string | null | undefined;
  refundMethod?: string | null | undefined;
  refundReference?: string | null | undefined;
  refundAmount?: number | null | undefined;
  refundedAt?: string | null | undefined;
  exchangeNote?: string | null | undefined;
  exchangeOrderId?: string | null | undefined;
  photosCount: number;
  createdAt: string;
  updatedAt: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  customerEmail?: string | null | undefined;
  customerName?: string | null | undefined;
  items: Array<{ title: string; variantTitle?: string | null | undefined; quantity: number; unitPrice: number; lineTotal: number }>;
  computedRefundAmount: number;
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "requested":
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-300">Needs review</Badge>;
    case "approved":
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-300">Approved</Badge>;
    case "picked_up":
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-300">Picked up</Badge>;
    case "received":
      return <Badge variant="outline" className="bg-sky-500/10 text-sky-700 border-sky-300">Received</Badge>;
    case "refunded":
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-300">Refunded</Badge>;
    case "replaced":
      return <Badge variant="outline" className="bg-teal-500/10 text-teal-700 border-teal-300">Replaced</Badge>;
    case "rejected":
      return <Badge variant="outline" className="bg-rose-500/10 text-rose-700 border-rose-300">Rejected</Badge>;
    case "cancelled":
      return <Badge variant="outline" className="bg-slate-500/10 text-slate-700 border-slate-300">Cancelled</Badge>;
    case "closed":
      return <Badge variant="outline" className="bg-zinc-500/10 text-zinc-700 border-zinc-300">Closed</Badge>;
    default:
      return <Badge variant="outline">{status.replace(/_/g, " ")}</Badge>;
  }
}

const EXPORT_HEADER = ["Return #", "Date", "Status", "Resolution", "Order #", "Customer Name", "Customer Email", "Reason", "Items Count", "Refund Amount (INR)"];

function exportRow(r: ReturnRow) {
  const itemsCount = r.items.reduce((s, i) => s + i.quantity, 0);
  const amount = r.refundAmount ?? r.computedRefundAmount;
  return [
    r.number,
    r.createdAt.slice(0, 10),
    r.status,
    r.resolution,
    r.orderNumber,
    r.customerName ?? "",
    r.customerEmail ?? "",
    r.reason,
    String(itemsCount),
    (amount / 100).toFixed(2),
  ];
}

export function ReturnsWorkbenchPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [s, update] = useUrlTableState(parseReturnsSearch);
  const [searchText, setSearchText] = useDebouncedValue(s.q ?? "", (val) =>
    update({ q: val.trim() || undefined, page: undefined }),
  );

  const [activeReturnId, setActiveReturnId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Dialog state for review actions
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    returnId: string;
    action: "approve" | "reject" | "pick_up" | "receive" | "refund" | "replace" | "close";
    returnItem?: ReturnRow | undefined;
  } | null>(null);

  const [dialogFields, setDialogFields] = useState<{
    resolution: "refund" | "replacement";
    decisionMessage: string;
    adminNote: string;
    restock: boolean;
    refundAmount: string;
    refundMethod: "upi" | "bank_transfer" | "cash" | "original_payment_method" | "other";
    refundReference: string;
    exchangeNote: string;
    exchangeOrderId: string;
  }>({
    resolution: "refund",
    decisionMessage: "",
    adminNote: "",
    restock: true,
    refundAmount: "",
    refundMethod: "upi",
    refundReference: "",
    exchangeNote: "",
    exchangeOrderId: "",
  });

  const queryInput = useMemo(
    () => returnsListInput(s),
    [s],
  );

  const statsQuery = useQuery(orpc.admin.returns.stats.queryOptions());
  const returnsQuery = useQuery(
    orpc.admin.returns.list.queryOptions({
      input: queryInput,
      placeholderData: keepPreviousData,
    }),
  );

  const actMutation = useMutation(
    orpc.admin.returns.act.mutationOptions({
      onSuccess: () => {
        toast.success("Return status updated");
        setActionDialog(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  function openAction(returnItem: ReturnRow, action: "approve" | "reject" | "pick_up" | "receive" | "refund" | "replace" | "close") {
    const isExchange = returnItem.requestedResolution === "replacement" || returnItem.resolution === "replacement";
    const defaultAmount = ((returnItem.refundAmount ?? returnItem.computedRefundAmount) / 100).toFixed(2);
    setDialogFields({
      resolution: isExchange ? "replacement" : "refund",
      decisionMessage: "",
      adminNote: "",
      restock: true,
      refundAmount: defaultAmount,
      refundMethod: "upi",
      refundReference: "",
      exchangeNote: returnItem.exchangeRequest ?? "",
      exchangeOrderId: "",
    });
    setActionDialog({ open: true, returnId: returnItem.id, action, returnItem });
  }

  function handleDialogSubmit() {
    if (!actionDialog) return;
    const { returnId, action } = actionDialog;

    if (action === "reject" && !dialogFields.decisionMessage.trim()) {
      toast.error("Please provide a reason for rejection.");
      return;
    }

    if (action === "refund") {
      const parsedAmount = Math.round(parseFloat(dialogFields.refundAmount) * 100);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        toast.error("Please enter a valid refund amount.");
        return;
      }
      actMutation.mutate({
        id: returnId,
        action: "refund",
        refundAmount: parsedAmount,
        refundMethod: dialogFields.refundMethod,
        refundReference: dialogFields.refundReference.trim() || undefined,
        note: dialogFields.adminNote.trim() || undefined,
      });
      return;
    }

    if (action === "replace") {
      actMutation.mutate({
        id: returnId,
        action: "replace",
        exchangeNote: dialogFields.exchangeNote.trim() || undefined,
        exchangeOrderId: dialogFields.exchangeOrderId.trim() || undefined,
        note: dialogFields.adminNote.trim() || undefined,
      });
      return;
    }

    if (action === "receive") {
      actMutation.mutate({
        id: returnId,
        action: "receive",
        restock: dialogFields.restock,
        note: dialogFields.adminNote.trim() || undefined,
      });
      return;
    }

    actMutation.mutate({
      id: returnId,
      action,
      resolution: action === "approve" ? dialogFields.resolution : undefined,
      decisionMessage: dialogFields.decisionMessage.trim() || undefined,
      note: dialogFields.adminNote.trim() || undefined,
    });
  }

  const columns: Column<ReturnRow>[] = useMemo(
    () => [
      {
        id: "number",
        header: "Return #",
        cell: (row) => (
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <span className="font-mono text-xs">{row.number}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard.writeText(row.number);
                toast.success(`Copied ${row.number}`);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Copy return number ${row.number}`}
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        ),
      },
      {
        id: "order",
        header: "Order #",
        cell: (row) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void navigate({ to: "/orders/$orderId", params: { orderId: row.orderId } });
            }}
            className="flex items-center gap-1 text-sm text-foreground hover:underline"
          >
            <span>{row.orderNumber}</span>
            <ExternalLink className="size-3 text-muted-foreground" />
          </button>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        cell: (row) => (
          <div className="flex flex-col text-sm">
            <span className="font-medium text-foreground">{row.customerName || "Customer"}</span>
            <span className="text-xs text-muted-foreground">{row.customerEmail || "—"}</span>
          </div>
        ),
      },
      {
        id: "items",
        header: "Items",
        cell: (row) => {
          const totalQty = row.items.reduce((acc, it) => acc + it.quantity, 0);
          const first = row.items[0];
          return (
            <div className="flex flex-col text-xs">
              <span className="font-medium text-foreground truncate max-w-44">
                {first?.title ?? "Items"}
                {first?.variantTitle ? ` (${first.variantTitle})` : ""}
              </span>
              {row.items.length > 1 && (
                <span className="text-muted-foreground">
                  +{row.items.length - 1} more ({totalQty} units total)
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "reason",
        header: "Reason",
        cell: (row) => (
          <div className="flex flex-col text-xs max-w-44">
            <span className="font-medium text-foreground truncate">{row.reason}</span>
            {row.photosCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Camera className="size-3" /> {row.photosCount} photo{row.photosCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        cell: (row) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {row.resolution === "replacement" ? "Exchange" : "Refund"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => <StatusBadge status={row.status} />,
      },
      {
        id: "amount",
        header: "Refund Value",
        cell: (row) => {
          const amount = row.refundAmount ?? row.computedRefundAmount;
          return (
            <span className="font-medium text-foreground">
              ₹{(amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          );
        },
      },
      {
        id: "date",
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
    ],
    [navigate],
  );

  const visibility = useColumnVisibility("returns-workbench", columns);
  const shownColumns = useMemo(
    () => columns.filter((c) => !c.optional || visibility.isVisible(c.id)),
    [columns, visibility],
  );

  const filterChips: FilterChip[] = useMemo(() => {
    const chips: FilterChip[] = [];
    if (s.q) {
      chips.push({
        key: "q",
        label: `Search: "${s.q}"`,
        onRemove: () => {
          setSearchText("");
          update({ q: undefined, page: undefined });
        },
      });
    }
    if (s.resolution !== "all") {
      chips.push({
        key: "resolution",
        label: `Resolution: ${s.resolution === "replacement" ? "Exchange" : "Refund"}`,
        onRemove: () => update({ resolution: "all", page: undefined }),
      });
    }
    if (s.from || s.to) {
      const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      chips.push({
        key: "requested",
        label: `Requested: ${s.from ? fmtDay(s.from) : "…"} – ${s.to ? fmtDay(s.to) : "…"}`,
        onRemove: () => update({ from: undefined, to: undefined, page: undefined }),
      });
    }
    return chips;
  }, [s, update, setSearchText]);

  const bulk = useBulkRunner();
  const rows = (returnsQuery.data?.items ?? []) as ReturnRow[];
  const total = returnsQuery.data?.total ?? 0;

  const sel = useTableSelection({
    rows,
    getId: (r: ReturnRow) => r.id,
    total,
    resetKey: JSON.stringify([s.view, s.resolution, s.from, s.to, s.q]),
  });

  const [toDelete, setToDelete] = useState<ReturnRow[] | null>(null);

  const handleArchive = (items: ReturnRow[]) =>
    bulk.run({
      rows: items,
      getId: (r) => r.id,
      getLabel: (r) => r.number,
      verb: "Archiving",
      done: "archived",
      noun: "return",
      action: (r) => client.admin.returns.archive({ id: r.id }),
      onFinished: (ok) => {
        sel.release(ok);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.key() });
      },
    });

  const handleRestore = (items: ReturnRow[]) =>
    bulk.run({
      rows: items,
      getId: (r) => r.id,
      getLabel: (r) => r.number,
      verb: "Restoring",
      done: "restored",
      noun: "return",
      action: (r) => client.admin.returns.restore({ id: r.id }),
      onFinished: (ok) => {
        sel.release(ok);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.key() });
      },
    });

  const handleDelete = (items: ReturnRow[]) =>
    bulk.run({
      rows: items,
      getId: (r) => r.id,
      getLabel: (r) => r.number,
      verb: "Deleting",
      done: "deleted",
      noun: "return",
      action: (r) => client.admin.returns.delete({ id: r.id }),
      onFinished: (ok) => {
        sel.release(ok);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.returns.key() });
      },
    });

  async function handleExportCsv(source: "selection" | "all" = "all") {
    if (source === "selection" && !sel.allResults) {
      const csv = toCsv(EXPORT_HEADER, sel.picked.map(exportRow));
      downloadCsv(`returns-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${sel.picked.length} return${sel.picked.length === 1 ? "" : "s"}`);
      return;
    }
    setExporting(true);
    try {
      const { rows: allRows } = await fetchAllPages<ReturnRow>(
        async (offset, limit) => {
          const res = await client.admin.returns.list(
            returnsListInput(s, { page: Math.floor(offset / limit) + 1, pageSize: limit }),
          );
          return {
            items: res.items as ReturnRow[],
            total: res.total,
          };
        },
        { cap: 5000 },
      );
      const csv = toCsv(EXPORT_HEADER, allRows.map(exportRow));
      downloadCsv(`returns-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${allRows.length} returns`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const rowMenu = (row: ReturnRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for return ${row.number}`} />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => setActiveReturnId(row.id)}>
          <ExternalLink className="mr-2 size-3.5" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(row.number);
            toast.success(`Copied ${row.number}`);
          }}
        >
          <Copy className="mr-2 size-3.5" /> Copy return #
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(row.orderNumber);
            toast.success(`Copied ${row.orderNumber}`);
          }}
        >
          <Copy className="mr-2 size-3.5" /> Copy order #
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {s.view !== "archived" && row.status !== "archived" && (
          <>
            {row.status === "requested" && (
              <>
                <DropdownMenuItem onClick={() => openAction(row, "approve")}>
                  Approve return
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => openAction(row, "reject")}>
                  Reject return
                </DropdownMenuItem>
              </>
            )}
            {row.status === "approved" && (
              <DropdownMenuItem onClick={() => openAction(row, "pick_up")}>
                Mark picked up
              </DropdownMenuItem>
            )}
            {(row.status === "approved" || row.status === "picked_up") && (
              <DropdownMenuItem onClick={() => openAction(row, "receive")}>
                Mark received
              </DropdownMenuItem>
            )}
            {row.status === "received" && (
              <>
                <DropdownMenuItem onClick={() => openAction(row, "refund")}>
                  Record refund
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openAction(row, "replace")}>
                  Record exchange
                </DropdownMenuItem>
              </>
            )}
            {(row.status === "refunded" || row.status === "replaced" || row.status === "rejected" || row.status === "cancelled") && (
              <DropdownMenuItem onClick={() => openAction(row, "close")}>
                Close case
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={bulk.busy} onClick={() => void handleArchive([row])}>
              <Archive className="mr-2 size-3.5" /> Archive return
            </DropdownMenuItem>
          </>
        )}
        {(s.view === "archived" || row.status === "archived") && (
          <>
            <DropdownMenuItem disabled={bulk.busy} onClick={() => void handleRestore([row])}>
              <RotateCcw className="mr-2 size-3.5" /> Restore return
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" disabled={bulk.busy} onClick={() => setToDelete([row])}>
              <Trash2 className="mr-2 size-3.5" /> Delete permanently
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Returns & Exchanges"
        description="Review customer return requests, inspect items, record refunds, and coordinate replacements."
      />

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statsQuery.isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              label="Needs review"
              value={statsQuery.data?.needsReview ?? 0}
            />
            <MetricCard
              label="Awaiting item"
              value={statsQuery.data?.awaitingItem ?? 0}
            />
            <MetricCard
              label="To resolve"
              value={statsQuery.data?.toResolve ?? 0}
            />
            <MetricCard
              label="Resolved (30d)"
              value={statsQuery.data?.resolvedLast30Days ?? 0}
            />
          </>
        )}
      </div>

      <PageSection>
        <div className="grid grid-cols-1 gap-3">
          {/* Status Navigation Tabs */}
          <ScrollTabs
            tabs={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
            value={s.view}
            onChange={(tabId) => update({ view: tabId as ReturnView, page: undefined })}
          />

          {/* Filters Toolbar */}
          <TableToolbar
            searchLabel="Search returns"
            searchPlaceholder="Search return #, order #, email, name..."
            searchText={searchText}
            onSearchText={setSearchText}
            filters={
              <div className="flex items-center gap-2">
                <SimpleSelect
                  ariaLabel="Resolution filter"
                  className="w-full md:w-44"
                  value={s.resolution}
                  onChange={(val) => update({ resolution: val as ResolutionFilter, page: undefined })}
                  options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label }))}
                />
                <DateRangePicker
                  className="w-full justify-start md:w-auto"
                  emptyLabel="Requested: any date"
                  from={s.from}
                  to={s.to}
                  onChange={(from, to) => update({ from, to, page: undefined })}
                />
              </div>
            }
            resultCount={total}
            noun="returns"
            sortOptions={SORTS}
            sort={s.sort}
            defaultSort="created_desc"
            onSort={(val) => update({ sort: val as ReturnSort, page: undefined })}
            trailing={
              <div className="flex items-center gap-2">
                <ColumnsMenu
                  columns={columns as unknown as Column<unknown>[]}
                  isVisible={visibility.isVisible}
                  onToggle={visibility.toggle}
                  onReset={visibility.reset}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExportCsv("all")}
                  disabled={exporting || total === 0}
                  className="h-8 gap-1.5 text-xs font-medium"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting ? "Exporting..." : "Export CSV"}
                </Button>
              </div>
            }
          />

          {filterChips.length > 0 && (
            <FilterChips
              chips={filterChips}
              onClear={() => update({ q: undefined, from: undefined, to: undefined, resolution: "all", page: undefined })}
            />
          )}

          <BulkBar
            count={sel.count}
            noun="return"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note={sel.allResults ? "Actions work on returns you tick yourself. Export covers every matching return." : undefined}
          >
            {s.view !== "archived" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={bulk.busy || sel.allResults}
                onClick={() => void handleArchive(sel.picked)}
              >
                <Archive className="mr-1.5 size-3.5" /> Archive
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulk.busy || sel.allResults}
                  onClick={() => void handleRestore(sel.picked)}
                >
                  <RotateCcw className="mr-1.5 size-3.5" /> Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={bulk.busy || sel.allResults}
                  onClick={() => setToDelete(sel.picked)}
                >
                  <Trash2 className="mr-1.5 size-3.5" /> Delete
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void handleExportCsv("selection")}
            >
              <Download className="mr-1.5 size-3.5" /> Export
            </Button>
            {bulk.progress ? (
              <span role="status" className="text-muted-foreground text-xs">
                {bulk.progress.label}… {bulk.progress.done}/{bulk.progress.total}
              </span>
            ) : null}
          </BulkBar>

          {/* Data Table */}
          <DataTable
            rows={rows}
            columns={shownColumns}
            getRowId={(r) => r.id}
            isLoading={returnsQuery.isLoading}
            isFetching={returnsQuery.isFetching}
            error={returnsQuery.isError ? { message: errorMessage(returnsQuery.error), onRetry: () => void returnsQuery.refetch() } : null}
            empty={
              <EmptyState
                icon={RotateCcw}
                title="No returns found"
                description={s.view === "archived" ? "No archived returns found." : "No return or exchange requests match your current filters."}
              />
            }
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            rowActions={rowMenu}
            onRowClick={(row) => setActiveReturnId(row.id)}
            renderCard={(r, ctx) => (
              <div className="flex items-start gap-3 p-3" onClick={() => setActiveReturnId(r.id)}>
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select return ${r.number}`} checked={ctx.selected} onCheckedChange={() => ctx.toggle()} />
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground text-xs">{r.number}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.customerName || r.customerEmail || r.orderNumber}</div>
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="capitalize text-muted-foreground">{r.resolution}</span>
                    <span className="font-medium text-foreground">{r.refundAmount ? `₹${(r.refundAmount / 100).toFixed(2)}` : "—"}</span>
                  </div>
                </div>
              </div>
            )}
          />

          {total > s.size && (
            <Pagination
              page={s.page}
              pageSize={s.size}
              total={total}
              onPageChange={(page) => update({ page })}
              onPageSizeChange={(size) => update({ size, page: 1 })}
            />
          )}
        </div>
      </PageSection>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={toDelete?.length === 1 ? `Delete return "${toDelete[0]?.number}"?` : `Delete ${toDelete?.length ?? 0} returns?`}
        description="This will permanently delete the selected archived return record(s) and cannot be undone."
        confirmLabel="Delete permanently"
        cancelLabel="Keep in archive"
        destructive
        onConfirm={() => {
          const items = toDelete ?? [];
          setToDelete(null);
          void handleDelete(items);
        }}
      />

      {/* Review & Detail Sheet */}
      <ReturnDetailSheet
        returnId={activeReturnId}
        onClose={() => setActiveReturnId(null)}
        onOpenAction={openAction}
        onArchive={(row) => void handleArchive([row])}
        onRestore={(row) => void handleRestore([row])}
        onDelete={(row) => setToDelete([row])}
      />

      {/* Action Dialog */}
      {actionDialog && (
        <Dialog open={actionDialog.open} onOpenChange={(o) => !o && setActionDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {actionDialog.action === "approve" && "Approve Return Request"}
                {actionDialog.action === "reject" && "Reject Return Request"}
                {actionDialog.action === "pick_up" && "Mark Items Picked Up"}
                {actionDialog.action === "receive" && "Receive & Inspect Items"}
                {actionDialog.action === "refund" && "Record Refund"}
                {actionDialog.action === "replace" && "Record Replacement / Exchange"}
                {actionDialog.action === "close" && "Close Return Case"}
              </DialogTitle>
              <DialogDescription>
                {actionDialog.action === "approve" && "Approve this request and send return instructions to the customer."}
                {actionDialog.action === "reject" && "Provide a clear reason explaining why this request cannot be fulfilled."}
                {actionDialog.action === "pick_up" && "Confirm that courier or pickup agent has collected the package."}
                {actionDialog.action === "receive" && "Verify items have arrived back at the warehouse/store."}
                {actionDialog.action === "refund" && "Record the refund details issued to the customer."}
                {actionDialog.action === "replace" && "Link or note the replacement order provided to the customer."}
                {actionDialog.action === "close" && "Mark this return request case as completed and closed."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {actionDialog.action === "approve" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Approved resolution</label>
                    <SimpleSelect
                      value={dialogFields.resolution}
                      onChange={(val) => setDialogFields((prev) => ({ ...prev, resolution: val as "refund" | "replacement" }))}
                      options={[
                        { value: "refund", label: "Approve for Refund" },
                        { value: "replacement", label: "Approve for Exchange / Replacement" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Instructions message (sent to customer)</label>
                    <Textarea
                      rows={3}
                      placeholder="Optional custom instructions for packaging and pickup..."
                      value={dialogFields.decisionMessage}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, decisionMessage: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog.action === "reject" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Reason for Rejection (required)</label>
                    <Textarea
                      rows={3}
                      required
                      placeholder="Explain to the customer why this request cannot be accepted."
                      value={dialogFields.decisionMessage}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, decisionMessage: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Staff note (internal)</label>
                    <Input
                      placeholder="Internal reason"
                      value={dialogFields.adminNote}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, adminNote: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog.action === "receive" && (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <label htmlFor="restock-returned-items" className="font-medium text-foreground cursor-pointer">Restock returned items</label>
                      <p className="text-xs text-muted-foreground">Add returned quantities back to inventory on hand.</p>
                    </div>
                    <Checkbox
                      id="restock-returned-items"
                      checked={dialogFields.restock}
                      onCheckedChange={(checked) => setDialogFields((prev) => ({ ...prev, restock: Boolean(checked) }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Inspection note (internal)</label>
                    <Input
                      placeholder="e.g. Item inspected, tags intact, approved for restock."
                      value={dialogFields.adminNote}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, adminNote: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog.action === "refund" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Refund Amount (INR)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={dialogFields.refundAmount}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, refundAmount: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Payment Method</label>
                    <SimpleSelect
                      value={dialogFields.refundMethod}
                      onChange={(val) => setDialogFields((prev) => ({ ...prev, refundMethod: val as "upi" | "bank_transfer" | "cash" | "original_payment_method" | "other" }))}
                      options={[
                        { value: "upi", label: "UPI" },
                        { value: "bank_transfer", label: "Bank Transfer (NEFT/IMPS)" },
                        { value: "cash", label: "Cash" },
                        { value: "original_payment_method", label: "Original Payment Method" },
                        { value: "other", label: "Other" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Reference / Transaction ID</label>
                    <Input
                      placeholder="e.g. UPI Ref # or Bank UTR"
                      value={dialogFields.refundReference}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, refundReference: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {actionDialog.action === "replace" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Exchange fulfillment note</label>
                    <Textarea
                      rows={2}
                      placeholder="e.g. Sent replacement Size L via Bluedart AWB 12345"
                      value={dialogFields.exchangeNote}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, exchangeNote: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Replacement Order ID (optional)</label>
                    <Input
                      placeholder="e.g. Order # or ID"
                      value={dialogFields.exchangeOrderId}
                      onChange={(e) => setDialogFields((prev) => ({ ...prev, exchangeOrderId: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {(actionDialog.action === "pick_up" || actionDialog.action === "close") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Internal staff note (optional)</label>
                  <Input
                    placeholder="Staff notes..."
                    value={dialogFields.adminNote}
                    onChange={(e) => setDialogFields((prev) => ({ ...prev, adminNote: e.target.value }))}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setActionDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={actMutation.isPending}
                variant={actionDialog.action === "reject" ? "destructive" : "default"}
                onClick={handleDialogSubmit}
              >
                {actMutation.isPending ? "Saving..." : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Return Detail Sheet
// ---------------------------------------------------------------------------------------------------------------------

function inr(amount: number) {
  return `₹${(amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function ReturnDetailSheet({
  returnId,
  onClose,
  onOpenAction,
  onArchive,
  onRestore,
  onDelete,
}: {
  returnId: string | null;
  onClose: () => void;
  onOpenAction: (returnItem: ReturnRow, action: "approve" | "reject" | "pick_up" | "receive" | "refund" | "replace" | "close") => void;
  onArchive: (returnItem: ReturnRow) => void;
  onRestore: (returnItem: ReturnRow) => void;
  onDelete: (returnItem: ReturnRow) => void;
}) {
  const navigate = useNavigate();
  const detailQuery = useQuery(
    orpc.admin.returns.get.queryOptions({
      input: { id: returnId ?? "" },
      enabled: Boolean(returnId),
    }),
  );

  const d = detailQuery.data;

  return (
    <Sheet open={Boolean(returnId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-none md:w-[35vw] md:min-w-[500px] max-w-2xl bg-background text-foreground border-l border-border-soft p-6 space-y-6 overflow-y-auto shadow-2xl">
        <SheetHeader className="pb-4 border-b border-border-soft">
          <div className="flex items-center justify-between pr-6">
            <SheetTitle className="text-base font-semibold text-foreground">
              {d?.number ?? "Return Details"}
            </SheetTitle>
            {d && <StatusBadge status={d.status} />}
          </div>
          <SheetDescription className="text-xs text-muted-foreground">
            Requested on {d ? new Date(d.createdAt).toLocaleString("en-IN") : "..."}
          </SheetDescription>
        </SheetHeader>

        {detailQuery.isLoading && (
          <div className="py-8 space-y-4">
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
            <div className="h-20 bg-muted rounded animate-pulse" />
          </div>
        )}

        {d && (
          <div className="py-2 space-y-6">
            {/* Quick Action Bar */}
            <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-border-soft">
              {d.status === "requested" && (
                <>
                  <Button size="sm" onClick={() => onOpenAction(d as unknown as ReturnRow, "approve")}>
                    Approve Request
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => onOpenAction(d as unknown as ReturnRow, "reject")}>
                    Reject Request
                  </Button>
                </>
              )}
              {d.status === "approved" && (
                <>
                  <Button size="sm" onClick={() => onOpenAction(d as unknown as ReturnRow, "pick_up")}>
                    Mark Picked Up
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onOpenAction(d as unknown as ReturnRow, "receive")}>
                    Mark Received
                  </Button>
                </>
              )}
              {d.status === "picked_up" && (
                <Button size="sm" onClick={() => onOpenAction(d as unknown as ReturnRow, "receive")}>
                  Mark Received & Inspect
                </Button>
              )}
              {d.status === "received" && (
                <>
                  <Button size="sm" onClick={() => onOpenAction(d as unknown as ReturnRow, "refund")}>
                    Record Refund
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onOpenAction(d as unknown as ReturnRow, "replace")}>
                    Record Exchange
                  </Button>
                </>
              )}
              {(d.status === "refunded" || d.status === "replaced" || d.status === "rejected" || d.status === "cancelled") && (
                <Button size="sm" variant="outline" onClick={() => onOpenAction(d as unknown as ReturnRow, "close")}>
                  Close Case
                </Button>
              )}
              {d.status !== "archived" ? (
                <Button size="sm" variant="outline" onClick={() => { onArchive(d as unknown as ReturnRow); onClose(); }}>
                  <Archive className="mr-1.5 size-3.5" /> Archive
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => { onRestore(d as unknown as ReturnRow); onClose(); }}>
                    <RotateCcw className="mr-1.5 size-3.5" /> Restore
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => { onDelete(d as unknown as ReturnRow); onClose(); }}>
                    <Trash2 className="mr-1.5 size-3.5" /> Delete
                  </Button>
                </>
              )}
            </div>

            {/* Customer & Order Box */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Order details</span>
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/orders/$orderId", params: { orderId: d.order.id } })}
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <span>{d.order.number}</span>
                  <ExternalLink className="size-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Customer:</span>{" "}
                  <span className="font-medium text-foreground">{d.order.customerName || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <span className="font-medium text-foreground">{d.order.customerEmail || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Order total:</span>{" "}
                  <span className="font-medium text-foreground">{inr(d.order.grandTotal)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment:</span>{" "}
                  <span className="font-medium text-foreground uppercase">{d.order.paymentMethod}</span>
                </div>
              </div>
            </div>

            {/* Reason & Resolution details */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason & Request Details</h4>
              <div className="rounded-lg border border-border divide-y divide-border text-xs">
                <div className="p-3 flex justify-between">
                  <span className="text-muted-foreground">Reason:</span>
                  <span className="font-medium text-foreground">{d.reason}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-muted-foreground">Resolution preference:</span>
                  <span className="font-medium text-foreground capitalize">{d.resolution}</span>
                </div>
                {d.exchangeRequest && (
                  <div className="p-3 space-y-1">
                    <span className="text-muted-foreground">Customer exchange request:</span>
                    <p className="font-medium text-foreground bg-muted/50 p-2 rounded">{d.exchangeRequest}</p>
                  </div>
                )}
                {d.customerComment && (
                  <div className="p-3 space-y-1">
                    <span className="text-muted-foreground">Customer comments:</span>
                    <p className="text-foreground">{d.customerComment}</p>
                  </div>
                )}
                {d.decisionMessage && (
                  <div className="p-3 space-y-1 bg-blue-50/50 dark:bg-blue-950/20">
                    <span className="text-blue-700 dark:text-blue-300 font-semibold">Message to customer:</span>
                    <p className="text-foreground">{d.decisionMessage}</p>
                  </div>
                )}
                {d.adminNote && (
                  <div className="p-3 space-y-1 bg-muted/40">
                    <span className="text-muted-foreground font-semibold">Staff internal note:</span>
                    <p className="text-foreground">{d.adminNote}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Photo Proof */}
            {d.photos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Camera className="size-3.5" /> Photo Proof ({d.photos.length})
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {d.photos.map((p, idx) => (
                    <a
                      key={p.id ?? idx}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/30 hover:opacity-90"
                    >
                      <img src={p.url} alt={`Return photo ${idx + 1}`} className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <ExternalLink className="size-4 text-white" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Refund / Exchange Resolution Outcome */}
            {(d.refundAmount || d.refundMethod || d.exchangeNote || d.exchangeOrderId) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resolution Record</h4>
                <div className="rounded-lg border border-border p-3 text-xs space-y-2 bg-emerald-50/20 dark:bg-emerald-950/10">
                  {d.refundAmount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Refunded amount:</span>
                      <span className="font-bold text-foreground">{inr(d.refundAmount)}</span>
                    </div>
                  )}
                  {d.refundMethod && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Refund method:</span>
                      <span className="font-medium text-foreground uppercase">{d.refundMethod.replace(/_/g, " ")}</span>
                    </div>
                  )}
                  {d.refundReference && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reference / UTR:</span>
                      <span className="font-mono text-foreground">{d.refundReference}</span>
                    </div>
                  )}
                  {d.refundedAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Refunded date:</span>
                      <span className="text-foreground">{new Date(d.refundedAt).toLocaleString("en-IN")}</span>
                    </div>
                  )}
                  {d.exchangeNote && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground">Exchange fulfillment note:</span>
                      <p className="font-medium text-foreground">{d.exchangeNote}</p>
                    </div>
                  )}
                  {d.exchangeOrderId && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Replacement Order:</span>
                      <span className="font-mono text-foreground">{d.exchangeOrderId}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Returned Items Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items in this return</h4>
              <div className="rounded-lg border border-border divide-y divide-border text-xs">
                {d.items.map((item) => (
                  <div key={item.id} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{item.title}</p>
                      {item.variantTitle && <p className="text-muted-foreground">{item.variantTitle}</p>}
                      <p className="text-muted-foreground">Qty: {item.quantity} × {inr(item.unitPrice)}</p>
                    </div>
                    <span className="font-semibold text-foreground">{inr(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
