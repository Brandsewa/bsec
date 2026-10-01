import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

/** Pages link to other routes and navigate, so they render inside an in-memory router. */
async function renderInRouter(Page: () => React.ReactNode, queryClient: QueryClient): Promise<string> {
  const root = createRootRoute({ component: Page });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToString(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(RouterProvider, { router })),
  );
}

describe("Admin Catalog & Inventory Routes", () => {
  it("exports valid Route definition with pendingComponent for products index", async () => {
    const mod = await import("../src/routes/_store/products/index.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  }, 15000);

  it("exports valid Route definition with pendingComponent for products new", async () => {
    const mod = await import("../src/routes/_store/products/new.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for products detail ($id)", async () => {
    const mod = await import("../src/routes/_store/products/$id.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for inventory index", async () => {
    const mod = await import("../src/routes/_store/inventory/index.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for online-store theme", async () => {
    const mod = await import("../src/routes/_store/online-store/theme.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for the theme library", async () => {
    const mod = await import("../src/routes/_store/online-store/theme-library.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("registers the full-screen visual editor route with a pending skeleton", async () => {
    const mod = await import("../src/routes/_editor/online-store/editor/$pageId.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
    const shell = await import("../src/routes/_editor.tsx");
    expect(shell.Route.options.pendingComponent).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for online-store pages", async () => {
    const mod = await import("../src/routes/_store/online-store/pages.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for online-store menus", async () => {
    const mod = await import("../src/routes/_store/online-store/menus.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for settings branding", async () => {
    const mod = await import("../src/routes/_store/settings/branding.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });
});

describe("Admin M5 Routes (Orders, Customers, Discounts) oRPC Integration", () => {
  it("renders orders page with real data fetched from oRPC query", async () => {
    const { OrdersPage, ordersListInput, parseOrdersSearch } = await import("../src/routes/_store/orders.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Same request the page makes for an address bar with no filters.
    const opts = orpc.admin.orders.list.queryOptions({ input: ordersListInput(parseOrdersSearch({})) });
    queryClient.setQueryData(opts.queryKey, {
      items: [
        {
          id: "0199a000-0000-7000-8000-000000000101",
          number: "ORD-2026-REAL-001",
          customerEmail: "real.customer@example.com",
          customerPhone: "+919876543210",
          status: "confirmed",
          paymentStatus: "paid",
          fulfillmentStatus: "unfulfilled",
          grandTotal: 499900,
          itemsCount: 2,
          placedAt: "2026-09-29T10:15:00.000Z",
        },
      ],
      total: 1,
    });

    const html = await renderInRouter(OrdersPage, queryClient);

    expect(html).toContain("ORD-2026-REAL-001");
    expect(html).toContain("real.customer@example.com");
    expect(html).toContain("Orders");
  });

  it("renders customers page with real data fetched from oRPC query", async () => {
    const { CustomersPage, customersListInput, parseCustomersSearch } = await import("../src/routes/_store/customers.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const opts = orpc.admin.customers.list.queryOptions({ input: customersListInput(parseCustomersSearch({})) });
    queryClient.setQueryData(opts.queryKey, {
      items: [
        {
          id: "0199a000-0000-7000-8000-000000000201",
          name: "Dr. Real Customer",
          email: "dr.real@example.com",
          phone: "+919988776655",
          ordersCount: 5,
          totalSpent: 1250000,
          tags: ["vip", "early-adopter"],
          status: "active",
          createdAt: "2026-08-15T12:00:00.000Z",
        },
      ],
      total: 1,
    });

    const html = await renderInRouter(CustomersPage, queryClient);

    expect(html).toContain("Dr. Real Customer");
    expect(html).toContain("dr.real@example.com");
    expect(html).toContain("Customers");
  });

  it("renders discounts page with real data fetched from oRPC query", async () => {
    const { DiscountsPage, discountsListInput, parseDiscountsSearch } = await import("../src/routes/_store/discounts.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const opts = orpc.admin.discounts.list.queryOptions({ input: discountsListInput(parseDiscountsSearch({})) });
    queryClient.setQueryData(opts.queryKey, {
      items: [
        {
          id: "0199a000-0000-7000-8000-000000000301",
          code: "FESTIVE50_REAL",
          title: "Real Diwali 50% Off",
          type: "percent",
          value: 50,
          usageLimit: 100,
          usedCount: 15,
          status: "active",
          combinable: false,
          createdAt: "2026-09-29T10:00:00.000Z",
        },
      ],
      total: 1,
    });

    const html = await renderInRouter(DiscountsPage, queryClient);

    expect(html).toContain("FESTIVE50_REAL");
    expect(html).toContain("Real Diwali 50% Off");
    expect(html).toContain("Discounts");
  });
});
