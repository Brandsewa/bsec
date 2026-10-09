import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

const SAMPLE_TEXT = ["Acme", "Nepal", "Kathmandu", "Pokhara", "Free shipping across"];

function render(client: QueryClient, component: React.ComponentType): string {
  return renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(component)));
}
/** Settings sections guard unsaved changes through the router, so they render inside an in-memory one. */
async function renderRouted(client: QueryClient, Page: () => React.ReactNode): Promise<string> {
  const router = createRouter({ routeTree: createRootRoute({ component: Page }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(RouterProvider, { router })));
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function expectNoSample(html: string) {
  for (const s of SAMPLE_TEXT) expect(html).not.toContain(s);
}

const PAGE_ID = "0199a000-0000-7000-8000-000000000301";
const VERSION_ID = "0199a000-0000-7000-8000-000000000302";
const MENU_ID = "0199a000-0000-7000-8000-000000000401";
const BRAND_ID = "0199a000-0000-7000-8000-000000000501";
const now = "2026-09-29T10:00:00.000Z";

describe("Online store admin pages use real oRPC data", { timeout: 30000 }, () => {
  it("theme route redirects to theme library", async () => {
    const { Route } = await import("../src/routes/_store/online-store/theme.tsx");
    expect(Route.options.beforeLoad).toBeDefined();
    let redirectedTo: string | undefined;
    try {
      const beforeLoad = Route.options.beforeLoad as unknown as ((ctx?: unknown) => void) | undefined;
      beforeLoad?.();
    } catch (err: unknown) {
      const e = err as { to?: string; options?: { to?: string } };
      redirectedTo = e?.to ?? e?.options?.to;
    }
    expect(redirectedTo).toBe("/online-store/theme-library");
  });

  it("pages page renders seeded pages in the table", async () => {
    const { PagesPage } = await import("../src/routes/_store/online-store/pages.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const client = newClient();
    client.setQueryData(orpc.admin.pages.list.queryOptions().queryKey, [
      { id: PAGE_ID, slug: "our-story", title: "Our Story", publishedVersionId: VERSION_ID, status: "published", path: "/pages/our-story", createdAt: now, updatedAt: now },
    ]);
    const html = await renderRouted(client, PagesPage);
    expect(html).toContain("Our Story");
    expect(html).toContain("our-story");
    expect(html).toContain("Add page");
    expectNoSample(html);
  });

  it("pages page shows an empty state with a call to action when there are no pages", async () => {
    const { PagesPage } = await import("../src/routes/_store/online-store/pages.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const client = newClient();
    client.setQueryData(orpc.admin.pages.list.queryOptions().queryKey, []);
    const html = await renderRouted(client, PagesPage);
    expect(html).toContain("No pages found");
    expect(html).toContain("Add page");
    expectNoSample(html);
  });

  it("menus page renders seeded menu with nested items", async () => {
    const { MenusPage } = await import("../src/routes/_store/online-store/menus.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const client = newClient();
    client.setQueryData(orpc.admin.menus.list.queryOptions().queryKey, [
      { id: MENU_ID, name: "Main menu", handle: "main-menu", createdAt: now, updatedAt: now },
    ]);
    client.setQueryData(orpc.admin.menus.get.queryOptions({ input: { handle: "main-menu" } }).queryKey, {
      id: MENU_ID,
      name: "Main menu",
      handle: "main-menu",
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: "i1",
          title: "Shop",
          url: "/collections/all",
          type: "url",
          children: [{ id: "i2", title: "Sarees", url: "/collections/sarees", type: "collection" }],
        },
      ],
    });
    const html = render(client, MenusPage);
    expect(html).toContain("Main menu");
    expect(html).toContain("main-menu");
    expect(html).toContain("collections/sarees");
    expect(html).toContain("Sarees");
    expectNoSample(html);
  });

  it("menus page shows an empty state when there are no menus", async () => {
    const { MenusPage } = await import("../src/routes/_store/online-store/menus.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const client = newClient();
    client.setQueryData(orpc.admin.menus.list.queryOptions().queryKey, []);
    const html = render(client, MenusPage);
    expect(html).toContain("No menus yet");
    expect(html).toContain("New menu");
    expectNoSample(html);
  });

  it("branding page renders stored brand settings and computed contrast", async () => {
    const { BrandingSettingsPage } = await import("../src/routes/_store/settings/branding.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const client = newClient();
    client.setQueryData(orpc.admin.branding.get.queryOptions().queryKey, {
      id: BRAND_ID,
      logoWidth: 180,
      fontHeading: "Rozha One",
      fontBody: "Mukta",
      fontSizeScale: "default",
      colorSchemeName: "Classic",
      primaryColor: "#7c3aed",
      secondaryColor: "#334155",
      accentColor: "#2563eb",
      backgroundColor: "#ffffff",
      surfaceColor: "#f8fafc",
      textColor: "#000000",
      colorMode: "light",
      cornerRadius: "medium",
      buttonStyle: "solid",
      version: 4,
      publishedAt: now,
    });
    client.setQueryData(orpc.admin.settings.get.queryOptions().queryKey, {
      tenantId: "t1",
      storeName: "Saree Studio",
      currency: "INR",
      timezone: "Asia/Kolkata",
    });
    client.setQueryData(orpc.admin.media.list.queryOptions({ input: { limit: 100, offset: 0 } }).queryKey, {
      items: [],
      total: 0,
    });
    const html = await renderRouted(client, BrandingSettingsPage);
    expect(html).toContain("Saree Studio");
    expect(html).toContain("#7c3aed");
    expect(html).toContain("Rozha One");
    expectNoSample(html);
  });
});
