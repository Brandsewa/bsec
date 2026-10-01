import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, MapPin, Phone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton } from "@bs/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { StatusBadge, money } from "../../components/order-parts.tsx";

export const Route = createFileRoute("/_store/customers_/$customerId")({
  pendingComponent: () => <PageSkeleton />,
  component: CustomerDetailPage,
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const detail = useQuery(orpc.admin.customers.get.queryOptions({ input: { id: customerId } }));

  if (detail.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <PageContainer size="small">
        <PageBreadcrumbs items={[{ label: "Customers", href: "/customers" }, { label: "Customer" }]} />
        <EmptyState
          title="Could not load this customer"
          description={detail.error ? errorMessage(detail.error) : "They may have been removed."}
          action={<Button onClick={() => void detail.refetch()}>Try again</Button>}
        />
      </PageContainer>
    );
  }

  const { customer, addresses, recentOrders } = detail.data;
  const name = customer.name || "Unnamed customer";

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Customers", href: "/customers" }, { label: name }]} />
      <PageHeader
        title={name}
        description={`Customer since ${new Date(customer.createdAt).toLocaleDateString()}`}
        aside={
          <div className="flex flex-wrap items-center gap-1">
            {customer.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
            <Badge variant={customer.acceptsMarketing ? "default" : "outline"}>
              {customer.acceptsMarketing ? "Accepts marketing" : "No marketing"}
            </Badge>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent orders</CardTitle>
            </CardHeader>
            <CardContent>
              {recentOrders.length === 0 ? (
                <p className="text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {recentOrders.map((o) => (
                    <Link
                      key={o.id}
                      to="/orders/$orderId"
                      params={{ orderId: o.id }}
                      className="flex items-center justify-between gap-4 p-3 hover:bg-muted"
                    >
                      <div>
                        <p className="font-medium text-foreground">{o.number}</p>
                        <p className="text-muted-foreground">{new Date(o.placedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={o.status} />
                        <span className="font-medium text-foreground">{money(o.grandTotal)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved addresses</CardTitle>
            </CardHeader>
            <CardContent>
              {addresses.length === 0 ? (
                <p className="text-muted-foreground">No saved addresses.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {addresses.map((a) => (
                    <div key={a.id} className="rounded-md border border-border p-3">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                        {a.name}
                        <Badge variant="outline" className="ml-auto capitalize">
                          {a.isDefault ? `${a.type} · default` : a.type}
                        </Badge>
                      </p>
                      <address className="mt-1 text-muted-foreground not-italic">
                        <div>{a.line1}</div>
                        {a.line2 ? <div>{a.line2}</div> : null}
                        <div>
                          {a.city}, {a.stateCode} {a.pincode}
                        </div>
                        <div>{a.phone}</div>
                      </address>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p className="flex items-center gap-2 text-foreground">
                <Mail className="size-4 text-muted-foreground" aria-hidden />
                {customer.email}
              </p>
              <p className="flex items-center gap-2 text-foreground">
                <Phone className="size-4 text-muted-foreground" aria-hidden />
                {customer.phone}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Purchase summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Stat label="Orders" value={String(customer.ordersCount)} />
              <Stat label="Lifetime value" value={money(customer.totalSpent)} />
            </CardContent>
          </Card>

          {customer.note ? (
            <Card>
              <CardHeader>
                <CardTitle>Note</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-foreground">{customer.note}</p>
              </CardContent>
            </Card>
          ) : null}

          <Button variant="ghost" size="sm" className="justify-start" nativeButton={false} render={<Link to="/customers" />}>
            Back to customers
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
