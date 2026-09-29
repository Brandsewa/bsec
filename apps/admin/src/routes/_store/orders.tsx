import { createFileRoute } from "@tanstack/react-router";
import {
  Clock,
  Download,
  FileText,
  Package,
  Plus,
  RotateCcw,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";
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

type SavedView = "all" | "unfulfilled" | "unpaid" | "cod_to_confirm" | "rto";

function useOrderViewCount(view: SavedView): number {
  return useQuery(orpc.admin.orders.list.queryOptions({ input: { view, limit: 1 } })).data?.total ?? 0;
}

export const Route = createFileRoute("/_store/orders")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: OrdersPage,
});

export function OrdersPage() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<SavedView>("all");
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftSuccess, setDraftSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // oRPC Queries
  const { data, isLoading } = useQuery(
    orpc.admin.orders.list.queryOptions({
      input: {
        view: activeView,
        search: search.trim() ? search.trim() : undefined,
      },
    }),
  );

  const { data: orderDetail } = useQuery(
    orpc.admin.orders.get.queryOptions({
      input: { id: selectedOrderId ?? "" },
      enabled: Boolean(selectedOrderId),
    }),
  );

  // Mutations
  const createDraftMutation = useMutation(
    orpc.admin.orders.createDraft.mutationOptions({
      onSuccess: (res) => {
        setDraftSuccess(`Draft order ${res.orderNumber} created successfully!`);
        queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
        setTimeout(() => {
          setShowDraftModal(false);
          setDraftSuccess(null);
          setDraftEmail("");
          setDraftPhone("");
        }, 1500);
      },
      onError: (err: Error) => {
        setActionError(err.message || "Failed to create draft order");
      },
    }),
  );

  const fulfillMutation = useMutation(
    orpc.admin.orders.createFulfillment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
        if (selectedOrderId) {
          queryClient.invalidateQueries({ queryKey: orpc.admin.orders.get.key({ input: { id: selectedOrderId } }) });
        }
      },
      onError: (err: Error) => {
        setActionError(err.message || "Fulfillment failed");
      },
    }),
  );

  const invoiceMutation = useMutation(
    orpc.admin.orders.createInvoice.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
        if (selectedOrderId) {
          queryClient.invalidateQueries({ queryKey: orpc.admin.orders.get.key({ input: { id: selectedOrderId } }) });
        }
      },
      onError: (err: Error) => {
        setActionError(err.message || "Invoice generation failed");
      },
    }),
  );

  const cancelMutation = useMutation(
    orpc.admin.orders.cancel.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
        if (selectedOrderId) {
          queryClient.invalidateQueries({ queryKey: orpc.admin.orders.get.key({ input: { id: selectedOrderId } }) });
        }
      },
      onError: (err: Error) => {
        setActionError(err.message || "Order cancellation failed");
      },
    }),
  );

  const ordersList = data?.items ?? [];

  // Card counts come from the server for each saved view, independent of the tab that is open.
  const allCount = useOrderViewCount("all");
  const unfulfilledCount = useOrderViewCount("unfulfilled");
  const unpaidCount = useOrderViewCount("unpaid");
  const rtoCount = useOrderViewCount("rto");

  type OrderRow = (typeof ordersList)[number];

  const columns: ColumnDef<OrderRow>[] = [
    {
      header: "Order",
      cell: (o) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{o.number}</span>
          <span className="text-xs text-foreground-lighter">{new Date(o.placedAt).toLocaleDateString()}</span>
        </div>
      ),
    },
    {
      header: "Customer",
      cell: (o) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{o.customerEmail}</span>
          <span className="text-xs text-foreground-muted">{o.customerPhone}</span>
        </div>
      ),
    },
    {
      header: "Payment",
      cell: (o) => {
        const badgeColors: Record<string, string> = {
          paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
          refunded: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[o.paymentStatus] ?? "bg-surface-200 text-foreground-muted"}`}>
            {o.paymentStatus}
          </span>
        );
      },
    },
    {
      header: "Fulfillment",
      cell: (o) => {
        const badgeColors: Record<string, string> = {
          fulfilled: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          delivered: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          unfulfilled: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          rto: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[o.fulfillmentStatus] ?? "bg-surface-200 text-foreground-muted"}`}>
            {o.fulfillmentStatus}
          </span>
        );
      },
    },
    {
      header: "Items",
      cell: (o) => <span className="text-sm text-foreground-muted">{o.itemsCount} items</span>,
    },
    {
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      cell: (o) => (
        <span className="font-medium text-foreground">₹{(o.grandTotal / 100).toLocaleString("en-IN")}</span>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Orders" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm">
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowDraftModal(true)}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Create draft order
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Orders"
        description="Fulfill orders, track shipments, print GST tax invoices, process returns and refunds."
      />

      {/* Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCard label="Total Orders" value={allCount} icon={ShoppingBag} />
        <MetricCard
          label="Unfulfilled"
          value={unfulfilledCount}
          icon={Package}
        />
        <MetricCard
          label="Unpaid / COD"
          value={unpaidCount}
          icon={Clock}
        />
        <MetricCard
          label="RTO / Returns"
          value={rtoCount}
          icon={RotateCcw}
        />
      </div>

      {/* Saved View Tabs */}
      <div className="flex items-center gap-2 border-b border-surface-200 pb-2 text-sm font-medium">
        {(
          [
            { id: "all", label: "All orders" },
            { id: "unfulfilled", label: "Unfulfilled" },
            { id: "unpaid", label: "Unpaid" },
            { id: "cod_to_confirm", label: "COD to confirm" },
            { id: "rto", label: "RTO / Returns" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveView(tab.id)}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              activeView === tab.id
                ? "bg-surface-200 font-semibold text-foreground"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by order #, email, phone..."
            hasActiveFilters={activeView !== "all" || search.length > 0}
            onReset={() => {
              setSearch("");
              setActiveView("all");
            }}
          />

          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={ordersList}
              columns={columns}
              keyExtractor={(o) => o.id}
              onRowClick={(o) => {
                setSelectedOrderId(o.id);
                setActionError(null);
              }}
              emptyTitle="No orders in this view"
              emptyDescription="Try selecting another tab or clearing search filters."
            />
          )}
        </div>
      </PageSection>

      {/* Order Detail Drawer */}
      {selectedOrderId && orderDetail ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-surface-50 p-6 shadow-2xl border-l border-surface-200 animate-in slide-in-from-right">
          <div className="flex items-center justify-between border-b border-surface-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{orderDetail.order.number}</h2>
              <p className="text-xs text-foreground-muted">Placed on {new Date(orderDetail.order.placedAt).toLocaleString()}</p>
            </div>
            <Button variant="default" size="sm" onClick={() => setSelectedOrderId(null)}>
              Close
            </Button>
          </div>

          {actionError && (
            <div className="mt-3 rounded-md bg-rose-500/10 p-3 text-xs text-rose-600">
              {actionError}
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            {/* Status overview */}
            <div className="rounded-lg border border-surface-200 p-4 bg-surface-100 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Payment Status:</span>
                <span className="text-xs font-semibold uppercase">{orderDetail.order.paymentStatus}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Fulfillment Status:</span>
                <span className="text-xs font-semibold uppercase">{orderDetail.order.fulfillmentStatus}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Grand Total:</span>
                <span className="text-base font-bold text-foreground">₹{(orderDetail.order.grandTotal / 100).toLocaleString("en-IN")}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={orderDetail.order.fulfillmentStatus === "delivered" || orderDetail.order.status === "cancelled"}
                  onClick={() => fulfillMutation.mutate({ id: selectedOrderId })}
                >
                  <Truck className="mr-1.5 size-3.5" /> Fulfill (Shiprocket)
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => invoiceMutation.mutate({ id: selectedOrderId })}
                >
                  <FileText className="mr-1.5 size-3.5" /> GST Invoice
                </Button>
                <Button variant="default" size="sm" className="w-full">
                  <RotateCcw className="mr-1.5 size-3.5" /> Process Return
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  disabled={orderDetail.order.status === "cancelled"}
                  onClick={() => cancelMutation.mutate({ id: selectedOrderId, reason: "Cancelled by store staff" })}
                >
                  <XCircle className="mr-1.5 size-3.5" /> Cancel Order
                </Button>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Items</h3>
              <div className="rounded-lg border border-surface-200 divide-y divide-surface-200">
                {orderDetail.items.map((it) => (
                  <div key={it.id} className="p-3 text-xs flex justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{it.productTitle}</p>
                      <p className="text-foreground-muted">{it.variantTitle ?? it.sku ?? "Default"}</p>
                      <p className="text-foreground-muted">Qty: {it.quantity}</p>
                    </div>
                    <span className="font-medium text-foreground">₹{(it.total / 100).toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Timeline</h3>
              <div className="border-l-2 border-surface-200 ml-2 pl-4 space-y-4 text-xs">
                {orderDetail.events.length > 0 ? (
                  orderDetail.events.map((ev) => (
                    <div key={ev.id}>
                      <p className="font-semibold text-foreground">{ev.message}</p>
                      <p className="text-foreground-muted">{new Date(ev.createdAt).toLocaleString()} · {ev.actorType}</p>
                    </div>
                  ))
                ) : (
                  <div>
                    <p className="font-semibold text-foreground">Order placed</p>
                    <p className="text-foreground-muted">{new Date(orderDetail.order.placedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create Draft Order Modal */}
      {showDraftModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-50 p-6 shadow-xl border border-surface-200 space-y-4">
            <h3 className="text-lg font-bold text-foreground">Create Draft Order</h3>
            <p className="text-xs text-foreground-muted">Generate an invoice link or customer pay link without requiring upfront storefront checkout.</p>

            {draftSuccess ? (
              <div className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-700">
                {draftSuccess}
              </div>
            ) : null}

            {actionError ? (
              <div className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-700">
                {actionError}
              </div>
            ) : null}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground-muted">Customer Email</label>
                <input
                  type="email"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm bg-surface-100"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground-muted">Phone Number</label>
                <input
                  type="tel"
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                  placeholder="+919876543210"
                  className="w-full rounded-md border border-surface-200 px-3 py-1.5 text-sm bg-surface-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="default" size="sm" onClick={() => { setShowDraftModal(false); setDraftSuccess(null); setActionError(null); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!draftEmail || !draftPhone || createDraftMutation.isPending}
                onClick={() => {
                  setActionError(null);
                  createDraftMutation.mutate({
                    email: draftEmail,
                    phone: draftPhone,
                    shippingAddress: { name: "Direct Customer", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
                    items: [
                      {
                        variantId: "0199a000-0000-7000-8000-000000000501",
                        quantity: 1,
                      },
                    ],
                  });
                }}
              >
                {createDraftMutation.isPending ? "Creating..." : "Create Order"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
export default OrdersPage;
