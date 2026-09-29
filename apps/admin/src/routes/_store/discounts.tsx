import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Percent, Plus, Tag, Trash2, Power } from "lucide-react";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../../lib/orpc.ts";

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

export function DiscountsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"percent" | "fixed" | "free_shipping" | "buy_x_get_y">("percent");
  const [value, setValue] = useState(10);
  const [usageLimit, setUsageLimit] = useState<string>("100");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // oRPC Queries
  const { data, isLoading } = useQuery(
    orpc.admin.discounts.list.queryOptions({
      input: {
        search: search.trim() ? search.trim() : undefined,
      },
    }),
  );

  // Mutations
  const createMutation = useMutation(
    orpc.admin.discounts.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.list.key() });
        setShowModal(false);
        setCode("");
        setTitle("");
        setValue(10);
        setUsageLimit("100");
        setActionError(null);
      },
      onError: (err: Error) => {
        setActionError(err.message || "Failed to create discount");
      },
    }),
  );

  const updateMutation = useMutation(
    orpc.admin.discounts.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.list.key() });
      },
      onError: (err: Error) => {
        setActionError(err.message || "Failed to update discount");
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.discounts.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.list.key() });
      },
      onError: (err: Error) => {
        setActionError(err.message || "Failed to delete discount");
      },
    }),
  );

  const discountsList = data?.items ?? [];
  const totalCount = data?.total ?? discountsList.length;

  type DiscountRow = (typeof discountsList)[number];

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
      cell: (d) => {
        const badgeColors: Record<string, string> = {
          active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          scheduled: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          expired: "bg-surface-200 text-foreground-muted",
          disabled: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[d.status] ?? "bg-surface-200"}`}>
            {d.status}
          </span>
        );
      },
    },
    {
      header: "Actions",
      className: "text-right",
      headerClassName: "text-right",
      cell: (d) => (
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            title={d.status === "active" ? "Disable discount" : "Enable discount"}
            className="text-foreground-muted hover:text-foreground p-1"
            onClick={() =>
              updateMutation.mutate({
                id: d.id,
                status: d.status === "active" ? "disabled" : "active",
              })
            }
          >
            <Power className="size-3.5" />
          </button>
          <button
            type="button"
            title="Delete discount"
            className="text-foreground-muted hover:text-rose-600 p-1"
            onClick={() => deleteMutation.mutate({ id: d.id })}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ),
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

      {actionError && (
        <div className="rounded-md bg-rose-500/10 p-3 text-xs text-rose-600">
          {actionError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Active Discounts" value={discountsList.filter((d) => d.status === "active").length} icon={Tag} />
        <MetricCard
          label="Total Redemptions"
          value={discountsList.reduce((acc, d) => acc + d.usedCount, 0)}
          icon={Percent}
        />
        <MetricCard
          label="Total Vouchers"
          value={totalCount}
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

          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={discountsList}
              columns={columns}
              keyExtractor={(d) => d.id}
              emptyTitle="No discounts found"
              emptyDescription="Create your first promotional discount code."
            />
          )}
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
                    onChange={(e) => setType(e.target.value as "percent" | "fixed" | "free_shipping" | "buy_x_get_y")}
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
                disabled={!title || createMutation.isPending}
                onClick={() => {
                  createMutation.mutate({
                    code: code ? code : undefined,
                    title,
                    type,
                    value: type === "fixed" ? value * 100 : value,
                    usageLimit: usageLimit ? Number(usageLimit) : undefined,
                    combinable: false,
                  });
                }}
              >
                {createMutation.isPending ? "Saving..." : "Save Discount"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
export default DiscountsPage;
