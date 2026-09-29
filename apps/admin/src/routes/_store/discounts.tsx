import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Percent, Plus, Tag } from "lucide-react";
import { useState } from "react";
import {
  Button,
  DataTable,
  FilterBar,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
  type ColumnDef,
} from "@bs/ui";

interface DiscountRow {
  id: string;
  code: string | null;
  title: string;
  type: "percent" | "fixed" | "free_shipping" | "buy_x_get_y";
  value: number;
  usageLimit: number | null;
  usedCount: number;
  status: "active" | "scheduled" | "expired" | "disabled";
  combinable: boolean;
}

const mockDiscounts: DiscountRow[] = [
  {
    id: "0199a000-0000-7000-8000-000000000301",
    code: "FESTIVE20",
    title: "Diwali 20% Off",
    type: "percent",
    value: 20,
    usageLimit: 100,
    usedCount: 23,
    status: "active",
    combinable: false,
  },
  {
    id: "0199a000-0000-7000-8000-000000000302",
    code: "FREESHIP",
    title: "Free Shipping on Prepaid Orders",
    type: "free_shipping",
    value: 0,
    usageLimit: null,
    usedCount: 88,
    status: "active",
    combinable: true,
  },
  {
    id: "0199a000-0000-7000-8000-000000000303",
    code: "WELCOME500",
    title: "₹500 Flat Off First Order",
    type: "fixed",
    value: 50000,
    usageLimit: 500,
    usedCount: 498,
    status: "active",
    combinable: false,
  },
];

export const Route = createFileRoute("/_store/discounts")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={5} />
    </PageSkeleton>
  ),
  component: DiscountsPage,
});

function DiscountsPage() {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DiscountRow["type"]>("percent");
  const [value, setValue] = useState(10);
  const [usageLimit, setUsageLimit] = useState<string>("100");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredDiscounts = mockDiscounts.filter((d) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        d.title.toLowerCase().includes(q) ||
        (d.code && d.code.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const columns: ColumnDef<DiscountRow>[] = [
    {
      header: "Discount Code",
      cell: (d) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-foreground bg-surface-200 px-2 py-0.5 rounded text-xs">
            {d.code ?? "AUTOMATIC"}
          </span>
          {d.code && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (d.code) {
                  navigator.clipboard.writeText(d.code);
                  setCopiedId(d.id);
                  setTimeout(() => setCopiedId(null), 1500);
                }
              }}
              className="text-foreground-muted hover:text-foreground"
            >
              {copiedId === d.id ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
            </button>
          )}
        </div>
      ),
    },
    {
      header: "Title",
      cell: (d) => <span className="text-sm font-medium text-foreground">{d.title}</span>,
    },
    {
      header: "Benefit",
      cell: (d) => {
        if (d.type === "percent") return <span className="text-sm font-semibold">{d.value}% off</span>;
        if (d.type === "fixed") return <span className="text-sm font-semibold">₹{d.value / 100} off</span>;
        if (d.type === "free_shipping") return <span className="text-sm font-semibold text-emerald-600">Free Shipping</span>;
        return <span className="text-sm">Buy X Get Y</span>;
      },
    },
    {
      header: "Usage",
      cell: (d) => (
        <span className="text-xs text-foreground-muted">
          {d.usedCount} {d.usageLimit ? `/ ${d.usageLimit}` : "used"}
        </span>
      ),
    },
    {
      header: "Status",
      className: "text-right",
      headerClassName: "text-right",
      cell: (d) => {
        const badgeColors = {
          active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          scheduled: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          expired: "bg-surface-200 text-foreground-muted",
          disabled: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[d.status]}`}>
            {d.status}
          </span>
        );
      },
    },
  ];

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Discounts" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Create discount
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Discounts"
        description="Promotional coupons, percentage off, fixed vouchers, and free shipping rules."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Active Discounts" value={mockDiscounts.filter((d) => d.status === "active").length} icon={Tag} />
        <MetricCard
          label="Total Redemptions"
          value={mockDiscounts.reduce((acc, d) => acc + d.usedCount, 0)}
          icon={Percent}
        />
        <MetricCard
          label="Expiring / Near Limit"
          value={mockDiscounts.filter((d) => d.usageLimit && d.usedCount >= d.usageLimit * 0.9).length}
        />
      </div>

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search discounts by title or code..."
            hasActiveFilters={search.length > 0}
            onReset={() => setSearch("")}
          />

          <DataTable
            data={filteredDiscounts}
            columns={columns}
            keyExtractor={(d) => d.id}
            emptyTitle="No discounts found"
            emptyDescription="Create your first promotional discount code."
          />
        </div>
      </PageSection>

      {/* Create Discount Modal */}
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-50 p-6 shadow-xl border border-surface-200 space-y-4">
            <h3 className="text-lg font-bold text-foreground">Create New Discount</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground-muted">Discount Code (Leave empty for automatic)</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SUMMER50"
                  className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm uppercase font-mono bg-surface-100"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground-muted">Title / Description</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Summer Flat 20% Off"
                  className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm bg-surface-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-muted">Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as DiscountRow["type"])}
                    className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm bg-surface-100"
                  >
                    <option value="percent">Percentage Off</option>
                    <option value="fixed">Fixed Amount (₹)</option>
                    <option value="free_shipping">Free Shipping</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground-muted">Value ({type === "percent" ? "%" : "₹"})</label>
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                    disabled={type === "free_shipping"}
                    className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm bg-surface-100 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground-muted">Usage Limit (Leave blank for unlimited)</label>
                <input
                  type="number"
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                  placeholder="e.g. 100"
                  className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm bg-surface-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="default" size="sm" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShowModal(false);
                }}
              >
                Save Discount
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
