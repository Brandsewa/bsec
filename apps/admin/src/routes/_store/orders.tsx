import { createFileRoute } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import {
  Button,
  EmptyState,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
} from "@bs/ui";

/**
 * Canonical list-page template: breadcrumbs → header → section, TableSkeleton while loading.
 * The loader simulates latency so the skeleton path is exercised until the orders API exists (M5).
 */
export const Route = createFileRoute("/_store/orders")({
  loader: () => new Promise<{ orders: never[] }>((resolve) => setTimeout(() => resolve({ orders: [] }), 400)),
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={10} columns={5} />
    </PageSkeleton>
  ),
  component: OrdersPage,
});

function OrdersPage() {
  const { orders } = Route.useLoaderData();
  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Orders" }]} actions={<Button variant="primary">Create order</Button>} />
      <PageHeader title="Orders" description="Orders to ship, COD to confirm and returns." />
      <PageSection>
        {orders.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No orders yet" description="New orders will show up here as soon as customers check out." />
        ) : null}
      </PageSection>
    </PageContainer>
  );
}
