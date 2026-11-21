import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton, TableSkeleton } from "@bs/ui";
import { TaxonomyBulkEditor } from "../../components/data-grid/taxonomy-bulk-editor.tsx";

export const Route = createFileRoute("/_store/collections_/bulk-edit")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  ),
  component: () => <TaxonomyBulkEditor kind="collections" />,
});
