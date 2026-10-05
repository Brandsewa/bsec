import { createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  Download,
  FileSpreadsheet,
  Lock,
  Scale,
} from "lucide-react";
import { useState } from "react";
import {
  PageContainer,
  PageHeader,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FiscalPeriodItem } from "@bs/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { canExportFinance, downloadFinanceCsv } from "../../lib/finance-export.ts";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export type ReportPeriod = "7d" | "30d" | "90d" | "ytd" | "all";

export interface ReportsSearch {
  period?: ReportPeriod | undefined;
}

const PERIOD_TABS = [
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All time" },
] as const;

export const Route = createFileRoute("/_store/finance_/reports")({
  validateSearch: (raw: Record<string, unknown>): ReportsSearch => ({
    period: typeof raw["period"] === "string" && ["7d", "30d", "90d", "ytd", "all"].includes(raw["period"]) ? (raw["period"] as ReportPeriod) : "30d",
  }),
  pendingComponent: () => <PageSkeleton />,
  component: FinanceReportsPage,
});

function formatPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function FinanceReportsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { store } = useRouteContext({ from: "/_store" });
  const canExport = canExportFinance(store?.role);

  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<FiscalPeriodItem | null>(null);

  // Queries
  const overviewQuery = useQuery(
    orpc.admin.finance.overview.queryOptions({
      input: {
        named: search.period ?? "30d",
      },
    }),
  );

  const trialBalanceQuery = useQuery(
    orpc.admin.finance.ledger.trialBalance.queryOptions({
      input: {
        named: search.period ?? "30d",
      },
    }),
  );

  const periodsQuery = useQuery(
    orpc.admin.finance.periods.list.queryOptions({}),
  );

  const overview = overviewQuery.data;
  const trialBalance = trialBalanceQuery.data;
  const periodsData = periodsQuery.data;

  const reopenMutation = useMutation(
    orpc.admin.finance.periods.reopen.mutationOptions({
      onSuccess: () => {
        toast.success("Fiscal period reopened successfully");
        setReopenTarget(null);
        queryClient.invalidateQueries({ queryKey: orpc.admin.finance.periods.list.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to reopen fiscal period"));
      },
    }),
  );

  const periodsColumns: Column<FiscalPeriodItem>[] = [
    {
      id: "label",
      header: "Month / Period",
      cell: (row) => <span className="font-mono font-semibold">{row.label}</span>,
    },
    {
      id: "closedAt",
      header: "Closed At",
      cell: (row) => <span className="text-sm">{row.closedAt.slice(0, 10)}</span>,
    },
    {
      id: "note",
      header: "Audit Note",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{row.note ?? "Month closed"}</span>
      ),
    },
    {
      id: "actions",
      header: "Action",
      cell: (row) => (
        <div>
          {periodsData?.items[0]?.id === row.id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReopenTarget(row)}
              className="h-7 text-xs"
            >
              Reopen
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Financial Reports & Close"
        description="Tax summaries, monthly GST breakdown, ledger trial balance, and fiscal month-end close."
      />

      <div className="space-y-8">
        {/* Period Selector Tabs */}
        <div className="border-b pb-3">
          <ScrollTabs
            tabs={PERIOD_TABS}
            value={search.period ?? "30d"}
            onChange={(p) =>
              navigate({
                search: (prev) => ({ ...prev, period: p as ReportPeriod }),
              })
            }
          />
        </div>

        {/* 1. Tax Summary & GST Breakdown */}
        <div className="rounded-lg border bg-card p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold">GST Tax Summary</h2>
              <p className="text-xs text-muted-foreground">
                Arithmetic: Tax collected from shoppers − Tax refunded on returns = Tax owed to
                government
              </p>
            </div>
            {overview && (
              <div className="text-right">
                <span className="text-xs text-muted-foreground">Net Tax Owed</span>
                <p className="text-xl font-bold font-mono text-primary">
                  {formatPaise(overview.taxSummary.taxOwedPaise)}
                </p>
              </div>
            )}
          </div>

          {overview && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-md border p-3">
                <span className="text-xs text-muted-foreground">Tax Collected</span>
                <p className="text-base font-semibold font-mono text-emerald-600">
                  {formatPaise(overview.taxSummary.taxCollectedPaise)}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <span className="text-xs text-muted-foreground">Tax Refunded (Returns)</span>
                <p className="text-base font-semibold font-mono text-rose-600">
                  {formatPaise(overview.taxSummary.taxRefundedPaise)}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <span className="text-xs text-muted-foreground">Net Liability (Owed)</span>
                <p className="text-base font-semibold font-mono text-primary">
                  {formatPaise(overview.taxSummary.taxOwedPaise)}
                </p>
              </div>
            </div>
          )}

          {/* Monthly GST Split Table (from order_items) */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Monthly GST Breakdown (CGST / SGST / IGST)</h3>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="p-3">Month</th>
                    <th className="p-3 text-right">Taxable Turnover</th>
                    <th className="p-3 text-right">CGST</th>
                    <th className="p-3 text-right">SGST</th>
                    <th className="p-3 text-right">IGST</th>
                    <th className="p-3 text-right">Total GST</th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono text-xs">
                  {overview?.taxSummary.gstMonthlyBreakdown.map((row) => (
                    <tr key={row.month}>
                      <td className="p-3 font-semibold">{row.month}</td>
                      <td className="p-3 text-right">{formatPaise(row.taxablePaise)}</td>
                      <td className="p-3 text-right">{formatPaise(row.cgstPaise)}</td>
                      <td className="p-3 text-right">{formatPaise(row.sgstPaise)}</td>
                      <td className="p-3 text-right">{formatPaise(row.igstPaise)}</td>
                      <td className="p-3 text-right font-semibold text-primary">
                        {formatPaise(row.totalTaxPaise)}
                      </td>
                    </tr>
                  ))}
                  {(!overview || overview.taxSummary.gstMonthlyBreakdown.length === 0) && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        No taxable order items found in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 2. CSV Export Hub */}
        {canExport && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            Financial Data Export
          </h2>
          <p className="text-xs text-muted-foreground">
            Download RFC 4180 compliant CSV sheets with UTF-8 BOM encoding for your CA or audit.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="rounded-md border p-4 flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">General Ledger Entries</span>
                <p className="text-xs text-muted-foreground">Double-entry spine with debit/credit pairs</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  downloadFinanceCsv("ledger", search.period ?? "30d").catch((err) => toast.error(errorMessage(err, "Export failed")));
                }}
                className="gap-1.5"
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>

            <div className="rounded-md border p-4 flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">Expenses & Overhead</span>
                <p className="text-xs text-muted-foreground">Operating costs, categories, and bills</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  downloadFinanceCsv("expenses", search.period ?? "30d").catch((err) => toast.error(errorMessage(err, "Export failed")));
                }}
                className="gap-1.5"
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        </div>
        )}

        {/* 3. Trial Balance Section */}
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Ledger Trial Balance
              </h2>
              <p className="text-xs text-muted-foreground">
                Sum of all debits must equal sum of all credits across the entire ledger.
              </p>
            </div>
            {trialBalance && (
              <Badge
                variant={trialBalance.balanced ? "default" : "destructive"}
                className={trialBalance.balanced ? "bg-emerald-600 text-xs" : "text-xs"}
              >
                {trialBalance.balanced ? "Balanced (Debits = Credits)" : "Imbalanced"}
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="p-3">Account</th>
                  <th className="p-3 text-right">Total Debits</th>
                  <th className="p-3 text-right">Total Credits</th>
                  <th className="p-3 text-right">Account Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-xs">
                {trialBalance?.rows.map((r) => (
                  <tr key={r.account}>
                    <td className="p-3 font-sans font-medium">{r.label}</td>
                    <td className="p-3 text-right">{formatPaise(r.totalDebitPaise)}</td>
                    <td className="p-3 text-right">{formatPaise(r.totalCreditPaise)}</td>
                    <td className="p-3 text-right font-semibold">{formatPaise(r.balancePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Month-End Fiscal Close Panel */}
        <div className="rounded-lg border bg-card p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Lock className="h-5 w-5 text-indigo-600" />
                Month-End Fiscal Close
              </h2>
              <p className="text-xs text-muted-foreground">
                Lock completed months. Postings dated within closed months automatically shift past
                the close boundary to protect historical statements.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setCloseOpen(true)}
              className="gap-1.5"
            >
              <Lock className="h-4 w-4" />
              Close Month
            </Button>
          </div>

          {periodsData?.closedThrough && (
            <div className="rounded-md bg-muted p-3 text-xs flex items-center justify-between">
              <span>Books are permanently closed through:</span>
              <span className="font-mono font-semibold">
                {periodsData.closedThrough.slice(0, 10)}
              </span>
            </div>
          )}

          {periodsData && periodsData.items.length > 0 ? (
            <DataTable
              columns={periodsColumns}
              rows={periodsData.items}
              getRowId={(item) => item.id}
              empty={<p className="text-sm text-muted-foreground">No fiscal periods closed yet.</p>}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No fiscal periods closed yet.</p>
          )}
        </div>
      </div>

      {/* Close Period Dialog */}
      {closeOpen && (
        <ClosePeriodModal
          open={closeOpen}
          onOpenChange={setCloseOpen}
          closableMonths={periodsData?.closableMonths ?? []}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: orpc.admin.finance.periods.list.key() });
          }}
        />
      )}

      {/* Reopen Confirm Dialog */}
      {reopenTarget && (
        <ConfirmDialog
          open={!!reopenTarget}
          onOpenChange={(o) => !o && setReopenTarget(null)}
          title={`Reopen Fiscal Month ${reopenTarget.label}?`}
          description="Reopening will allow postings back into this period. Entries already shifted past the closed boundary will remain where they are."
          confirmLabel="Reopen Month"
          pending={reopenMutation.isPending}
          onConfirm={() =>
            reopenMutation.mutate({
              label: reopenTarget.label,
              reason: "Reopened by store administrator",
            })
          }
        />
      )}
    </PageContainer>
  );
}

