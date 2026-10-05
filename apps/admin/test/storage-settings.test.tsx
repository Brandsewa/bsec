import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

async function renderRouted(Page: () => React.ReactNode, qc: QueryClient, path = "/settings/storage"): Promise<string> {
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

const MOCK_STORAGE_DATA = {
  usedBytes: 157286400, // 150 MB
  limitBytes: 1073741824, // 1 GB
  mediaCount: 42,
  percentUsed: 15,
  state: "ok" as const,
  providerLabel: "Platform managed storage" as const,
  publicMediaConfigured: true,
  maxUploadBytes: 10485760, // 10 MB
  breakdown: [
    { kind: "product_images" as const, bytes: 104857600, count: 30 },
    { kind: "brand_assets" as const, bytes: 20971520, count: 5 },
    { kind: "theme_assets" as const, bytes: 31457280, count: 7 },
    { kind: "other" as const, bytes: 0, count: 0 },
  ],
};

describe("Storage Settings Page (/settings/storage)", () => {
  it("declares a pendingComponent (AGENTS.md rule 11)", async () => {
    const mod = await import("../src/routes/_store/settings/storage.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
  });

  it("renders read-only storage view with quota meter, breakdown, and retention explanation", async () => {
    const { Route } = await import("../src/routes/_store/settings/storage.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.storageUsage.get.queryOptions().queryKey, MOCK_STORAGE_DATA);

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Storage");
    expect(html).toContain("Platform managed storage");
    expect(html).toContain("150 MB");
    expect(html).toContain("1 GB");
    expect(html).toContain("15%");
    expect(html).toContain("Product images");
    expect(html).toContain("Brand assets");
    expect(html).toContain("Theme assets");
    expect(html).toContain("Storage &amp; retention policy");
    expect(html).toContain("Private customer return photos");
    expect(html).toContain("neither exposed publicly nor counted towards this storefront media quota");

    // Must NOT have any mutation form submit button
    expect(html).not.toContain('type="submit"');
  });

  it("handles warning and over-limit states with clear explanations", async () => {
    const { Route } = await import("../src/routes/_store/settings/storage.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.storageUsage.get.queryOptions().queryKey, {
      ...MOCK_STORAGE_DATA,
      usedBytes: 1100000000,
      percentUsed: 102,
      state: "over",
    });

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Storage quota exceeded");
    expect(html).toContain("New image and asset uploads will be refused");
  });
});
