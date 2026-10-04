import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

/** Settings pages link across routes and use the unsaved guard, so they render inside an in-memory router. */
async function renderRouted(Page: () => React.ReactNode, qc: QueryClient, path = "/"): Promise<string> {
  const router = createRouter({ routeTree: createRootRoute({ component: Page }), history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return renderToString(React.createElement(QueryClientProvider, { client: qc }, React.createElement(RouterProvider, { router })));
}
const newClient = (overrides: NonNullable<NonNullable<ConstructorParameters<typeof QueryClient>[0]>["defaultOptions"]>["queries"] = {}) =>
  new QueryClient({ defaultOptions: { queries: { retry: false, ...overrides } } });

const OVERVIEW_DATA = {
  storeStatus: { mode: "coming_soon", storefrontUrl: "https://alpha.bcom.si" },
  payments: { codEnabled: true, onlinePaymentAvailable: false },
  shipping: { hasDefaultRate: false },
  products: { hasProducts: false },
  domains: { hasCustomDomain: false, storefrontHostname: "alpha.bcom.si" },
  plan: { name: "Starter", status: "trialing", interval: "monthly" },
  onboarding: { steps: { store_created: true, product_added: false, payment_configured: true, domain_connected: false, first_order_received: false }, completedCount: 2, totalCount: 5, dismissed: false, allCompleted: false },
  actions: [
    { id: "store_not_live", title: "Store is not live", description: "coming soon", href: "/settings/storefront", kind: "required" },
    { id: "no_shipping_rate", title: "No shipping rate for the default zone", description: "d", href: "/settings/shipping", kind: "required" },
    { id: "no_products", title: "No products yet", description: "d", href: "/products/new", kind: "required" },
    { id: "no_custom_domain", title: "Using the platform subdomain", description: "info", href: null, kind: "informational" },
  ],
  quickLinks: [
    { href: "/settings/storefront", label: "Store availability" },
    { href: "/settings/shipping", label: "Shipping rates" },
  ],
};

describe("Settings shell: grouped navigation", () => {
  it("nav exposes the plan's groups and only items the role may see", async () => {
    const { SETTINGS_NAV, SETTINGS_NAV_GROUPS, visibleSettingsGroups } = await import("../src/components/settings/settings-nav.ts");

    const groupIds = SETTINGS_NAV_GROUPS.map((g) => g.id);
    expect(groupIds).toEqual(["overview", "store", "selling", "operations", "people", "compliance"]);

    const hrefs = SETTINGS_NAV.map((i) => i.href);
    // Store details is canonical; the old General route is the Overview; no placeholders.
    expect(hrefs).toContain("/settings/store-details");
    expect(hrefs.filter((h) => h === "/settings")).toHaveLength(1);
    expect(hrefs).not.toContain("/settings/general");

    const owner = visibleSettingsGroups(["settings.write", "staff.manage"]);
    expect(owner.map((g) => g.id)).toEqual(["overview", "store", "selling", "operations", "people", "compliance"]);

    // Without staff.manage the People group disappears entirely (empty groups are omitted).
    const noStaff = visibleSettingsGroups(["settings.write"]);
    expect(noStaff.map((g) => g.id)).not.toContain("people");
    // Every visible item passes the permission filter.
    for (const g of noStaff) for (const i of g.items) expect(i.perm).toBe("settings.write");
  });

  it("nav labels the team route Users while keeping the /settings/team path", async () => {
    const { SETTINGS_NAV } = await import("../src/components/settings/settings-nav.ts");
    const team = SETTINGS_NAV.find((i) => i.id === "team");
    expect(team!.label).toBe("Users");
    expect(team!.href).toBe("/settings/team");
  });
});

describe("Settings Overview page (/settings)", () => {
  it("renders server-verified actions, status and quick links from the read model", async () => {
    const { Route } = await import("../src/routes/_store/settings/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.settingsOverview.get.queryOptions().queryKey, OVERVIEW_DATA);
    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);
    expect(html).toContain("Store is not live");
    expect(html).toContain("No shipping rate for the default zone");
    expect(html).toContain("No products yet");
    expect(html).toContain("Using the platform subdomain");
    expect(html).toContain("Coming soon");
    expect(html).toContain("alpha.bcom.si");
    expect(html).toContain("2");
    expect(html).toContain("steps complete");
    expect(html).toContain("Store availability");
    expect(html).toContain("Shipping rates");
  }, 60_000);

  it("renders the nothing-to-do state when no actions exist", async () => {
    const { Route } = await import("../src/routes/_store/settings/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.settingsOverview.get.queryOptions().queryKey, {
      ...OVERVIEW_DATA,
      storeStatus: { mode: "live", storefrontUrl: "https://alpha.bcom.si" },
      shipping: { hasDefaultRate: true },
      products: { hasProducts: true },
      domains: { hasCustomDomain: true, storefrontHostname: "shop.alpha.com" },
      actions: [],
      quickLinks: [{ href: "/settings/orders", label: "Order settings" }],
    });
    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);
    expect(html).toContain("Everything needed to sell is set up.");
    expect(html).not.toContain("Store is not live");
  });

  it("renders a recoverable error state with retry", async () => {
    const { Route } = await import("../src/routes/_store/settings/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient({ refetchOnMount: false, refetchOnReconnect: false, retryOnMount: false, staleTime: Infinity, gcTime: Infinity });
    const options = orpc.admin.settingsOverview.get.queryOptions();
    const built = qc.getQueryCache().build(qc, {
      ...qc.defaultQueryOptions({ queryKey: options.queryKey, queryFn: async () => { throw new Error("boom"); } }),
    });
    built.setState({ status: "error", fetchStatus: "idle", error: new Error("boom") });
    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);
    console.log("CACHE:", JSON.stringify(qc.getQueryCache().getAll().map((q) => ({ hash: q.queryHash, status: q.state.status, fetch: q.state.fetchStatus }))));
    expect(html).toContain("Could not load the overview");
    expect(html).toContain("Try again");
  });

  it("declares a pendingComponent (AGENTS.md rule 11)", async () => {
    const mod = await import("../src/routes/_store/settings/index.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
    const storeDetails = await import("../src/routes/_store/settings/store-details.tsx");
    expect(storeDetails.Route.options.pendingComponent).toBeDefined();
  });
});

describe("Store details page (/settings/store-details)", () => {
  const SETTINGS = {
    tenantId: "0199a000-0000-7000-8000-000000000010",
    storeName: "Alpha Store",
    currency: "INR",
    timezone: "Asia/Kolkata",
    legalName: "Alpha Retail Pvt Ltd",
    supportEmail: "help@alpha.test",
    supportPhone: "+919876543210",
    address: { line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    orderPrefix: "#ALP-",
    autoPublishReviews: true,
  };

  it("renders every migrated General field with current values, no order-prefix editor", async () => {
    const { Route } = await import("../src/routes/_store/settings/store-details.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.settings.get.queryOptions().queryKey, SETTINGS);
    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);
    expect(html).toContain('value="Alpha Store"');
    expect(html).toContain('value="Alpha Retail Pvt Ltd"');
    expect(html).toContain('value="help@alpha.test"');
    expect(html).toContain('value="12 MG Road"');
    expect(html).toContain('value="560001"');
    expect(html).toContain('value="INR"');
    expect(html).toContain('value="Asia/Kolkata"');
    expect(html).toContain("Publish reviews automatically");
    // The order prefix is not editable here (canonical editor: Settings > Orders).
    expect(html).not.toContain('id="orderPrefix"');
  }, 60_000);
});
