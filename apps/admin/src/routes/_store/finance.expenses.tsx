import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Download,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  MetricCard,
  MetricCardSkeleton,
  PageContainer,
  PageHeader,
  PageSkeleton,
  TableSkeleton,
  toast,
} from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExpenseItem } from "@bs/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Pagination } from "../../components/data-table/pagination.tsx";
import {
  oneOf,
  parsePaging,
  text,
} from "../../components/data-table/use-table-state.ts";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export type ExpensePeriod = "all" | "7d" | "30d" | "90d" | "ytd";

export interface ExpensesSearch {
  period: ExpensePeriod;
  from?: string | undefined;
  to?: string | undefined;
  category?: string | undefined;
  paidFrom?: string | undefined;
  q?: string | undefined;
  page: number;
  size: number;
}

const PERIOD_TABS = [
  { id: "all", label: "All time" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
] as const;

export const Route = createFileRoute("/_store/finance/expenses")({
  validateSearch: (raw: Record<string, unknown>): ExpensesSearch => ({
    period: (oneOf(raw["period"], ["all", "7d", "30d", "90d", "ytd"]) as ExpensePeriod | undefined) ?? "30d",
    from: text(raw["from"]),
    to: text(raw["to"]),
    category: text(raw["category"]),
    paidFrom: text(raw["paidFrom"]),
    q: text(raw["q"]),
    ...parsePaging(raw),
  }),
  pendingComponent: () => <PageSkeleton />,
  component: ExpensesPage,
});

function formatPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function ExpensesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<ExpenseItem | null>(null);
  const [unsettleTarget, setUnsettleTarget] = useState<ExpenseItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseItem | null>(null);

  const expensesQuery = useQuery(
    orpc.admin.finance.expenses.list.queryOptions({
      input: {
        period: search.period,
        from: search.from,
        to: search.to,
        category: search.category,
        paidFrom: search.paidFrom,
        search: search.q,
        limit: search.size,
        offset: (search.page - 1) * search.size,
      },
    }),
  );

  const data = expensesQuery.data;

  const deleteMutation = useMutation(
    orpc.admin.finance.expenses.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Expense deleted and ledger reversal entry posted");
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: orpc.admin.finance.expenses.list.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to delete expense"));
      },
    }),
  );

  const unsettleMutation = useMutation(
    orpc.admin.finance.expenses.unsettle.mutationOptions({
      onSuccess: () => {
        toast.success("Settlement reversed and bill returned to unpaid status");
        setUnsettleTarget(null);
        queryClient.invalidateQueries({ queryKey: orpc.admin.finance.expenses.list.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to reverse settlement"));
      },
    }),
  );

  const columns: Column<ExpenseItem>[] = [
    {
      id: "date",
      header: "Date",
      cell: (row) => <span className="font-mono text-sm">{row.date}</span>,
    },
    {
      id: "number",
      header: "Expense #",
      cell: (row) => <span className="font-mono text-xs font-semibold">{row.number}</span>,
    },
    {
      id: "description",
      header: "Description / Payee",
      cell: (row) => (
        <div>
          <span className="font-medium">{row.category.replace(/_/g, " ")}</span>
          {row.payee && <p className="text-xs text-muted-foreground">{row.payee}</p>}
          {row.recurring?.enabled && (
            <Badge variant="outline" className="mt-1 text-[10px]">
              Recurring ({row.recurring.interval})
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "paidFrom",
      header: "Paid From / Status",
      cell: (row) => {
        if (row.paidFrom === "unpaid") {
          return row.settlement ? (
            <div className="space-y-0.5">
              <Badge variant="default" className="bg-emerald-600 text-xs">
                Settled ({row.settlement.paidFrom})
              </Badge>
              <p className="text-[10px] text-muted-foreground">{row.settlement.settledAt}</p>
            </div>
          ) : (
            <Badge variant="destructive" className="text-xs">
              Unpaid Bill
            </Badge>
          );
        }
        return (
          <Badge variant="secondary" className="capitalize text-xs">
            {row.paidFrom.replace(/_/g, " ")}
          </Badge>
        );
      },
    },
    {
      id: "amount",
      header: "Amount",
      cell: (row) => (
        <span className="font-mono font-semibold">{formatPaise(row.amount)}</span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => (
        <div className="flex items-center gap-1">
          {row.paidFrom === "unpaid" && !row.settlement && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettleTarget(row)}
              className="h-7 text-xs"
            >
              Mark Paid
            </Button>
          )}
          {row.paidFrom === "unpaid" && row.settlement && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUnsettleTarget(row)}
              className="h-7 text-xs text-muted-foreground"
            >
              Unsettle
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteTarget(row)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Operational Expenses"
        description="Track operational overheads, vendor bills, recurring subscriptions, and payment settlements."
        aside={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `/api/admin/finance/export?type=expenses&period=${search.period}`;
              }}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add Expense
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Metric Cards Strip */}
        {expensesQuery.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MetricCard
              label="Selected Period Expenses"
              value={formatPaise(data?.periodTotalPaise ?? 0)}
              description="Sum of operational costs in this period view"
            />
            <MetricCard
              label="Outstanding Unpaid Bills"
              value={formatPaise(data?.allTimeUnpaidPaise ?? 0)}
              description="All-time recorded expenses pending payment"
            />
          </div>
        )}

        {/* Outstanding Banner if unpaid > 0 */}
        {data && data.allTimeUnpaidPaise > 0 && search.paidFrom !== "unpaid" && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3.5 flex items-center justify-between text-sm">
            <span className="text-amber-800 dark:text-amber-300">
              You have <strong>{formatPaise(data.allTimeUnpaidPaise)}</strong> in unpaid bills
              awaiting settlement.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, period: "all", paidFrom: "unpaid" }),
                })
              }
              className="h-7 text-xs bg-card"
            >
              Filter unpaid bills
            </Button>
          </div>
        )}

        {/* Period Tabs & Table Toolbar */}
        <div className="space-y-4">
          <ScrollTabs
            tabs={PERIOD_TABS}
            value={search.period}
            onChange={(p) =>
              navigate({
                search: (prev) => ({ ...prev, period: p as ExpensePeriod, page: 1 }),
              })
            }
          />

          <div className="flex items-center gap-3">
            <Input
              type="search"
              aria-label="Search expenses"
              placeholder="Search payee, description or note..."
              className="w-full md:max-w-64"
              value={search.q ?? ""}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({ ...prev, q: e.target.value || undefined, page: 1 }),
                })
              }
            />
          </div>

          {/* Table */}
          {expensesQuery.isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : data && data.items.length > 0 ? (
            <div className="space-y-4">
              <DataTable
                columns={columns}
                rows={data.items}
                getRowId={(item) => item.id}
                empty={<p>No expenses found</p>}
              />
              <Pagination
                page={search.page}
                pageSize={search.size}
                total={data.total}
                onPageChange={(p: number) =>
                  navigate({
                    search: (prev) => ({ ...prev, page: p }),
                  })
                }
                onPageSizeChange={(s: number) =>
                  navigate({
                    search: (prev) => ({ ...prev, size: s, page: 1 }),
                  })
                }
              />
            </div>
          ) : (
            <EmptyState
              icon={Receipt}
              title="No expenses found"
              description="No operational costs match the selected period or filters."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Add Expense
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Create Expense Dialog */}
      <CreateExpenseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: orpc.admin.finance.expenses.list.key() });
        }}
      />

      {/* Settle Expense Dialog */}
      {settleTarget && (
        <SettleExpenseModal
          expense={settleTarget}
          open={!!settleTarget}
          onOpenChange={(o) => !o && setSettleTarget(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: orpc.admin.finance.expenses.list.key() });
          }}
        />
      )}

      {/* Unsettle Confirm Dialog */}
      {unsettleTarget && (
        <ConfirmDialog
          open={!!unsettleTarget}
          onOpenChange={(o) => !o && setUnsettleTarget(null)}
          title="Unsettle Expense Bill?"
          description={`This will reverse the settlement entry on the ledger (crediting cash and restoring accounts payable for ${formatPaise(
            unsettleTarget.amount,
          )}).`}
          confirmLabel="Unsettle Bill"
          pending={unsettleMutation.isPending}
          onConfirm={() => unsettleMutation.mutate({ id: unsettleTarget.id })}
        />
      )}

      {/* Delete Expense Confirm Dialog */}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title="Delete Expense?"
          description="A balancing reversal entry will be strictly posted to the ledger first. Nothing will be deleted if the ledger reversal fails."
          confirmLabel="Delete Expense"
          destructive
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate({ id: deleteTarget.id })}
        />
      )}
    </PageContainer>
  );
}

