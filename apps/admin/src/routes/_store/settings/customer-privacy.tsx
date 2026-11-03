import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { CustomerPrivacyScreen } from "@bs/content-admin/settings/CustomerPrivacyScreen.tsx";

export const Route = createFileRoute("/_store/settings/customer-privacy")({
  pendingComponent: () => <PageSkeleton />,
  component: CustomerPrivacySettingsPage,
});

export function CustomerPrivacySettingsPage() {
  return <CustomerPrivacyScreen />;
}
