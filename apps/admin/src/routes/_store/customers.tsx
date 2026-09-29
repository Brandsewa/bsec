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

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  ordersCount: number;
  totalSpentPaise: number;
  tags: string[];
  status: "active" | "disabled";
  createdAt: string;
}

const mockCustomers: CustomerRow[] = [
  {
    id: "0199a000-0000-7000-8000-000000000201",
    name: "Rahul Sharma",
    email: "rahul.sharma@example.com",
    phone: "+919876543210",
    ordersCount: 4,
    totalSpentPaise: 1845000,
    tags: ["vip", "repeat"],
    status: "active",
    createdAt: "2026-08-15T12:00:00.000Z",
  },
  {
    id: "0199a000-0000-7000-8000-000000000202",
    name: "Priya Patel",
    email: "priya.patel@example.com",
    phone: "+919811223344",
    ordersCount: 1,
    totalSpentPaise: 125000,
    tags: ["new"],
    status: "active",
    createdAt: "2026-09-20T14:30:00.000Z",
  },
];

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

function CustomersPage() {
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);

  const filteredCustomers = mockCustomers.filter((c) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

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
          ₹{(c.totalSpentPaise / 100).toLocaleString("en-IN")}
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
        <MetricCard label="Total Customers" value={mockCustomers.length} icon={Users} />
        <MetricCard
          label="Repeat Customers"
          value={mockCustomers.filter((c) => c.ordersCount > 1).length}
          icon={UserCheck}
        />
        <MetricCard
          label="Total Customer Spend"
          value={`₹${(mockCustomers.reduce((acc, c) => acc + c.totalSpentPaise, 0) / 100).toLocaleString("en-IN")}`}
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

          <DataTable
            data={filteredCustomers}
            columns={columns}
            keyExtractor={(c) => c.id}
            onRowClick={(c) => setSelectedCustomer(c)}
            emptyTitle="No customers found"
            emptyDescription="Try adjusting your search criteria."
          />
        </div>
      </PageSection>

      {/* Customer Detail Drawer */}
      {selectedCustomer ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface-50 p-6 shadow-2xl border-l border-surface-200 animate-in slide-in-from-right">
          <div className="flex items-center justify-between border-b border-surface-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{selectedCustomer.name}</h2>
              <p className="text-xs text-foreground-muted">Member since {new Date(selectedCustomer.createdAt).toLocaleDateString()}</p>
            </div>
            <Button variant="default" size="sm" onClick={() => setSelectedCustomer(null)}>
              Close
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            <div className="rounded-lg border border-surface-200 p-4 bg-surface-100 space-y-2">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Mail className="size-4 text-foreground-muted" />
                <span>{selectedCustomer.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Phone className="size-4 text-foreground-muted" />
                <span>{selectedCustomer.phone}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Purchase Summary</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-surface-200 p-3 bg-surface-50">
                  <p className="text-xs text-foreground-muted">Total Orders</p>
                  <p className="text-lg font-bold text-foreground">{selectedCustomer.ordersCount}</p>
                </div>
                <div className="rounded-md border border-surface-200 p-3 bg-surface-50">
                  <p className="text-xs text-foreground-muted">Lifetime Value</p>
                  <p className="text-lg font-bold text-foreground">₹{(selectedCustomer.totalSpentPaise / 100).toLocaleString("en-IN")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
