import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";

/** Legacy /online-store/theme redirects to /online-store/theme-library (ADR-018, Phase 5). */
export const Route = createFileRoute("/_store/online-store/theme")({
  beforeLoad: () => {
    throw redirect({ to: "/online-store/theme-library", replace: true });
  },
  pendingComponent: () => <PageSkeleton />,
  component: () => null,
});
