import React, { Suspense, lazy } from "react";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import {
  AuthCardSkeleton,
  DataTableSkeleton,
  DetailPageSkeleton,
  FormSectionSkeleton,
  MetricCardsSkeleton,
  PageContainer,
  PageHeaderSkeleton,
  PageSkeleton,
  Toaster,
  UiLinkProvider,
} from "@bs/ui";
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
import { StorageSettings } from "./pages/StorageSettings.tsx";
import { ForgotPassword } from "./pages/ForgotPassword.tsx";
import { ResetPassword } from "./pages/ResetPassword.tsx";
import { Kit } from "./pages/Kit.tsx";

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
  pendingComponent: () => <AuthCardSkeleton />,
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
  pendingComponent: () => <AuthCardSkeleton />,
  component: AcceptInvitation,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  pendingComponent: () => <AuthCardSkeleton />,
  component: ForgotPassword,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  pendingComponent: () => <AuthCardSkeleton />,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: function ResetPasswordComponent() {
    const { token } = resetPasswordRoute.useSearch();
    return <ResetPassword token={token} />;
  },
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
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={4} className="mb-6" />
      <MetricCardsSkeleton count={4} className="mb-8" />
    </PageContainer>
  ),
});

const tenantsListRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/tenants",
  component: TenantsList,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={6} rows={8} />
    </PageContainer>
  ),
});

const tenantCreateRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/tenants/create",
  component: TenantCreate,
  pendingComponent: () => (
    <PageContainer size="small">
      <PageHeaderSkeleton />
      <FormSectionSkeleton fields={5} />
    </PageContainer>
  ),
});

const tenantDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/tenants/$id",
  component: TenantDetail,
  pendingComponent: () => (
    <PageContainer>
      <DetailPageSkeleton />
    </PageContainer>
  ),
});

const domainsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/domains",
  component: Domains,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={6} />
    </PageContainer>
  ),
});

const plansRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/plans",
  component: Plans,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={4} />
    </PageContainer>
  ),
});

const signupsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/signups",
  component: Signups,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={6} />
    </PageContainer>
  ),
});

const templatesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/templates",
  component: Templates,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={5} />
    </PageContainer>
  ),
});

const supportRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/support",
  component: Support,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={4} />
    </PageContainer>
  ),
});

const systemRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/system",
  component: System,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={6} />
    </PageContainer>
  ),
});

const quotasRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/quotas",
  component: Quotas,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={4} />
    </PageContainer>
  ),
});

const featuresRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/features",
  component: Features,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={6} />
    </PageContainer>
  ),
});

const staffRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/staff",
  component: Staff,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={5} />
    </PageContainer>
  ),
});

const auditRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/audit",
  component: AuditLog,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={10} />
    </PageContainer>
  ),
});

const emailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/email",
  component: EmailSettings,
  pendingComponent: () => (
    <PageContainer size="small">
      <PageHeaderSkeleton />
      <FormSectionSkeleton fields={4} />
    </PageContainer>
  ),
});

const storageRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storage",
  component: StorageSettings,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={4} />
    </PageContainer>
  ),
});

const integrationsStorageRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/storage",
  beforeLoad: () => {
    throw redirect({ to: "/storage" });
  },
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={5} rows={4} />
    </PageContainer>
  ),
});

const kitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/__kit",
  component: Kit,
  pendingComponent: () => <PageSkeleton />,
});

const baseRoutes = [
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  templateEditorRoute,
  acceptInvitationRoute,
  ...(import.meta.env.DEV ? [kitRoute] : []),
];

export const routeTree = rootRoute.addChildren([
  ...baseRoutes,
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
    storageRoute,
    integrationsStorageRoute,
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
