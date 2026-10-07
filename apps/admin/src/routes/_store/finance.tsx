import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  DollarSign,
  HelpCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import {
  MetricCard,
  MetricCardSkeleton,
  PageContainer,
  PageHeader,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bs/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bs/ui";
import { Input } from "@bs/ui";
import { Label } from "@bs/ui";
import { ScrollTabs } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export type PeriodChoice = "7d" | "30d" | "90d" | "ytd" | "all";

export interface FinanceOverviewSearch {
  period?: PeriodChoice | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const PERIOD_TABS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All time" },
] as const;

export const Route = createFileRoute("/_store/finance")({
  validateSearch: (raw: Record<string, unknown>): FinanceOverviewSearch => ({
    period: typeof raw["period"] === "string" && ["7d", "30d", "90d", "ytd", "all"].includes(raw["period"]) ? (raw["period"] as PeriodChoice) : "30d",
    from: typeof raw["from"] === "string" ? raw["from"] : undefined,
    to: typeof raw["to"] === "string" ? raw["to"] : undefined,
  }),
  pendingComponent: () => <PageSkeleton />,
  component: FinanceOverviewPage,
});

function formatPaise(paise: number, currency = "INR"): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(rupees);
}

export function FinanceOverviewPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  const [adjustOpen, setAdjustOpen] = useState(false);

  // Overview query
  const overviewQuery = useQuery(
    orpc.admin.finance.overview.queryOptions({
      input: {
        named: search.period ?? "30d",
        from: search.from,
        to: search.to,
      },
    }),
  );

  const data = overviewQuery.data;

  const setPeriod = (periodId: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        period: periodId as PeriodChoice,
        from: undefined,
        to: undefined,
      }),
    });
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="Finance Overview"
        description="Live double-entry books, profit & loss, cash position, and balance reconciliation."
        aside={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAdjustOpen(true)}
              className="gap-1.5"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Adjust balances
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Period Selector Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-3">
          <ScrollTabs
            tabs={PERIOD_TABS}
            value={search.period ?? "30d"}
            onChange={(p) => setPeriod(p)}
          />
          {data?.period && (
            <span className="text-xs text-muted-foreground self-end sm:self-center">
              Period: {data.period.from.slice(0, 10)} to {data.period.to.slice(0, 10)}
            </span>
          )}
        </div>

        {/* 1. Anomaly Banner (First, destructive) */}
        {data && data.anomalies.length > 0 && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-5 w-5" />
              <span>Ledger Anomalies Detected ({data.anomalies.length})</span>
            </div>
            <ul className="list-disc pl-5 text-sm space-y-1">
              {data.anomalies.map((a) => (
                <li key={a.account}>
                  <strong>{a.label}</strong>: {a.reason}
                </li>
              ))}
            </ul>
            <div className="pt-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setAdjustOpen(true)}
              >
                Post Corrective Adjustment
              </Button>
            </div>
          </div>
        )}

        {/* Cost Coverage Warning */}
        {data && data.costCoverage.uncostedSharePercent > 0 && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-400 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <HelpCircle className="h-5 w-5 flex-shrink-0" />
              <span>
                Cost of goods snapshot is missing for{" "}
                <strong>{formatPaise(data.costCoverage.revenueUncostedPaise)}</strong> (
                {data.costCoverage.uncostedSharePercent}% of sales). Profit margins reflect
                uncosted revenue.
              </span>
            </div>
          </div>
        )}

        {/* 2. Hero Card: Net Profit & Income / Costs */}
        {overviewQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </div>
        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              label="Net Profit"
              value={formatPaise(data.profitAndLoss.netProfitPaise)}
              description={
                data.profitAndLoss.netProfitPaise >= 0
                  ? "Net surplus for selected period"
                  : "Operating loss for selected period"
              }
            />
            <MetricCard
              label="Total Revenue"
              value={formatPaise(data.profitAndLoss.totalIncomePaise)}
              description="Merchandise + shipping minus refunds"
            />
            <MetricCard
              label="Total Costs & Expenses"
              value={formatPaise(data.profitAndLoss.totalExpensePaise)}
              description="COGS, operating, courier & fees"
            />
          </div>
        ) : null}

        {/* 3. P&L Breakdown: Where it came from / went */}
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-lg border border-border bg-card p-5 space-y-4 shadow-xs">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-emerald-600" />
                Where it came from (Income)
              </h3>
              <div className="space-y-3">
                {data.profitAndLoss.incomeLines.map((line) => (
                  <div
                    key={line.account}
                    className="flex items-center justify-between border-b border-border pb-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{line.label}</span>
                      {line.sign === "contra_income" && (
                        <span className="ml-2 text-xs text-muted-foreground">(contra)</span>
                      )}
                    </div>
                    <span
                      className={
                        line.amountPaise < 0
                          ? "text-destructive font-mono"
                          : "text-foreground font-mono"
                      }
                    >
                      {formatPaise(line.amountPaise)}
                    </span>
                  </div>
                ))}
                {data.profitAndLoss.incomeLines.length === 0 && (
                  <p className="text-sm text-muted-foreground">No income recorded for this period.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 space-y-4 shadow-xs">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <ArrowDownRight className="h-5 w-5 text-rose-600" />
                Where it went (Costs & Expenses)
              </h3>
              <div className="space-y-3">
                {data.profitAndLoss.expenseLines.map((line) => (
                  <div
                    key={line.account}
                    className="flex items-center justify-between border-b border-border pb-2 text-sm"
                  >
                    <span className="font-medium">{line.label}</span>
                    <span className="font-mono text-foreground">
                      {formatPaise(line.amountPaise)}
                    </span>
                  </div>
                ))}
                {data.profitAndLoss.expenseLines.length === 0 && (
                  <p className="text-sm text-muted-foreground">No costs recorded for this period.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. Cash Position & Owed Section */}
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-lg border border-border bg-card p-5 space-y-4 shadow-xs">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Banknote className="h-5 w-5 text-primary" />
                What the business is holding (Cash & Assets)
              </h3>
              <div className="space-y-3">
                {data.cashPosition.assets.map((asset) => (
                  <div
                    key={asset.account}
                    className="flex items-center justify-between border-b border-border pb-2 text-sm"
                  >
                    <span className="font-medium">{asset.label}</span>
                    <span
                      className={`font-mono ${
                        asset.balancePaise < 0 ? "text-destructive font-semibold" : ""
                      }`}
                    >
                      {formatPaise(asset.balancePaise)}
                    </span>
                  </div>
                ))}
                <div className="pt-2 flex justify-between text-sm font-semibold">
                  <span>Total Cash & Bank:</span>
                  <span className="font-mono">{formatPaise(data.cashPosition.totalCashPaise)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 space-y-4 shadow-xs">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-amber-600" />
                Owed (Tax & Unpaid Bills)
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
                  <div>
                    <span className="font-medium">Tax Payable (GST)</span>
                    <p className="text-xs text-muted-foreground">Collected from shoppers owed onward</p>
                  </div>
                  <span className="font-mono">{formatPaise(data.owed.youOweTaxPaise)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
                  <div>
                    <span className="font-medium">Unpaid Operational Bills</span>
                    <p className="text-xs text-muted-foreground">Recorded expenses not yet settled</p>
                  </div>
                  <span className="font-mono">{formatPaise(data.owed.youOweBillsPaise)}</span>
                </div>
                <div className="pt-2 flex justify-between text-sm font-semibold">
                  <span>Total You Owe:</span>
                  <span className="font-mono text-destructive">
                    {formatPaise(data.owed.totalYouOwePaise)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. GMV Card */}
        {data && (
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
            <div>
              <h3 className="font-semibold text-sm">Gross Merchandise Value (GMV)</h3>
              <p className="text-xs text-muted-foreground">
                Sum of placed, non-cancelled orders for this period. GMV is not revenue; revenue is
                only recorded when payments are collected.
              </p>
            </div>
            <span className="text-xl font-bold font-mono text-primary">
              {formatPaise(data.gmvPaise)}
            </span>
          </div>
        )}
      </div>

      {/* Adjust Balances Dialog */}
      <AdjustmentModal
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: orpc.admin.finance.overview.key() });
        }}
      />
    </PageContainer>
  );
}

