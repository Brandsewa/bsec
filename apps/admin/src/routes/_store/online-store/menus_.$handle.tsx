import { createFileRoute } from "@tanstack/react-router";
import { DetailSkeleton, PageSkeleton } from "@bs/ui";
import { MenuEditorScreen } from "@bs/content-admin/menus/MenuEditorScreen.tsx";

export const Route = createFileRoute("/_store/online-store/menus_/$handle")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditMenuRoute,
});

function EditMenuRoute() {
  const { handle } = Route.useParams();
  return <MenuEditorScreen handle={handle} />;
}