function ClosePeriodModal({
  open,
  onOpenChange,
  closableMonths,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closableMonths: string[];
  onSuccess: () => void;
}) {
  const [selectedMonth, setSelectedMonth] = useState(closableMonths[0] ?? "");
  const [note, setNote] = useState("");

  const closeMutation = useMutation(
    orpc.admin.finance.periods.close.mutationOptions({
      onSuccess: () => {
        toast.success(`Fiscal period ${selectedMonth} closed successfully`);
        onOpenChange(false);
        onSuccess();
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to close fiscal period"));
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMonth) {
      toast.error("Please select a month to close");
      return;
    }

    closeMutation.mutate({
      label: selectedMonth,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Close Fiscal Month</DialogTitle>
            <DialogDescription>
              Select a completed calendar month to close. A live profit & loss snapshot will be
              recorded permanently.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Month to Close</Label>
              {closableMonths.length > 0 ? (
                <SimpleSelect
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                  options={closableMonths.map((m) => ({ value: m, label: m }))}
                />
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  No completed months available to close.
                </p>
              )}
            </div>

            <div>
              <Label>Audit Note (Optional)</Label>
              <Input
                placeholder="Reason or month-end closing note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={closeMutation.isPending || closableMonths.length === 0}
            >
              {closeMutation.isPending ? "Closing..." : "Close Period"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
