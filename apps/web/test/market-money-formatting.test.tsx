import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { MarketProvider, useMoney } from "../src/components/market/MarketProvider.tsx";
import { formatInrPrice } from "../src/components/catalog/ProductCard.tsx";
import { formatInr } from "../src/components/product/VariantSelector.tsx";

function MoneyConsumer({ amount }: { amount: number }) {
  const money = useMoney();
  return <span data-testid="money">{money(amount)}</span>;
}

describe("Market Money Helpers & Provider", () => {
  it("useMoney formats INR by default when in INR market", () => {
    const html = renderToString(
      <MarketProvider value={{ currency: "INR", locale: "en-IN", prefix: "" }}>
        <MoneyConsumer amount={129900} />
      </MarketProvider>,
    );
    expect(html).toContain("₹1,299");
  });

  it("useMoney formats fractional INR correctly", () => {
    const html = renderToString(
      <MarketProvider value={{ currency: "INR", locale: "en-IN", prefix: "" }}>
        <MoneyConsumer amount={129950} />
      </MarketProvider>,
    );
    expect(html).toContain("₹1,299.50");
  });

  it("useMoney formats USD with $ in USD market", () => {
    const html = renderToString(
      <MarketProvider value={{ currency: "USD", locale: "en-US", prefix: "/us" }}>
        <MoneyConsumer amount={2400} />
      </MarketProvider>,
    );
    expect(html).toContain("$24");
  });

  it("useMoney formats fractional USD correctly", () => {
    const html = renderToString(
      <MarketProvider value={{ currency: "USD", locale: "en-US", prefix: "/us" }}>
        <MoneyConsumer amount={2450} />
      </MarketProvider>,
    );
    expect(html).toContain("$24.50");
  });

  it("formatInrPrice helper backwards compatibility and currency support", () => {
    expect(formatInrPrice(129900)).toBe("₹1,299");
    expect(formatInrPrice(129950)).toBe("₹1,299.50");
    expect(formatInrPrice(2400, "USD", "en-US")).toBe("$24");
    expect(formatInrPrice(2450, "USD", "en-US")).toBe("$24.50");
  });

  it("VariantSelector formatInr helper backwards compatibility and currency support", () => {
    expect(formatInr(129900)).toBe("₹1,299");
    expect(formatInr(129950)).toBe("₹1,299.50");
    expect(formatInr(2400, "USD")).toBe("$24");
  });
});
