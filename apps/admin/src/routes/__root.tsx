import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { EmptyState, PageContainer, PageSkeleton, Toaster, UiLinkProvider } from "@bs/ui";
import { RouterLink } from "../lib/router-link.tsx";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  pendingComponent: () => <PageSkeleton />,
  component: Root,
  notFoundComponent: () => (
    <PageContainer size="small">
      <EmptyState icon={Compass} title="This page isn't built yet" description="It arrives in a later milestone." />
    </PageContainer>
  ),
});

function Root() {
  return (
    <UiLinkProvider component={RouterLink}>
      <Outlet />
      <Toaster />
    </UiLinkProvider>
  );
}
