import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";

/** Legacy /settings/team route redirects to /settings/users (Phase 2, SETTINGS-REBUILD-REMAINING-PHASES.md §3). */
export const Route = createFileRoute("/_store/settings/team")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/users", replace: true });
  },
  pendingComponent: () => <PageSkeleton />,
  component: () => null,
});
