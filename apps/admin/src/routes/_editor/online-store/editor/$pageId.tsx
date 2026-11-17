import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";

// The editor (Puck) is a large bundle: load it only when someone opens this route.
const PageVisualEditor = lazy(() => import("../../../../components/page-editor/PageVisualEditor.tsx"));

export const Route = createFileRoute("/_editor/online-store/editor/$pageId")({
  pendingComponent: () => <PageSkeleton />,
  component: EditorRoute,
});

function EditorRoute() {
  const { pageId } = Route.useParams();
  const { store } = Route.useRouteContext();
  const canPublish = store?.permissions.includes("theme.publish") ?? false;
  return (
    <Suspense fallback={<PageSkeleton />}>
      {/* key: the route component survives a page switch, and the editor copies its blocks once on mount. Without a fresh
          instance per page it kept the previous page's blocks and saved them into the new page (Header and Home were overwritten). */}
      <PageVisualEditor key={pageId} pageId={pageId} canPublish={canPublish} storeName={store?.name} />
    </Suspense>
  );
}
