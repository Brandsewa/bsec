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
import { Ledger } from "./pages/Ledger.tsx";
import { Promotions } from "./pages/Promotions.tsx";
import { Marketplace } from "./pages/Marketplace.tsx";
import { Signups } from "./pages/Signups.tsx";
import { Templates } from "./pages/Templates.tsx";
import { SettingsShell } from "./pages/Marketing.tsx";
import { BlogCategoriesScreen } from "@bs/content-admin/blog/BlogCategoriesScreen.tsx";
import { BlogPostsScreen, validateBlogListSearch } from "@bs/content-admin/blog/BlogPostsScreen.tsx";
import { PostForm } from "@bs/content-admin/blog/PostForm.tsx";
import { MenuEditorScreen } from "@bs/content-admin/menus/MenuEditorScreen.tsx";
import { MenusScreen } from "@bs/content-admin/menus/MenusScreen.tsx";
import { PagesScreen } from "@bs/content-admin/pages/PagesScreen.tsx";
import { StorefrontSettingsScreen } from "@bs/content-admin/settings/StorefrontSettingsScreen.tsx";
import { CustomerPrivacyScreen } from "@bs/content-admin/settings/CustomerPrivacyScreen.tsx";
import { MediaScreen, validateMediaSearch } from "@bs/content-admin/media/MediaScreen.tsx";
import { Support } from "./pages/Support.tsx";
import { System } from "./pages/System.tsx";
import { Quotas } from "./pages/Quotas.tsx";
import { Features } from "./pages/Features.tsx";
import { Staff } from "./pages/Staff.tsx";
import { AuditLog } from "./pages/AuditLog.tsx";
import { StorageSettings } from "./pages/StorageSettings.tsx";
import { NotificationManager } from "./pages/NotificationManager.tsx";
import { IntegrationsHub } from "./pages/integrations/IntegrationsHub.tsx";
import { NotificationsHub } from "./pages/integrations/NotificationsHub.tsx";
import { ChannelPage } from "./pages/integrations/ChannelPage.tsx";
import { PaymentsIntegrations } from "./pages/integrations/PaymentsIntegrations.tsx";
import { AuthHub } from "./pages/integrations/AuthHub.tsx";
import { BillingIntegrations } from "./pages/integrations/BillingIntegrations.tsx";
import { BillingGateway } from "./pages/integrations/BillingGateway.tsx";
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
const MarketingPageEditor = lazy(() => import("./pages/MarketingPageEditor.tsx"));
const marketingPageEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/storefront/pages/$id/editor",
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({ to: "/login" });
    }
  },
  pendingComponent: () => <PageSkeleton />,
  component: function MarketingPageEditorRoute() {
    const { id } = marketingPageEditorRoute.useParams();
    return (
      <Suspense fallback={<PageSkeleton />}>
        <MarketingPageEditor id={id} />
      </Suspense>
    );
  },
});

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

const ledgerRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/ledger",
  component: Ledger,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={4} />
    </PageContainer>
  ),
});

const marketplaceRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/marketplace",
  component: Marketplace,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={4} rows={4} />
    </PageContainer>
  ),
});

const promotionsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/promotions",
  component: Promotions,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={6} rows={4} />
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

const marketingRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/settings",
  beforeLoad: () => {
    throw redirect({ to: "/storefront/settings/visibility" });
  },
});

const marketingPending = () => (
  <PageContainer>
    <PageHeaderSkeleton />
    <DataTableSkeleton columns={4} rows={5} />
  </PageContainer>
);

const marketingPagesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/pages",
  component: PagesScreen,
  pendingComponent: marketingPending,
});

const settingsVisibilityRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/settings/visibility",
  component: function WebsiteVisibility() {
    return <SettingsShell><StorefrontSettingsScreen view="visibility" website /></SettingsShell>;
  },
  pendingComponent: marketingPending,
});

const settingsSearchRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/settings/search",
  component: function WebsiteSearch() {
    return <SettingsShell><StorefrontSettingsScreen view="search" website /></SettingsShell>;
  },
  pendingComponent: marketingPending,
});

const settingsPrivacyRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/settings/privacy",
  component: function WebsitePrivacy() {
    return <SettingsShell><CustomerPrivacyScreen /></SettingsShell>;
  },
  pendingComponent: marketingPending,
});

const marketingMediaRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/media",
  validateSearch: validateMediaSearch,
  component: function StorefrontMedia() {
    return <MediaScreen search={marketingMediaRoute.useSearch()} />;
  },
  pendingComponent: marketingPending,
});

// Older links: Marketing was renamed Storefront.
const marketingOldRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/marketing",
  beforeLoad: () => {
    throw redirect({ to: "/storefront/settings" });
  },
});

const storefrontIndexRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront",
  beforeLoad: () => {
    throw redirect({ to: "/storefront/pages" });
  },
});

const marketingNavigationRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/navigation",
  component: MenusScreen,
  pendingComponent: marketingPending,
});

const marketingMenuRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/navigation/$handle",
  component: function MarketingMenu() {
    return <MenuEditorScreen handle={marketingMenuRoute.useParams().handle} />;
  },
  pendingComponent: marketingPending,
});

const marketingBlogRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/blog",
  validateSearch: validateBlogListSearch,
  component: function MarketingBlog() {
    return <BlogPostsScreen search={marketingBlogRoute.useSearch()} />;
  },
  pendingComponent: marketingPending,
});

const marketingBlogCategoriesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/blog/categories",
  component: BlogCategoriesScreen,
  pendingComponent: marketingPending,
});

const marketingBlogNewRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/blog/new",
  component: function MarketingBlogNew() {
    return <PostForm />;
  },
  pendingComponent: marketingPending,
});

const marketingBlogPostRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storefront/blog/$id",
  component: function MarketingBlogPost() {
    return <PostForm postId={marketingBlogPostRoute.useParams().id} />;
  },
  pendingComponent: marketingPending,
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
  beforeLoad: () => {
    throw redirect({ to: "/integrations/notifications/email" });
  },
  pendingComponent: () => <PageSkeleton />,
  component: () => null,
});

const storageRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/storage",
  beforeLoad: () => {
    throw redirect({ to: "/integrations/storage" });
  },
  pendingComponent: () => <PageSkeleton />,
  component: () => null,
});

const notificationsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/notifications",
  component: NotificationManager,
  pendingComponent: () => <PageSkeleton />,
});

const integrationsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations",
  component: IntegrationsHub,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={3} />
    </PageContainer>
  ),
});

const integrationsNotificationsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/notifications",
  component: NotificationsHub,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={3} />
    </PageContainer>
  ),
});

const integrationsEmailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/notifications/email",
  component: function EmailChannelRoute() {
    return <ChannelPage channel="email" />;
  },
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={5} />
      <DataTableSkeleton columns={7} rows={6} />
    </PageContainer>
  ),
});

const integrationsSmsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/notifications/sms",
  component: function SmsChannelRoute() {
    return <ChannelPage channel="sms" />;
  },
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={5} />
      <DataTableSkeleton columns={7} rows={4} />
    </PageContainer>
  ),
});

const integrationsWhatsAppRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/notifications/whatsapp",
  component: function WhatsAppChannelRoute() {
    return <ChannelPage channel="whatsapp" />;
  },
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={5} />
      <DataTableSkeleton columns={7} rows={4} />
    </PageContainer>
  ),
});

const integrationsStorageRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/storage",
  component: StorageSettings,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={4} />
      <DataTableSkeleton columns={5} rows={4} />
    </PageContainer>
  ),
});

const integrationsBillingRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/billing",
  component: BillingIntegrations,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={3} />
    </PageContainer>
  ),
});

const integrationsBillingGatewayRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/billing/$gateway",
  component: BillingGateway,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={3} />
    </PageContainer>
  ),
});

const integrationsPaymentsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/payments",
  component: PaymentsIntegrations,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={3} />
    </PageContainer>
  ),
});

const integrationsAuthRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/integrations/auth",
  component: AuthHub,
  pendingComponent: () => (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardsSkeleton count={3} />
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
  marketingPageEditorRoute,
  acceptInvitationRoute,
  ...(import.meta.env.DEV ? [kitRoute] : []),
];

export const routeTree = rootRoute.addChildren([
  ...baseRoutes,
  authLayoutRoute.addChildren([
    overviewRoute,
    marketingRoute,
    marketingPagesRoute,
    marketingMediaRoute,
    settingsVisibilityRoute,
    settingsSearchRoute,
    settingsPrivacyRoute,
    marketingOldRoute,
    storefrontIndexRoute,
    marketingNavigationRoute,
    marketingMenuRoute,
    marketingBlogRoute,
    marketingBlogCategoriesRoute,
    marketingBlogNewRoute,
    marketingBlogPostRoute,
    tenantsListRoute,
    tenantCreateRoute,
    tenantDetailRoute,
    domainsRoute,
    plansRoute,
    ledgerRoute,
    promotionsRoute,
    marketplaceRoute,
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
    integrationsRoute,
    notificationsRoute,
    integrationsNotificationsRoute,
    integrationsEmailRoute,
    integrationsSmsRoute,
    integrationsWhatsAppRoute,
    integrationsStorageRoute,
    integrationsPaymentsRoute,
    integrationsAuthRoute,
    integrationsBillingRoute,
    integrationsBillingGatewayRoute,
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
