import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStoreCurrency } from "../src/lib/use-store-currency.ts";
import { orpc } from "../src/lib/orpc.ts";

function TestConsumer() {
  const currency = useStoreCurrency();
  return <div data-testid="currency">{currency}</div>;
}

function render(client: QueryClient) {
  return renderToString(
    React.createElement(QueryClientProvider, { client }, React.createElement(TestConsumer)),
  );
}

describe("useStoreCurrency hook", () => {
  it("defaults to INR when query cache is empty", () => {
    const qc = new QueryClient();
    const html = render(qc);
    expect(html).toContain("INR");
  });

  it("returns base market currency when markets query is cached", () => {
    const qc = new QueryClient();
    qc.setQueryData(orpc.admin.markets.list.queryOptions({}).queryKey, {
      markets: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "United States",
          handle: "us",
          isBase: true,
          status: "active",
          currency: "USD",
          unitSystem: "imperial",
          fxRate: 1,
          priceAdjustBps: 0,
          rounding: "none",
          taxDisplay: "exclusive",
          pathPrefix: null,
          catalogMode: "all",
          locale: "en-US",
          taxCollect: false,
          taxShippingToo: false,
          complianceAckAt: null,
          countries: ["US"],
        },
      ],
      extraMarketLimit: 2,
    });

    const html = render(qc);
    expect(html).toContain("USD");
  });

  it("prefers the store settings currency over the markets list", () => {
    const qc = new QueryClient();
    qc.setQueryData(orpc.admin.settings.get.queryOptions().queryKey, { storeName: "S", currency: "CAD", timezone: "America/Toronto" });
    qc.setQueryData(orpc.admin.markets.list.queryOptions({}).queryKey, { markets: [{ id: "11111111-1111-1111-1111-111111111111", name: "US", handle: "us", isBase: true, status: "active", currency: "USD", unitSystem: null, fxRate: 1, priceAdjustBps: 0, rounding: "none", taxDisplay: "exclusive", pathPrefix: null, catalogMode: "all", locale: null, taxCollect: false, taxShippingToo: false, complianceAckAt: null, countries: ["US"] }], extraMarketLimit: 1 });
    expect(render(qc)).toContain("CAD");
  });

  it("falls back to settings.get currency when markets has no base market", () => {
    const qc = new QueryClient();
    qc.setQueryData(orpc.admin.settings.get.queryOptions().queryKey, {
      storeName: "Test Store",
      currency: "CAD",
      timezone: "America/Toronto",
    });

    const html = render(qc);
    expect(html).toContain("CAD");
  });
});
