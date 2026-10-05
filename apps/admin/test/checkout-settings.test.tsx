import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

async function renderRouted(Page: () => React.ReactNode, qc: QueryClient, path = "/settings/checkout"): Promise<string> {
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

describe("Checkout Settings Page (/settings/checkout)", () => {
  it("declares a pendingComponent (AGENTS.md rule 11)", async () => {
    const mod = await import("../src/routes/_store/settings/checkout.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
  });

  it("renders checkout settings form with toggles and sections", async () => {
    const { Route } = await import("../src/routes/_store/settings/checkout.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.checkoutSettings.get.queryOptions().queryKey, {
      v: 1,
      guestCheckout: true,
      accountCreation: "after_completed_order",
      phoneRequired: true,
      addressLine2: "optional",
      companyName: "hidden",
      marketingEmail: {
        enabled: true,
        label: "Keep me updated on news and exclusive offers",
      },
      abandoned: {
        detectAfterMinutes: 60,
        recoveryEnabled: false,
        steps: [],
      },
      updatedAt: "2026-10-04T12:00:00.000Z",
    });

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Checkout settings");
    expect(html).toContain("Allow guest checkout");
    expect(html).toContain("Require phone number at checkout");
    expect(html).toContain("Consent at checkout");
    expect(html).toContain("Email marketing opt-in checkbox");
    expect(html).toContain("Require agreement to Terms");
    expect(html).toContain("Abandoned checkouts");
    expect(html).toContain("Enable abandoned checkout recovery emails");
    expect(html).toContain("Email delivery notice");
  });
});
