import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { SettingsLayout } from "../../components/settings/settings-layout.tsx";

export const Route = createFileRoute("/_store/settings")({
  pendingComponent: () => <PageSkeleton />,
  component: SettingsRoute,
});

function SettingsRoute() {
  const { store } = useRouteContext({ from: "/_store" });
  return <SettingsLayout permissions={store?.permissions ?? []} />;
}
