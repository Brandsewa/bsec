import { createFileRoute } from "@tanstack/react-router";
import { MenusLoading, MenusScreen } from "@bs/content-admin/menus/MenusScreen.tsx";

export const Route = createFileRoute("/_store/online-store/menus")({
  pendingComponent: MenusLoading,
  component: MenusScreen,
});
