import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";

/** Legacy /online-store/theme-settings redirects to /online-store/theme-library (Phase 5). */
export const Route = createFileRoute("/_editor/online-store/theme-settings")({
  beforeLoad: () => {
    throw redirect({ to: "/online-store/theme-library", replace: true });
  },
  pendingComponent: () => <PageSkeleton />,
  component: () => null,
});
