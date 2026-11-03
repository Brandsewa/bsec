import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { PoliciesScreen } from "@bs/content-admin/settings/PoliciesScreen.tsx";

export const Route = createFileRoute("/_store/settings/policies")({
  pendingComponent: () => <PageSkeleton />,
  component: PoliciesSettingsPage,
});

export function PoliciesSettingsPage() {
  return <PoliciesScreen />;
}
