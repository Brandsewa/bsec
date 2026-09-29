import { createFileRoute } from "@tanstack/react-router";
import { Download, Mail, Phone, UserCheck, Users } from "lucide-react";
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
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/customers")({
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
  component: CustomersPage,
});

export function CustomersPage() {
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // oRPC Queries
  const { data, isLoading } = useQuery(
    orpc.admin.customers.list.queryOptions({
      input: {
        search: search.trim() ? search.trim() : undefined,
      },
    }),
  );

  const { data: customerDetail } = useQuery(
    orpc.admin.customers.get.queryOptions({
      input: { id: selectedCustomerId ?? "" },
      enabled: Boolean(selectedCustomerId),
    }),
  );

  const customersList = data?.items ?? [];
  const totalCount = data?.total ?? customersList.length;

  type CustomerRow = (typeof customersList)[number];

  const columns: ColumnDef<CustomerRow>[] = [
    {
      header: "Customer",
      cell: (c) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{c.name || "Unnamed"}</span>
          <span className="text-xs text-foreground-lighter">{c.email}</span>
        </div>
      ),
    },
    {
      header: "Phone",
      cell: (c) => <span className="text-sm text-foreground-muted">{c.phone}</span>,
    },
    {
      header: "Orders",
      cell: (c) => (
        <span className="text-sm font-medium text-foreground">{c.ordersCount} orders</span>
      ),
    },
    {
      header: "Total Spent",
      className: "text-right",
      headerClassName: "text-right",
      cell: (c) => (
        <span className="font-medium text-foreground">
          ₹{(c.totalSpent / 100).toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      header: "Tags",
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <span
              key={t}
              className="inline-flex rounded-full bg-surface-200 px-2 py-0.5 text-xs text-foreground-muted"
            >
              {t}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Customers" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm">
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export CSV
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Customers"
        description="View customer profiles, order history, shipping addresses, and marketing preferences."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Customers" value={totalCount} icon={Users} />
        <MetricCard
          label="Repeat Customers"
          value={customersList.filter((c) => c.ordersCount > 1).length}
          icon={UserCheck}
        />
        <MetricCard
          label="Total Customer Spend"
          value={`₹${(customersList.reduce((acc, c) => acc + c.totalSpent, 0) / 100).toLocaleString("en-IN")}`}
        />
      </div>

      <PageSection>
        <div className="grid gap-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search customers by name, email, phone, or tag..."
            hasActiveFilters={search.length > 0}
            onReset={() => setSearch("")}
          />

          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={customersList}
              columns={columns}
              keyExtractor={(c) => c.id}
              onRowClick={(c) => setSelectedCustomerId(c.id)}
              emptyTitle="No customers found"
              emptyDescription="Try adjusting your search criteria."
            />
          )}
        </div>
      </PageSection>

      {/* Customer Detail Drawer */}
      {selectedCustomerId && customerDetail ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface-50 p-6 shadow-2xl border-l border-surface-200 animate-in slide-in-from-right">
          <div className="flex items-center justify-between border-b border-surface-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{customerDetail.customer.name}</h2>
              <p className="text-xs text-foreground-muted">Member since {new Date(customerDetail.customer.createdAt).toLocaleDateString()}</p>
            </div>
            <Button variant="default" size="sm" onClick={() => setSelectedCustomerId(null)}>
              Close
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            <div className="rounded-lg border border-surface-200 p-4 bg-surface-100 space-y-2">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Mail className="size-4 text-foreground-muted" />
                <span>{customerDetail.customer.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Phone className="size-4 text-foreground-muted" />
                <span>{customerDetail.customer.phone}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Purchase Summary</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-surface-200 p-3 bg-surface-50">
                  <p className="text-xs text-foreground-muted">Total Orders</p>
                  <p className="text-lg font-bold text-foreground">{customerDetail.customer.ordersCount}</p>
                </div>
                <div className="rounded-md border border-surface-200 p-3 bg-surface-50">
                  <p className="text-xs text-foreground-muted">Lifetime Value</p>
                  <p className="text-lg font-bold text-foreground">₹{(customerDetail.customer.totalSpent / 100).toLocaleString("en-IN")}</p>
                </div>
              </div>
            </div>

            {/* Addresses */}
            {customerDetail.addresses.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Saved Addresses</h3>
                <div className="space-y-2">
                  {customerDetail.addresses.map((addr) => (
                    <div key={addr.id} className="rounded-md border border-surface-200 p-3 text-xs bg-surface-100">
                      <p className="font-semibold text-foreground">{addr.name} ({addr.type})</p>
                      <p className="text-foreground-muted">{addr.line1}</p>
                      {addr.line2 && <p className="text-foreground-muted">{addr.line2}</p>}
                      <p className="text-foreground-muted">{addr.city}, {addr.stateCode} {addr.pincode}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Orders */}
            {customerDetail.recentOrders.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Recent Orders</h3>
                <div className="rounded-lg border border-surface-200 divide-y divide-surface-200">
                  {customerDetail.recentOrders.map((ord) => (
                    <div key={ord.id} className="p-3 text-xs flex justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{ord.number}</p>
                        <p className="text-foreground-muted">{new Date(ord.placedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-foreground">₹{(ord.grandTotal / 100).toLocaleString("en-IN")}</p>
                        <span className="text-xs text-foreground-muted uppercase">{ord.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
export default CustomersPage;
