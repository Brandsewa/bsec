import { createFileRoute } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import {
  EmptyState,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
} from "@bs/ui";

export const Route = createFileRoute("/_store/")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    </PageSkeleton>
  ),
  component: HomePage,
});

function HomePage() {
  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Home" }]} />
      <PageHeader title="Home" description="Today's sales, orders to ship and your setup checklist will live here." />
      <PageSection title="Setup checklist">
        <EmptyState icon={ListChecks} title="Nothing to set up yet" description="The setup checklist arrives with store onboarding (M8)." />
      </PageSection>
    </PageContainer>
  );
}
