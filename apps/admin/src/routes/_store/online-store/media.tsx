import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton, TableSkeleton } from "@bs/ui";
import { MediaScreen, validateMediaSearch } from "@bs/content-admin/media/MediaScreen.tsx";

export const Route = createFileRoute("/_store/online-store/media")({
  validateSearch: validateMediaSearch,
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={8} columns={5} />
    </PageSkeleton>
  ),
  component: MediaLibraryPage,
});

export function MediaLibraryPage() {
  return <MediaScreen search={Route.useSearch()} />;
}