type ExpenseCategoryChoice =
  | "rent"
  | "utilities"
  | "salaries"
  | "contractor"
  | "software_tools"
  | "marketing_ads"
  | "packaging"
  | "office_supplies"
  | "logistics_courier"
  | "inventory_purchase"
  | "professional_fees"
  | "travel"
  | "other";

type PaidFromChoice = "cash_bank" | "cash_gateway" | "cash_on_hand" | "unpaid";

function CreateExpenseModal({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategoryChoice>("rent");
  const [paidFrom, setPaidFrom] = useState<PaidFromChoice>("cash_bank");
  const [amountRupees, setAmountRupees] = useState("");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [interval, setInterval] = useState<"monthly" | "quarterly" | "yearly">("monthly");

  const createMutation = useMutation(
    orpc.admin.finance.expenses.create.mutationOptions({
      onSuccess: () => {
        toast.success("Expense created and ledger posting recorded");
        onOpenChange(false);
        onSuccess();
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create expense"));
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

    createMutation.mutate({
      date,
      category,
      paidFrom,
      amount: paise,
      currency: "INR",
      payee: payee.trim() || undefined,
      note: note.trim() || undefined,
      recurring: isRecurring
        ? {
            enabled: true,
            interval,
            intervalCount: 1,
          }
        : undefined,
    });
  };

  const CATEGORY_OPTIONS = [
    { value: "rent", label: "Office / Warehouse Rent" },
    { value: "utilities", label: "Electricity & Utilities" },
    { value: "salaries", label: "Salaries & Payroll" },
    { value: "contractor", label: "Contractor Fees" },
    { value: "software_tools", label: "Software & Subscriptions" },
    { value: "marketing_ads", label: "Marketing & Paid Ads" },
    { value: "packaging", label: "Packaging & Boxes" },
    { value: "office_supplies", label: "Office Supplies" },
    { value: "logistics_courier", label: "Logistics & Courier Labels" },
    { value: "inventory_purchase", label: "Inventory Purchase (Stock at Cost)" },
    { value: "professional_fees", label: "CA / Legal / Professional Fees" },
    { value: "travel", label: "Travel & Transport" },
    { value: "other", label: "Other General Overhead" },
  ];

  const PAID_FROM_OPTIONS = [
    { value: "cash_bank", label: "Bank Account (cash_bank)" },
    { value: "cash_gateway", label: "Payment Gateway Balance (cash_gateway)" },
    { value: "cash_on_hand", label: "Cash on Hand (cash_on_hand)" },
    { value: "unpaid", label: "Unpaid Bill (Accounts Payable)" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Record Operational Expense</DialogTitle>
            <DialogDescription>
              Record an operational, supply, inventory, or marketing cost into the ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Expense Category</Label>
              <SimpleSelect
                value={category}
                onChange={(v) => setCategory(v as ExpenseCategoryChoice)}
                options={CATEGORY_OPTIONS}
              />
              {category === "inventory_purchase" && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Inventory purchase increases Inventory asset, not P&L operating expense.
                </p>
              )}
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
                <Label>Date</Label>
                <Input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Payment Source</Label>
              <SimpleSelect
                value={paidFrom}
                onChange={(v) => setPaidFrom(v as PaidFromChoice)}
                options={PAID_FROM_OPTIONS}
              />
            </div>

            <div>
              <Label>Payee / Vendor (Optional)</Label>
              <Input
                placeholder="Vendor or recipient name"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </div>

            <div>
              <Label>Note (Optional)</Label>
              <Input
                placeholder="Details or invoice reference"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="recurring"
                  checked={isRecurring}
                  onCheckedChange={(c) => setIsRecurring(!!c)}
                />
                <label
                  htmlFor="recurring"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Repeat on schedule (Recurring Expense)
                </label>
              </div>

              {isRecurring && (
                <div className="pl-6 pt-1">
                  <Label className="text-xs">Interval</Label>
                  <SimpleSelect
                    value={interval}
                    onChange={(v) => setInterval(v as "monthly" | "quarterly" | "yearly")}
                    options={[
                      { value: "monthly", label: "Monthly" },
                      { value: "quarterly", label: "Quarterly" },
                      { value: "yearly", label: "Yearly" },
                    ]}
                  />
                </div>
              )}
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
              {createMutation.isPending ? "Recording..." : "Record Expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettleExpenseModal({
  expense,
  open,
  onOpenChange,
  onSuccess,
}: {
  expense: ExpenseItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [settledAt, setSettledAt] = useState(new Date().toISOString().slice(0, 10));
  const [paidFrom, setPaidFrom] = useState<"cash_bank" | "cash_gateway" | "cash_on_hand">("cash_bank");
  const [note, setNote] = useState("");

  const settleMutation = useMutation(
    orpc.admin.finance.expenses.settle.mutationOptions({
      onSuccess: () => {
        toast.success("Expense marked as paid and settlement entry posted");
        onOpenChange(false);
        onSuccess();
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to settle expense"));
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    settleMutation.mutate({
      id: expense.id,
      settledAt,
      paidFrom,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Mark Bill as Paid</DialogTitle>
            <DialogDescription>
              Settle {formatPaise(expense.amount)} for {expense.category.replace(/_/g, " ")}.
              This will debit Accounts Payable and credit your selected cash account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Settlement Date</Label>
              <Input
                type="date"
                required
                min={expense.date}
                max={new Date().toISOString().slice(0, 10)}
                value={settledAt}
                onChange={(e) => setSettledAt(e.target.value)}
              />
            </div>

            <div>
              <Label>Paid From</Label>
              <SimpleSelect
                value={paidFrom}
                onChange={(v) => setPaidFrom(v as "cash_bank" | "cash_gateway" | "cash_on_hand")}
                options={[
                  { value: "cash_bank", label: "Bank Account" },
                  { value: "cash_gateway", label: "Payment Gateway" },
                  { value: "cash_on_hand", label: "Cash on Hand" },
                ]}
              />
            </div>

            <div>
              <Label>Settlement Note / Reference (Optional)</Label>
              <Input
                placeholder="Bank UTR / cheque reference"
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
            <Button type="submit" disabled={settleMutation.isPending}>
              {settleMutation.isPending ? "Settling..." : "Mark as Paid"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
