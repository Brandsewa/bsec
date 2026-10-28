import { describe, expect, it } from "vitest";
import {
  draftsFromSettings,
  draftsToPayload,
  emptyZone,
} from "../src/lib/shipping-draft.ts";
import type { ShippingSettings } from "@bs/contracts";

describe("shipping-draft with multi-market and units", () => {
  it("converts between stored grams and market imperial units (lb)", () => {
    const settings: ShippingSettings = {
      zones: [
        {
          id: "zone-us-1",
          name: "US Continental",
          marketId: "market-us-1",
          countries: ["US"],
          states: [],
          isDefault: true,
          rates: [
            {
              id: "rate-1",
              name: "Standard Ground",
              method: "standard",
              rateType: "weight_tier",
              pricePaise: 999, // $9.99
              minWeightGrams: 454, // 1 lb
              maxWeightGrams: 2268, // 5 lb
              minDays: 3,
              maxDays: 5,
            },
          ],
        },
      ],
    };

    // Parse from settings into drafts using imperial (lb) for the US market
    const drafts = draftsFromSettings(settings, (marketId) => (marketId === "market-us-1" ? "lb" : "g"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.marketId).toBe("market-us-1");
    expect(drafts[0]!.rates[0]!.minWeight).toBe("1.001"); // 454 g -> 1.001 lb
    expect(drafts[0]!.rates[0]!.maxWeight).toBe("5"); // 2268 g -> 5 lb
    expect(drafts[0]!.rates[0]!.price).toBe("9.99");

    // Convert draft back to payload (e.g. typing 1 lb)
    drafts[0]!.rates[0]!.minWeight = "1";
    const { payload, error } = draftsToPayload(drafts, (marketId) => (marketId === "market-us-1" ? "lb" : "g"));
    expect(error).toBeNull();
    expect(payload).not.toBeNull();
    const zonePayload = payload!.zones[0]!;
    expect(zonePayload.marketId).toBe("market-us-1");
    expect(zonePayload.rates[0]!.pricePaise).toBe(999);
    // 1 lb entered converts back to 454 g
    expect(zonePayload.rates[0]!.minWeightGrams).toBe(454);
    // 5 lb entered converts back to 2268 g
    expect(zonePayload.rates[0]!.maxWeightGrams).toBe(2268);
  });

  it("handles default metric zones with whole grams", () => {
    const zone = emptyZone("India Domestic", "market-in-1");
    zone.isDefault = true;
    zone.rates[0]!.rateType = "weight_tier";
    zone.rates[0]!.price = "50";
    zone.rates[0]!.minWeight = "500";
    zone.rates[0]!.maxWeight = "1500";

    const { payload, error } = draftsToPayload([zone], () => "g");
    expect(error).toBeNull();
    expect(payload!.zones[0]!.rates[0]!.minWeightGrams).toBe(500);
    expect(payload!.zones[0]!.rates[0]!.maxWeightGrams).toBe(1500);
    expect(payload!.zones[0]!.rates[0]!.pricePaise).toBe(5000);
  });
});
