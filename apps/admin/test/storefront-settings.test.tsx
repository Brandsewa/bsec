import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

async function renderRouted(Page: () => React.ReactNode, qc: QueryClient, path = "/settings/storefront"): Promise<string> {
  const router = createRouter({
    routeTree: createRootRoute({ component: Page }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToString(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(RouterProvider, { router })),
  );
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("Storefront Settings Page (/settings/storefront)", () => {
  it("declares a pendingComponent (AGENTS.md rule 11)", async () => {
    const mod = await import("../src/routes/_store/settings/storefront.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
  });

  it("renders modes with accurate descriptions and maintenance explanation", async () => {
    const { Route } = await import("../src/routes/_store/settings/storefront.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.storefront.getStatus.queryOptions().queryKey, {
      mode: "maintenance",
      headline: "Scheduled maintenance",
      showCountdown: false,
      collectEmails: true,
      launchAt: null,
      hasPassword: false,
    });

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Storefront");
    expect(html).toContain("Anyone can browse, add to cart, and checkout.");
    expect(html).toContain("Visitors see your holding page. They cannot browse products or checkout.");
    expect(html).toContain("Only visitors with the password can enter. Staff with admin sessions always have access.");
    expect(html).toContain("Returns a 503 Service Unavailable with Retry-After header. Use during planned maintenance.");
    expect(html).toContain("Maintenance mode serves an HTTP 503 Service Unavailable status with a Retry-After header so search engines do not de-index your site during brief downtime.");
  });

  it("renders live status indicator when store is live", async () => {
    const { Route } = await import("../src/routes/_store/settings/storefront.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.storefront.getStatus.queryOptions().queryKey, {
      mode: "live",
      headline: null,
      showCountdown: false,
      collectEmails: true,
      launchAt: null,
      hasPassword: false,
    });

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Your store is live.");
  });
});
