import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

const ADA = "0199a000-0000-7000-8000-000000000101";
const GIA = "0199a000-0000-7000-8000-000000000102";
const NOW = "2026-10-03T10:00:00.000Z";

/** List pages keep their state in the URL, so they render inside an in-memory router. */
async function renderRouted(client: QueryClient, Page: () => React.ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: Page }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(RouterProvider, { router })));
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const listData = {
  items: [
    {
      id: ADA,
      name: "Ada Account",
      email: "ada@example.com",
      phone: "9600000001",
      isGuest: false,
      status: "active",
      ordersCount: 2,
      totalSpent: 120000,
      lastOrderAt: NOW,
      marketingState: "subscribed",
      marketingUpdatedAt: NOW,
      tags: ["VIP", "wholesale", "repeat"],
      createdAt: NOW,
    },
    {
      id: GIA,
      name: "Gia Guest",
      email: "gia@example.com",
      phone: null,
      isGuest: true,
      status: "active",
      ordersCount: 0,
      totalSpent: 0,
      lastOrderAt: null,
      marketingState: "invalid",
      marketingUpdatedAt: null,
      tags: [],
      createdAt: NOW,
    },
  ],
  total: 2,
};
const statsData = { total: 2, newThisMonth: 2, repeat: 1, subscribers: 1, totalSpend: 120000, averageOrderValue: 60000 };
const tagsData = { tags: ["VIP", "wholesale", "repeat"], locationStates: ["KA", "MH"] };

async function seedPage() {
  const { CustomersPage, customersListInput, parseCustomersSearch } = await import("../src/routes/_store/customers.tsx");
  const { orpc } = await import("../src/lib/orpc.ts");
  return { CustomersPage, customersListInput, parseCustomersSearch, orpc };
}

describe("Customers list (Phase 1A)", () => {
  it("registers the route with a pending skeleton", async () => {
    const { Route } = await import("../src/routes/_store/customers.tsx");
    expect(Route).toBeDefined();
    expect(Route.options.pendingComponent).toBeDefined();
    expect(Route.options.component).toBeDefined();
  });

  it("renders rows with guest and marketing badges, tabs and stats", async () => {
    const { CustomersPage, customersListInput, parseCustomersSearch, orpc } = await seedPage();
    const qc = newClient();
    qc.setQueryData(orpc.admin.customers.list.queryOptions({ input: customersListInput(parseCustomersSearch({})) }).queryKey, listData);
    qc.setQueryData(orpc.admin.customers.stats.queryOptions().queryKey, statsData);
    qc.setQueryData(orpc.admin.customers.tags.queryOptions().queryKey, tagsData);
    const html = await renderRouted(qc, CustomersPage);

    expect(html).toContain("Ada Account");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Gia Guest");
    expect(html).toContain("Guest"); // guest badge
    expect(html).toContain("Subscribed"); // marketing badge
    expect(html).toContain("Invalid"); // marketing badge
    expect(html).toMatch(/\+<!-- -->1/); // third tag folded into a +N overflow
    expect(html).toContain("1,200"); // total spent

    for (const tab of ["All", "Customers", "Guests", "Blocked"]) expect(html).toContain(tab);
    for (const card of ["Total customers", "New this month", "Repeat customers", "Marketing subscribers", "Total spend", "Average order value"]) {
      expect(html).toContain(card);
    }
  });

  it("renders the empty state and keeps every column out of the mobile card", async () => {
    const { CustomersPage, customersListInput, parseCustomersSearch, orpc } = await seedPage();
    const qc = newClient();
    qc.setQueryData(orpc.admin.customers.list.queryOptions({ input: customersListInput(parseCustomersSearch({})) }).queryKey, { items: [], total: 0 });
    qc.setQueryData(orpc.admin.customers.stats.queryOptions().queryKey, statsData);
    qc.setQueryData(orpc.admin.customers.tags.queryOptions().queryKey, tagsData);
    const html = await renderRouted(qc, CustomersPage);
    expect(html).toContain("No customers yet");
  });

  it("maps URL state to the API request and reserves the segment param", async () => {
    const { customersListInput, parseCustomersSearch } = await seedPage();
    const defaults = customersListInput(parseCustomersSearch({}));
    expect(defaults).toMatchObject({ view: "all", sort: "created_desc", limit: 25, offset: 0 });
    expect(defaults).not.toHaveProperty("segment");

    const full = customersListInput(
      parseCustomersSearch({ view: "guests", q: "gia", tag: "VIP", mkt: "subscribed", loc: "KA", repeat: "1", from: "2026-10-01", to: "2026-10-02", segment: "ignored-for-now" }),
    );
    expect(full).toMatchObject({
      view: "guests",
      search: "gia",
      tag: "VIP",
      marketingState: "subscribed",
      location: "KA",
      repeat: true,
    });
    // Date conversion is timezone-dependent: the range must start before Oct 2 and end after Oct 1.
    expect(new Date(String(full.createdFrom)).getTime()).toBeLessThan(new Date("2026-10-02T00:00:00Z").getTime());
    expect(new Date(String(full.createdTo)).getTime()).toBeGreaterThan(new Date("2026-10-01T00:00:00Z").getTime());
    expect(full).not.toHaveProperty("segment");
  });

  it("drops unknown filter values back to defaults", async () => {
    const { parseCustomersSearch } = await seedPage();
    const parsed = parseCustomersSearch({ view: "nonsense", mkt: "sometimes", sort: "chaos" });
    expect(parsed.view).toBe("all");
    expect(parsed.mkt).toBeUndefined();
    expect(parsed.sort).toBe("created_desc");
  });
});
