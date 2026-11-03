import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { StorefrontSettingsScreen } from "@bs/content-admin/settings/StorefrontSettingsScreen.tsx";

export const Route = createFileRoute("/_store/settings/storefront")({
  pendingComponent: () => <PageSkeleton />,
  component: StorefrontSettingsPage,
});

export function StorefrontSettingsPage() {
  const routeCtx = useRouteContext({ strict: false }) as { store?: { role?: string } } | undefined;
  return <StorefrontSettingsScreen isOwner={routeCtx?.store?.role === "store_owner"} />;
}