function AdjustmentModal({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [preset, setPreset] = useState("settled_gateway_to_bank");
  const [accountDebit, setAccountDebit] = useState("cash_bank");
  const [accountCredit, setAccountCredit] = useState("cash_gateway");
  const [amountRupees, setAmountRupees] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const handlePresetChange = (val: string) => {
    setPreset(val);
    switch (val) {
      case "settled_gateway_to_bank":
        setAccountDebit("cash_bank");
        setAccountCredit("cash_gateway");
        setReason("Payment gateway payout settlement to bank account");
        break;
      case "cash_deposited_to_bank":
        setAccountDebit("cash_bank");
        setAccountCredit("cash_on_hand");
        setReason("Cash / COD remittance deposited to bank account");
        break;
      case "tax_paid":
        setAccountDebit("tax_payable");
        setAccountCredit("cash_bank");
        setReason("GST tax remittance paid from bank account");
        break;
      case "write_off":
        setAccountDebit("operating_expense");
        setAccountCredit("cash_on_hand");
        setReason("Write off discrepancy");
        break;
      case "custom":
      default:
        break;
    }
  };

  const createMutation = useMutation(
    orpc.admin.finance.adjustments.create.mutationOptions({
      onSuccess: () => {
        toast.success("Adjustment posted successfully to ledger");
        onOpenChange(false);
        onSuccess();
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to post adjustment"));
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const paise = Math.round(parseFloat(amountRupees || "0") * 100);
    if (isNaN(paise) || paise <= 0) {
      toast.error("Please enter a valid positive amount");
      return;
    }
    if (!reason || reason.trim().length < 4) {
      toast.error("Reason must be at least 4 characters long");
      return;
    }

    createMutation.mutate({
      date,
      accountDebit,
      accountCredit,
      amount: paise,
      currency: "INR",
      reason: reason.trim(),
    });
  };

  const PRESET_OPTIONS = [
    { value: "settled_gateway_to_bank", label: "Settled gateway payout to bank" },
    { value: "cash_deposited_to_bank", label: "Cash / COD remittance deposited to bank" },
    { value: "tax_paid", label: "GST tax paid to government" },
    { value: "write_off", label: "Cash write off" },
    { value: "custom", label: "Custom debit/credit pair" },
  ];

  const ACCOUNT_OPTIONS = [
    { value: "cash_bank", label: "Bank Account (cash_bank)" },
    { value: "cash_gateway", label: "Payment Gateway (cash_gateway)" },
    { value: "cash_on_hand", label: "Cash on Hand / COD (cash_on_hand)" },
    { value: "inventory", label: "Inventory (inventory)" },
    { value: "tax_payable", label: "Tax Payable (tax_payable)" },
    { value: "accounts_payable", label: "Accounts Payable (accounts_payable)" },
    { value: "operating_expense", label: "Operating Expense (operating_expense)" },
    { value: "product_revenue", label: "Product Revenue (product_revenue)" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Adjust Ledger Balances</DialogTitle>
            <DialogDescription>
              Post a strict, balanced double-entry adjustment between two ledger accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Preset Template</Label>
              <SimpleSelect
                value={preset}
                onChange={handlePresetChange}
                options={PRESET_OPTIONS}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Debit Account (+)</Label>
                <SimpleSelect
                  value={accountDebit}
                  onChange={setAccountDebit}
                  options={ACCOUNT_OPTIONS}
                />
              </div>
              <div>
                <Label>Credit Account (-)</Label>
                <SimpleSelect
                  value={accountCredit}
                  onChange={setAccountCredit}
                  options={ACCOUNT_OPTIONS}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                />
              </div>
              <div>
                <Label>Posting Date</Label>
                <Input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Reason & Audit Note</Label>
              <Input
                required
                minLength={4}
                maxLength={500}
                placeholder="Reason for adjustment (4–500 chars)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
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
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Posting..." : "Post Adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
