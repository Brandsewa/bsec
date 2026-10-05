import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

async function renderRouted(Page: () => React.ReactNode, qc: QueryClient, path = "/settings/domains"): Promise<string> {
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

describe("Domains Settings Page (/settings/domains)", () => {
  it("declares a pendingComponent (AGENTS.md rule 11)", async () => {
    const mod = await import("../src/routes/_store/settings/domains.tsx");
    expect(mod.Route.options.pendingComponent).toBeDefined();
  });

  it("renders empty state when no custom domains are connected", async () => {
    const { Route } = await import("../src/routes/_store/settings/domains.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.domains.list.queryOptions().queryKey, []);

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Domains");
    expect(html).toContain("No custom domains connected");
    expect(html).toContain("Give your store a memorable, branded web address.");
    expect(html).toContain("Add domain");
  });

  it("renders pending verification with CNAME and TXT DNS instructions", async () => {
    const { Route } = await import("../src/routes/_store/settings/domains.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.domains.list.queryOptions().queryKey, [
      {
        id: "0199a000-0000-7000-8000-000000000001",
        hostname: "shop.mybrand.com",
        type: "custom",
        isPrimary: false,
        status: "awaiting_dns",
        sslStatus: "pending_validation",
        prevalidateTxt: true,
        verification: {
          cname: "stores.bcom.si",
          txt: {
            name: "_cf-custom-hostname.shop.mybrand.com",
            value: "cf-verification-token-12345",
          },
        },
        createdAt: "2026-10-04T12:00:00.000Z",
      },
    ]);

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("shop.mybrand.com");
    expect(html).toContain("Awaiting DNS");
    expect(html).toContain("DNS Configuration Required");
    expect(html).toContain("CNAME");
    expect(html).toContain("stores.bcom.si");
    expect(html).toContain("Copy target");
    expect(html).toContain("TXT");
    expect(html).toContain("_cf-custom-hostname.shop.mybrand.com");
    expect(html).toContain("cf-verification-token-12345");
    expect(html).toContain("Check verification");
    // Make primary is disabled when awaiting DNS
    expect(html).toContain("Make primary");
    expect(html).toContain("disabled");
  });

  it("renders active domain with SSL badge and primary action", async () => {
    const { Route } = await import("../src/routes/_store/settings/domains.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.domains.list.queryOptions().queryKey, [
      {
        id: "0199a000-0000-7000-8000-000000000002",
        hostname: "store.activebrand.com",
        type: "custom",
        isPrimary: true,
        status: "active",
        sslStatus: "active",
        createdAt: "2026-10-04T12:00:00.000Z",
      },
    ]);

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("store.activebrand.com");
    expect(html).toContain("Active");
    expect(html).toContain("SSL active");
    expect(html).toContain("Primary");
  });

  it("renders honesty notice when provider is not configured", async () => {
    const { Route } = await import("../src/routes/_store/settings/domains.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.domains.list.queryOptions().queryKey, [
      {
        id: "0199a000-0000-7000-8000-000000000003",
        hostname: "unconfigured.test.com",
        type: "custom",
        isPrimary: false,
        status: "requested",
        sslStatus: "not_configured",
        createdAt: "2026-10-04T12:00:00.000Z",
      },
    ]);

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Domain provider not configured");
    expect(html).toContain("Custom domain provisioning is not currently available on this platform.");
  });

  it("renders verification failed state with diagnostic message and retry", async () => {
    const { Route } = await import("../src/routes/_store/settings/domains.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.domains.list.queryOptions().queryKey, [
      {
        id: "0199a000-0000-7000-8000-000000000004",
        hostname: "failed.test.com",
        type: "custom",
        isPrimary: false,
        status: "failed",
        createdAt: "2026-10-04T12:00:00.000Z",
      },
    ]);

    const Page = Route.options.component as () => React.ReactNode;
    const html = await renderRouted(Page, qc);

    expect(html).toContain("Verification failed");
    expect(html).toContain("DNS verification could not be completed");
    expect(html).toContain("Re-verify domain");
  });
});
