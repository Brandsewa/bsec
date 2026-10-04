import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

const ADA = "0199a000-0000-7000-8000-000000000101";
const SEGID = "0199a000-0000-7000-8000-000000000301";
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

  it("passes the segment filter into the API request and shows it as a chip", async () => {
    const { CustomersPage, customersListInput, parseCustomersSearch } = await seedPage();
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    const search = parseCustomersSearch({ segment: SEGID });
    qc.setQueryData(orpc.admin.customers.list.queryOptions({ input: customersListInput(search) }).queryKey, listData);
    qc.setQueryData(orpc.admin.customers.stats.queryOptions().queryKey, statsData);
    qc.setQueryData(orpc.admin.customers.tags.queryOptions().queryKey, tagsData);
    qc.setQueryData(orpc.admin.segments.list.queryOptions({ input: { limit: 100 } }).queryKey, {
      items: [{ id: SEGID, name: "VIP customers", description: null, kind: "automatic", isPreset: true, memberCount: 1, countedAt: NOW, createdAt: NOW, updatedAt: NOW }],
      total: 1,
    });
    const html = await renderRouted(qc, CustomersPage);
    // The filter select renders (closed selects show only the trigger in SSR)
    expect(html).toContain("Segment:");
    // The mapping is the contract: segment param in, segmentId out; absent otherwise.
    expect(customersListInput(search)).toMatchObject({ segmentId: SEGID });
    expect(customersListInput(parseCustomersSearch({}))).not.toHaveProperty("segmentId");
  });

  it("drops unknown filter values back to defaults", async () => {
    const { parseCustomersSearch } = await seedPage();
    const parsed = parseCustomersSearch({ view: "nonsense", mkt: "sometimes", sort: "chaos" });
    expect(parsed.view).toBe("all");
    expect(parsed.mkt).toBeUndefined();
    expect(parsed.sort).toBe("created_desc");
  });
});

const CID2 = "0199a000-0000-7000-8000-000000000201";
const detailData = {
  customer: {
    id: CID2,
    name: "Ada Account",
    email: "ada@example.com",
    phone: "9600000001",
    emailVerified: false,
    isGuest: false,
    status: "active",
    ordersCount: 2,
    totalSpent: 120000,
    averageOrderValue: 60000,
    firstOrderAt: NOW,
    lastOrderAt: NOW,
    returnsCount: 0,
    marketingState: "subscribed",
    marketingSource: "admin",
    marketingUpdatedAt: NOW,
    tags: ["VIP"],
    createdAt: NOW,
  },
  addresses: [
    { id: CID2, name: "Ada", phone: "9600000001", line1: "1 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001", type: "home", isDefault: true },
  ],
  consentHistory: [
    { id: CID2, channel: "email", state: "subscribed", source: "admin", actorType: "staff", at: NOW },
  ],
  recentOrders: [
    { id: CID2, number: "ORD-1", status: "pending", paymentStatus: "cod_collected", fulfillmentStatus: "unfulfilled", grandTotal: 120000, placedAt: NOW },
  ],
};

describe("Customer detail (Phase 1B)", () => {
  it("registers the route with a pending skeleton", async () => {
    const mod = await import("../src/routes/_store/customers_.$customerId.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("renders the segments card with manual memberships and automatic chips", async () => {
    const { CustomerDetailPage } = await import("../src/routes/_store/customers_.$customerId.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.customers.get.queryOptions({ input: { id: CID2 } }).queryKey, detailData);
    qc.setQueryData(orpc.admin.segments.forCustomer.queryOptions({ input: { customerId: CID2 } }).queryKey, {
      manual: [{ id: SEGID, name: "Manual picks" }],
      automatic: [{ id: "0199a000-0000-7000-8000-000000000302", name: "VIP customers" }],
    });
    qc.setQueryData(orpc.admin.customers.notes.list.queryOptions({ input: { id: CID2 } }).queryKey, { items: [] });
    qc.setQueryData(orpc.admin.customers.orders.queryOptions({ input: { id: CID2 } }).queryKey, { items: detailData.recentOrders, total: 1 });
    qc.setQueryData(orpc.admin.customers.activity.queryOptions({ input: { id: CID2 } }).queryKey, { items: [] });
    qc.setQueryData(orpc.admin.customers.tags.queryOptions().queryKey, tagsData);
    const qcProvider = React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(CustomerDetailPage as (props: { customerId?: string }) => React.ReactNode, { customerId: CID2 }),
    );
    const router = createRouter({
      routeTree: createRootRoute({ component: () => qcProvider }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const html = renderToString(React.createElement(RouterProvider, { router }));
    expect(html).toContain("Segments");
    expect(html).toContain("Manual picks"); // manual membership with remove
    expect(html).toContain("VIP customers"); // automatic chip links to the segment
    expect(html).toContain("Automatic segments are read-only");
  });

  it("renders stat tiles, profile fields, addresses, marketing card, tags and notes composer", async () => {
    const { CustomerDetailPage } = await import("../src/routes/_store/customers_.$customerId.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const Page = CustomerDetailPage as (props: { customerId?: string }) => React.ReactNode;
    const qc = newClient();
    qc.setQueryData(orpc.admin.customers.get.queryOptions({ input: { id: CID2 } }).queryKey, detailData);
    qc.setQueryData(orpc.admin.customers.notes.list.queryOptions({ input: { id: CID2 } }).queryKey, {
      items: [{ id: CID2, customerId: CID2, body: "Prefers evening calls", authorId: null, authorName: null, createdAt: NOW }],
    });
    qc.setQueryData(orpc.admin.customers.orders.queryOptions({ input: { id: CID2 } }).queryKey, { items: detailData.recentOrders, total: 1 });
    qc.setQueryData(orpc.admin.customers.activity.queryOptions({ input: { id: CID2 } }).queryKey, {
      items: [{ kind: "consent", at: NOW, title: "Marketing subscribed", detail: "admin", ref: CID2 }],
    });
    qc.setQueryData(orpc.admin.customers.tags.queryOptions().queryKey, tagsData);

    // The page needs router context for Link and the unsaved-changes blocker; props supply the id.
    const router = createRouter({
      routeTree: createRootRoute({ component: () => Page({ customerId: CID2 }) }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const html = renderToString(React.createElement(QueryClientProvider, { client: qc }, React.createElement(RouterProvider, { router })));

    for (const tile of ["Orders", "Lifetime value", "Average order value", "Last order", "Customer since"]) expect(html).toContain(tile);
    expect(html).toContain("Prefers evening calls"); // migrated note
    expect(html).toContain("Consent history");
    expect(html).toContain("Unsubscribe from marketing");
    expect(html).toContain("Block customer");
    expect(html).toContain("Add an internal note");
  });
});
