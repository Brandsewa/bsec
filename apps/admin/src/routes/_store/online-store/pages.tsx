import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton, TableSkeleton } from "@bs/ui";
import { PagesScreen } from "@bs/content-admin/pages/PagesScreen.tsx";

export const Route = createFileRoute("/_store/online-store/pages")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={6} columns={5} />
    </PageSkeleton>
  ),
  component: PagesPage,
});

export function PagesPage() {
  return <PagesScreen />;
}
