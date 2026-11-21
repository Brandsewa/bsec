import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

const base = {
  id: "0199a000-0000-7000-8000-000000000001",
  email: "me@example.com",
  name: "Me",
  phone: null,
  jobTitle: null,
  image: null,
  locale: "en",
  timezone: null,
  dateFormat: null,
  timeFormat: null,
  defaultLanding: null,
  uiDensity: null,
  twoFactorEnabled: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};
const store = { tenantId: "0199a000-0000-7000-8000-0000000000aa", storeName: "Demo Store", joinedAt: "2026-10-02T00:00:00.000Z" };

async function render(access: unknown[] | "loading" | "error", tenantId: string | undefined = store.tenantId) {
  const { PermissionsTab } = await import("../src/components/account/permissions-tab.tsx");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (access === "error") qc.setQueryDefaults(["admin", "account"], { queryFn: () => Promise.reject(new Error("boom")) });
  else if (access !== "loading") qc.setQueryData(["admin", "account"], { ...base, access });
  const router = createRouter({ routeTree: createRootRoute({ component: () => React.createElement(PermissionsTab, { tenantId }) }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToString(React.createElement(QueryClientProvider, { client: qc }, React.createElement(RouterProvider, { router })));
}

describe("Account, Permissions tab", () => {
  it("shows the owner one line, not every permission, and no ask button", async () => {
    const html = await render([{ ...store, role: "store_owner", permissions: ["products.write", "orders.write"], invitedBy: null, owner: null }]);
    expect(html).toContain("Full store access");
    expect(html).not.toContain("capability-rows");
    expect(html).not.toContain("Ask for access changes");
    expect(html).toContain("Advanced permission details");
  });

  it("shows grouped rows with access labels for a staff member, and an ask link to the owner", async () => {
    const html = await render([
      {
        ...store,
        role: "store_admin",
        permissions: ["products.read", "products.write", "orders.read", "orders.refund", "customers.read", "analytics.read"],
        invitedBy: "Olive Owner",
        owner: { name: "Olive Owner", email: "olive@example.com" },
      },
    ]);
    for (const l of ["Products &amp; inventory", "Orders &amp; fulfilment", "Refunds", "Customers", "Storefront &amp; content", "Payments", "Shipping &amp; taxes", "Settings", "Team", "Analytics &amp; exports"]) expect(html).toContain(l);
    for (const l of ["Manage", "View only", "No access", "Sensitive access"]) expect(html).toContain(l);
    expect(html).toContain("Ask for access changes");
    expect(html).toContain("mailto:olive@example.com");
    expect(html).toContain("Granted by");
    expect(html).toContain("Olive Owner");
    expect(html).not.toContain("Full store access");
  });

  it("keeps raw identifiers only inside the collapsed advanced section", async () => {
    const html = await render([{ ...store, role: "Warehouse lead", permissions: ["orders.write", "products.read"], invitedBy: null, owner: null }]);
    const [before, after] = html.split("Advanced permission details");
    expect(before).not.toContain("orders.write");
    expect(after).toContain("orders.write");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("offers a Users link only to people who can manage the team", async () => {
    const withTeam = await render([{ ...store, role: "store_admin", permissions: ["staff.manage"], invitedBy: null, owner: null }]);
    const without = await render([{ ...store, role: "Warehouse lead", permissions: ["products.read"], invitedBy: null, owner: null }]);
    expect(withTeam).toContain("/settings/users");
    expect(without).not.toContain("/settings/users");
  });

  it("shows a loading state and never raw permissions while loading", async () => {
    const html = await render("loading");
    expect(html).not.toContain("Advanced permission details");
  });

  it("shows only the store the person is working in, never their other stores", async () => {
    const other = { ...store, tenantId: "0199a000-0000-7000-8000-0000000000bb", storeName: "Other Shop" };
    const access = [
      { ...store, role: "store_owner", permissions: [], invitedBy: null, owner: null },
      { ...other, role: "store_admin", permissions: ["products.write"], invitedBy: "Olive", owner: { name: "Olive", email: "olive@other.example" } },
    ];
    const here = await render(access, store.tenantId);
    expect(here).toContain("Demo Store");
    expect(here).not.toContain("Other Shop");
    expect(here).not.toContain("olive@other.example");
    const there = await render(access, other.tenantId);
    expect(there).toContain("Other Shop");
    expect(there).not.toContain("Demo Store");
    expect(there).not.toContain("Full store access");
  });

  it("says so when the person has no role in the current store", async () => {
    const html = await render([{ ...store, role: "store_admin", permissions: [], invitedBy: null, owner: null }], "0199a000-0000-7000-8000-0000000000cc");
    expect(html).toContain("do not have a role in this store");
    expect(html).not.toContain("Demo Store");
  });
});
