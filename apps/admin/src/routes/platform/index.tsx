import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { EmptyState, PageBreadcrumbs, PageContainer, PageHeader, PageSection, PageSkeleton } from "@bs/ui";

export const Route = createFileRoute("/platform/")({
  pendingComponent: () => <PageSkeleton />,
  component: PlatformOverview,
});

function PlatformOverview() {
  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Platform" }, { label: "Overview" }]} />
      <PageHeader title="Overview" description="Active stores, signups, GMV and system health." />
      <PageSection>
        <EmptyState icon={Building2} title="No stores yet" description="Tenants arrive in M1." />
      </PageSection>
    </PageContainer>
  );
}
