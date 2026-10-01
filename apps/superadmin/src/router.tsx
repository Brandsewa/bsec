import React, { Suspense, lazy } from "react";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { PageSkeleton, Toaster, UiLinkProvider } from "@bs/ui";
import { RouterLink } from "./lib/router-link.tsx";
import { fetchPlatformMe, type PlatformUser } from "./lib/auth.ts";
import { Layout } from "./pages/Layout.tsx";
import { Login } from "./pages/Login.tsx";
import { AcceptInvitation } from "./pages/AcceptInvitation.tsx";
import { Overview } from "./pages/Overview.tsx";
import { TenantsList } from "./pages/TenantsList.tsx";
import { TenantCreate } from "./pages/TenantCreate.tsx";
import { TenantDetail } from "./pages/TenantDetail.tsx";
import { Domains } from "./pages/Domains.tsx";
import { Plans } from "./pages/Plans.tsx";
import { Signups } from "./pages/Signups.tsx";
import { Templates } from "./pages/Templates.tsx";
import { Support } from "./pages/Support.tsx";
import { System } from "./pages/System.tsx";
import { Quotas } from "./pages/Quotas.tsx";
import { Features } from "./pages/Features.tsx";
import { Staff } from "./pages/Staff.tsx";
import { AuditLog } from "./pages/AuditLog.tsx";
import { EmailSettings } from "./pages/EmailSettings.tsx";

export interface RouterContext {
  queryClient: QueryClient;
  user: PlatformUser | null;
  setUser: (u: PlatformUser | null) => void;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <UiLinkProvider component={RouterLink}>
      <Outlet />
      <Toaster />
    </UiLinkProvider>
  ),
  pendingComponent: () => <PageSkeleton />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: function LoginComponent() {
    const { setUser } = rootRoute.useRouteContext();
    return (
      <Login
        onSuccess={async () => {
          const me = await fetchPlatformMe();
          setUser(me);
          window.location.assign("/");
        }}
      />
    );
  },
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invitation",
  component: AcceptInvitation,
});

const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: function AuthLayoutComponent() {
    const { user, setUser } = rootRoute.useRouteContext();
    if (!user) return null;
    return <Layout user={user} onLogout={() => setUser(null)} />;
  },
});

// The visual editor (Puck) is large: load it only when a theme is opened. It renders outside the
// Layout shell so the canvas gets the whole window, with the same authentication guard.
const TemplateEditor = lazy(() => import("./pages/TemplateEditor.tsx"));
const templateEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/templates/$code/editor",
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({ to: "/login" });
    }
  },
  pendingComponent: () => <PageSkeleton />,
  component: function TemplateEditorRoute() {
    const { code } = templateEditorRoute.useParams();
    return (
      <Suspense fallback={<PageSkeleton />}>
        <TemplateEditor code={code} />
      </Suspense>
    );
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/",
  component: Overview,
});

const tenantsListRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/tenants",
  component: TenantsList,
});

const tenantCreateRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/tenants/create",
  component: TenantCreate,
});

const tenantDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/tenants/$id",
  component: TenantDetail,
});

const domainsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/domains",
  component: Domains,
});

const plansRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/plans",
  component: Plans,
});

const signupsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/signups",
  component: Signups,
});

const templatesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/templates",
  component: Templates,
});

const supportRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/support",
  component: Support,
});

const systemRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/system",
  component: System,
});

const quotasRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/quotas",
  component: Quotas,
});

const featuresRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/features",
  component: Features,
});

const staffRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/staff",
  component: Staff,
});

const auditRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/audit",
  component: AuditLog,
});

const emailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/email",
  component: EmailSettings,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  templateEditorRoute,
  acceptInvitationRoute,
  authLayoutRoute.addChildren([
    overviewRoute,
    tenantsListRoute,
    tenantCreateRoute,
    tenantDetailRoute,
    domainsRoute,
    plansRoute,
    signupsRoute,
    templatesRoute,
    supportRoute,
    systemRoute,
    quotasRoute,
    featuresRoute,
    staffRoute,
    auditRoute,
    emailRoute,
  ]),
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}
