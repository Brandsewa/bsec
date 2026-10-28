import { describe, expect, it } from "vitest";
import {
  canAddMarket,
  computeTax,
  derivePrice,
  isValidPathPrefix,
  marketIdForCountry,
  marketReadiness,
  matchTaxRules,
  roundToMinor,
  slugifyHandle,
  type TaxRuleRow,
} from "../src/markets/rules.ts";

describe("derivePrice", () => {
  const base = { baseCurrency: "INR", targetCurrency: "USD", adjustBps: 0, rounding: "none" as const };
  it("converts with the merchant rate", () => {
    // Rs 1,000.00 at 0.012 = $12.00
    expect(derivePrice({ ...base, baseMinor: 100_000, fxRate: 0.012 })).toBe(1200);
  });
  it("applies the adjustment before rounding", () => {
    expect(derivePrice({ ...base, baseMinor: 100_000, fxRate: 0.012, adjustBps: 1000 })).toBe(1320);
    expect(derivePrice({ ...base, baseMinor: 100_000, fxRate: 0.012, adjustBps: -500 })).toBe(1140);
  });
  it("applies rounding rules", () => {
    const i = { ...base, baseMinor: 123_400, fxRate: 0.012 }; // $14.808
    expect(derivePrice({ ...i, rounding: "none" })).toBe(1481);
    expect(derivePrice({ ...i, rounding: "nearest_whole" })).toBe(1500);
    expect(derivePrice({ ...i, rounding: "charm_99" })).toBe(1499);
    expect(derivePrice({ ...i, rounding: "charm_95" })).toBe(1495);
  });
  it("handles currencies with a different number of decimals", () => {
    expect(derivePrice({ baseMinor: 100_000, baseCurrency: "INR", targetCurrency: "JPY", fxRate: 1.8, adjustBps: 0, rounding: "none" })).toBe(1800);
    expect(roundToMinor(12.5, "JPY", "charm_99")).toBe(13);
  });
  it("keeps free and zero prices at zero", () => {
    expect(derivePrice({ ...base, baseMinor: 0, fxRate: 0.012, rounding: "charm_99" })).toBe(0);
  });
  it("is monotonic in the base price", () => {
    let prev = 0;
    for (let p = 100; p < 5_000_00; p += 777) {
      const v = derivePrice({ ...base, baseMinor: p, fxRate: 0.012, adjustBps: 300, rounding: "charm_99" });
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("computeTax", () => {
  const ca: TaxRuleRow[] = [
    { country: "CA", region: "*", taxName: "GST", rateBps: 500 },
    { country: "CA", region: "BC", taxName: "PST", rateBps: 700 },
    { country: "CA", region: "ON", taxName: "HST", rateBps: 1300 },
    { country: "US", region: "CA", taxName: "Sales tax", rateBps: 725 },
  ];
  it("matches by country and region, stacking rows", () => {
    expect(matchTaxRules(ca, "CA", "BC").map((r) => r.taxName)).toEqual(["GST", "PST"]);
    expect(matchTaxRules(ca, "ca", "on").map((r) => r.taxName)).toEqual(["GST", "HST"]);
    expect(matchTaxRules(ca, "US", "TX")).toEqual([]);
    expect(matchTaxRules(ca, "US", "CA").map((r) => r.taxName)).toEqual(["Sales tax"]);
  });
  it("adds tax on top when prices are exclusive", () => {
    const r = computeTax({ lineAmounts: [10_000, 2_500], shippingAmount: 1_000, taxShippingToo: false, pricesIncludeTax: false, country: "CA", region: "BC", rules: ca });
    expect(r.lines).toEqual([
      { name: "GST", rateBps: 500, amount: 625 },
      { name: "PST", rateBps: 700, amount: 875 },
    ]);
    expect(r.addedTotal).toBe(1500);
  });
  it("includes shipping only when asked", () => {
    const r = computeTax({ lineAmounts: [10_000], shippingAmount: 1_000, taxShippingToo: true, pricesIncludeTax: false, country: "CA", region: "ON", rules: ca });
    expect(r.addedTotal).toBe(Math.round(11_000 * 0.05) + Math.round(11_000 * 0.13));
  });
  it("carves tax out of inclusive prices without changing the total", () => {
    const r = computeTax({ lineAmounts: [11_300], shippingAmount: 0, taxShippingToo: false, pricesIncludeTax: true, country: "CA", region: "ON", rules: [{ country: "CA", region: "ON", taxName: "HST", rateBps: 1300 }] });
    expect(r.addedTotal).toBe(0);
    expect(r.containedTotal).toBe(1300);
  });
  it("adds nothing without a matching row", () => {
    const r = computeTax({ lineAmounts: [10_000], shippingAmount: 500, taxShippingToo: true, pricesIncludeTax: false, country: "US", region: "TX", rules: ca });
    expect(r).toEqual({ lines: [], addedTotal: 0, containedTotal: 0 });
  });
  it("rounds per line, half up", () => {
    const r = computeTax({ lineAmounts: [333, 333, 333], shippingAmount: 0, taxShippingToo: false, pricesIncludeTax: false, country: "US", region: "CA", rules: ca });
    expect(r.addedTotal).toBe(3 * Math.round(333 * 0.0725));
  });
});

describe("market lookup and limits", () => {
  const rows = [
    { marketId: "in", country: "IN" },
    { marketId: "us", country: "US" },
  ];
  it("maps a country to its market, base as the fallback", () => {
    expect(marketIdForCountry(rows, "US", "in")).toBe("us");
    expect(marketIdForCountry(rows, "us", "in")).toBe("us");
    expect(marketIdForCountry(rows, "FR", "in")).toBe("in");
    expect(marketIdForCountry(rows, null, "in")).toBe("in");
  });
  it("counts only extra markets against the plan limit", () => {
    expect(canAddMarket(0, 1)).toBe(true);
    expect(canAddMarket(1, 1)).toBe(false);
    expect(canAddMarket(4, 5)).toBe(true);
    expect(canAddMarket(5, 5)).toBe(false);
  });
  it("validates URL prefixes", () => {
    expect(isValidPathPrefix("/us")).toBe(true);
    expect(isValidPathPrefix("/ca-en")).toBe(true);
    expect(isValidPathPrefix("us")).toBe(false);
    expect(isValidPathPrefix("/us/x")).toBe(false);
    expect(isValidPathPrefix("/cart")).toBe(false);
    expect(isValidPathPrefix("/API")).toBe(false);
    expect(slugifyHandle("United States!")).toBe("united-states");
  });
});

describe("marketReadiness", () => {
  const ok = { isBase: false, currency: "USD", baseCurrency: "INR", fxRate: 0.012, countryCount: 1, paymentMethodCount: 1, shippingRateCount: 1, policyFilled: true, taxChoiceAcknowledged: true };
  it("is ready when everything is set", () => {
    expect(marketReadiness(ok).ready).toBe(true);
  });
  it("lists each missing step", () => {
    const r = marketReadiness({ ...ok, fxRate: null, paymentMethodCount: 0, policyFilled: false });
    expect(r.ready).toBe(false);
    expect(r.items.filter((x) => !x.ok).map((x) => x.key)).toEqual(["currency_rate", "gateway", "policy"]);
  });
  it("needs no rate when the market uses the store currency", () => {
    expect(marketReadiness({ ...ok, currency: "INR", fxRate: null }).items[0]!.ok).toBe(true);
  });
  it("never blocks the base market", () => {
    expect(marketReadiness({ ...ok, isBase: true, fxRate: null, paymentMethodCount: 0, shippingRateCount: 0, policyFilled: false, taxChoiceAcknowledged: false }).ready).toBe(true);
  });
});
