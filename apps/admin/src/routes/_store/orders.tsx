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

interface OrderRow {
  id: string;
  number: string;
  customerEmail: string;
  customerPhone: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  fulfillmentStatus: "unfulfilled" | "fulfilled" | "delivered" | "rto";
  grandTotalPaise: number;
  itemsCount: number;
  placedAt: string;
}

const mockOrders: OrderRow[] = [
  {
    id: "0199a000-0000-7000-8000-000000000101",
    number: "ORD-2026-0001",
    customerEmail: "rahul.sharma@example.com",
    customerPhone: "+919876543210",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    grandTotalPaise: 499900,
    itemsCount: 2,
    placedAt: "2026-09-29T10:15:00.000Z",
  },
  {
    id: "0199a000-0000-7000-8000-000000000102",
    number: "ORD-2026-0002",
    customerEmail: "priya.patel@example.com",
    customerPhone: "+919811223344",
    status: "pending",
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    grandTotalPaise: 125000,
    itemsCount: 1,
    placedAt: "2026-09-29T11:00:00.000Z",
  },
  {
    id: "0199a000-0000-7000-8000-000000000103",
    number: "ORD-2026-0003",
    customerEmail: "amit.kumar@example.com",
    customerPhone: "+919988776655",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    grandTotalPaise: 890000,
    itemsCount: 3,
    placedAt: "2026-09-28T16:30:00.000Z",
  },
  {
    id: "0199a000-0000-7000-8000-000000000104",
    number: "ORD-2026-0004",
    customerEmail: "neha.singh@example.com",
    customerPhone: "+919123456780",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "rto",
    grandTotalPaise: 249900,
    itemsCount: 1,
    placedAt: "2026-09-27T09:45:00.000Z",
  },
];

type SavedView = "all" | "unfulfilled" | "unpaid" | "cod_to_confirm" | "rto";

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

function OrdersPage() {
  const [activeView, setActiveView] = useState<SavedView>("all");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftSuccess, setDraftSuccess] = useState<string | null>(null);

  // Filter orders based on active tab and search
  const filteredOrders = mockOrders.filter((o) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        o.number.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q) ||
        o.customerPhone.toLowerCase().includes(q);
      if (!match) return false;
    }

    if (activeView === "unfulfilled") return o.fulfillmentStatus === "unfulfilled";
    if (activeView === "unpaid") return o.paymentStatus === "pending";
    if (activeView === "cod_to_confirm") return o.status === "pending" && o.paymentStatus === "pending";
    if (activeView === "rto") return o.fulfillmentStatus === "rto";
    return true;
  });

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
        const badgeColors = {
          paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
          refunded: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[o.paymentStatus]}`}>
            {o.paymentStatus}
          </span>
        );
      },
    },
    {
      header: "Fulfillment",
      cell: (o) => {
        const badgeColors = {
          fulfilled: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          delivered: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          unfulfilled: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          rto: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        };
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColors[o.fulfillmentStatus]}`}>
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
        <span className="font-medium text-foreground">₹{(o.grandTotalPaise / 100).toLocaleString("en-IN")}</span>
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
        <MetricCard label="Total Orders" value={mockOrders.length} icon={ShoppingBag} />
        <MetricCard
          label="Unfulfilled"
          value={mockOrders.filter((o) => o.fulfillmentStatus === "unfulfilled").length}
          icon={Package}
        />
        <MetricCard
          label="Unpaid / COD"
          value={mockOrders.filter((o) => o.paymentStatus === "pending").length}
          icon={Clock}
        />
        <MetricCard
          label="RTO / Returns"
          value={mockOrders.filter((o) => o.fulfillmentStatus === "rto").length}
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

          <DataTable
            data={filteredOrders}
            columns={columns}
            keyExtractor={(o) => o.id}
            onRowClick={(o) => setSelectedOrder(o)}
            emptyTitle="No orders in this view"
            emptyDescription="Try selecting another tab or clearing search filters."
          />
        </div>
      </PageSection>

      {/* Order Detail Drawer */}
      {selectedOrder ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-surface-50 p-6 shadow-2xl border-l border-surface-200 animate-in slide-in-from-right">
          <div className="flex items-center justify-between border-b border-surface-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{selectedOrder.number}</h2>
              <p className="text-xs text-foreground-muted">Placed on {new Date(selectedOrder.placedAt).toLocaleString()}</p>
            </div>
            <Button variant="default" size="sm" onClick={() => setSelectedOrder(null)}>
              Close
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            {/* Status overview */}
            <div className="rounded-lg border border-surface-200 p-4 bg-surface-100 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Payment Status:</span>
                <span className="text-xs font-semibold uppercase">{selectedOrder.paymentStatus}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Fulfillment Status:</span>
                <span className="text-xs font-semibold uppercase">{selectedOrder.fulfillmentStatus}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Grand Total:</span>
                <span className="text-base font-bold text-foreground">₹{(selectedOrder.grandTotalPaise / 100).toLocaleString("en-IN")}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" size="sm" className="w-full">
                  <Truck className="mr-1.5 size-3.5" /> Fulfill (Shiprocket)
                </Button>
                <Button variant="default" size="sm" className="w-full">
                  <FileText className="mr-1.5 size-3.5" /> GST Invoice
                </Button>
                <Button variant="default" size="sm" className="w-full">
                  <RotateCcw className="mr-1.5 size-3.5" /> Process Return
                </Button>
                <Button variant="destructive" size="sm" className="w-full">
                  <XCircle className="mr-1.5 size-3.5" /> Cancel Order
                </Button>
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Timeline</h3>
              <div className="border-l-2 border-surface-200 ml-2 pl-4 space-y-4 text-xs">
                <div>
                  <p className="font-semibold text-foreground">Order placed by customer</p>
                  <p className="text-foreground-muted">{new Date(selectedOrder.placedAt).toLocaleTimeString()}</p>
                </div>
                {selectedOrder.paymentStatus === "paid" && (
                  <div>
                    <p className="font-semibold text-emerald-600">Payment captured via Razorpay</p>
                    <p className="text-foreground-muted">Verified webhook HMAC signature</p>
                  </div>
                )}
                {selectedOrder.fulfillmentStatus === "fulfilled" && (
                  <div>
                    <p className="font-semibold text-blue-600">Shipment dispatched via Shiprocket</p>
                    <p className="text-foreground-muted">AWB generated, label ready</p>
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
              <Button variant="default" size="sm" onClick={() => { setShowDraftModal(false); setDraftSuccess(null); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setDraftSuccess("Draft order ORD-2026-D001 generated with pay link!");
                  setTimeout(() => {
                    setShowDraftModal(false);
                    setDraftSuccess(null);
                  }, 1500);
                }}
              >
                Create Order
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
