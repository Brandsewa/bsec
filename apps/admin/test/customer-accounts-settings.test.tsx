import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

async function renderRouted(Page: () => React.ReactNode, qc: QueryClient, path = "/settings/customer-accounts"): Promise<string> {
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

describe("Customer Accounts Settings Page (/settings/customer-accounts)", () => {
  it("declares a pendingComponent (AGENTS.md rule 11)", async () => {
    const mod = await import("../src/routes/_store/settings/customer-accounts.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
  });

  it("renders customer accounts form with sign-in methods and self-service toggles", async () => {
    const { Route } = await import("../src/routes/_store/settings/customer-accounts.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.customerAccountSettings.get.queryOptions().queryKey, {
      id: "acc-1",
      showSignInLinks: true,
      emailPasswordEnabled: true,
      phoneOtpEnabled: true,
      allowSelfServeReturns: true,
      allowSelfServeCancellation: false,
      version: 1,
      updatedAt: "2026-10-04T12:00:00.000Z",
      createdAt: "2026-10-04T12:00:00.000Z",
    });

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Customer accounts");
    expect(html).toContain("Storefront links");
    expect(html).toContain("Show sign-in links in header");
    expect(html).toContain("Sign-in methods");
    expect(html).toContain("Email and password");
    expect(html).toContain("Phone number (SMS OTP)");
    expect(html).toContain("Social sign-in (Google, Facebook)");
    expect(html).toContain("Not available yet");
    expect(html).toContain("Customer self-service");
    expect(html).toContain("Allow self-service return requests");
    expect(html).toContain("Allow self-service order cancellation");
    expect(html).toContain("Go to Returns settings");
  });
});
