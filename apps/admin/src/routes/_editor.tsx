import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { fetchMe } from "../lib/auth.ts";
import { getActiveStoreId, setActiveStoreId } from "../lib/session.ts";

/**
 * Full-screen shell for the visual editor: same auth and store selection as the admin shell
 * (_store), but without the sidebar so the canvas gets the whole window.
 */
export const Route = createFileRoute("/_editor")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
    if (!me) throw redirect({ to: "/login" });
    const saved = getActiveStoreId();
    const store = me.stores.find((s) => s.tenantId === saved) ?? me.stores[0] ?? null;
    if (store) setActiveStoreId(store.tenantId);
    return { me, store };
  },
  pendingComponent: () => <PageSkeleton />,
  component: () => <Outlet />,
});
