import { describe, expect, it } from "vitest";
import { buildMerchantReturnPolicyJsonLd, buildReviewsJsonLd, buildShippingDetailsJsonLd, type StorefrontShippingRules } from "../src/storefront/seo-offers.ts";
import { generateProductJsonLd } from "../src/storefront/seo.ts";
import type { StorefrontProductDetail } from "../src/storefront/catalog.ts";

const rate = (o: Partial<StorefrontShippingRules["rates"][number]>): StorefrontShippingRules["rates"][number] => ({
  name: "Standard",
  method: "standard",
  rateType: "flat",
  pricePaise: 9900,
  thresholdPaise: null,
  minSubtotalPaise: null,
  maxSubtotalPaise: null,
  minWeightGrams: null,
  maxWeightGrams: null,
  minDays: 3,
  maxDays: 6,
  ...o,
});

describe("buildMerchantReturnPolicyJsonLd", () => {
  it("publishes a finite window with the configured days", () => {
    expect(buildMerchantReturnPolicyJsonLd({ acceptReturns: true, returnWindowDays: 10, country: "IN" })).toEqual({
      "@type": "MerchantReturnPolicy",
      applicableCountry: "IN",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 10,
    });
  });
  it("says returns are not permitted when the store accepts none, and nothing without a country", () => {
    expect(buildMerchantReturnPolicyJsonLd({ acceptReturns: false, returnWindowDays: 7, country: "IN" })).toMatchObject({ returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" });
    expect(buildMerchantReturnPolicyJsonLd({ acceptReturns: true, returnWindowDays: 7, country: "" })).toBeNull();
    expect(buildMerchantReturnPolicyJsonLd(undefined)).toBeNull();
  });
});

describe("buildShippingDetailsJsonLd", () => {
  const rules: StorefrontShippingRules = { countries: ["IN"], rates: [rate({ pricePaise: 9900, thresholdPaise: 100000, rateType: "free_above_threshold" })] };

  it("prices shipping in major units with the destination and transit time", () => {
    const [d] = buildShippingDetailsJsonLd(rules, { subtotalPaise: 63700, currency: "INR" });
    expect(d).toMatchObject({
      "@type": "OfferShippingDetails",
      shippingRate: { value: 99, currency: "INR" },
      shippingDestination: [{ "@type": "DefinedRegion", addressCountry: "IN" }],
      deliveryTime: { transitTime: { minValue: 3, maxValue: 6, unitCode: "DAY" } },
    });
  });

  it("is free once the product price reaches the free-shipping threshold, like checkout", () => {
    const [d] = buildShippingDetailsJsonLd(rules, { subtotalPaise: 120000, currency: "INR" });
    expect(d).toMatchObject({ shippingRate: { value: 0 } });
  });

  it("offers each method once, at its cheapest applicable rule", () => {
    const two: StorefrontShippingRules = { countries: ["IN"], rates: [rate({}), rate({ pricePaise: 4900, thresholdPaise: 50000, rateType: "free_above_threshold", name: "Offer" }), rate({ method: "express", name: "Express", pricePaise: 19900 })] };
    const out = buildShippingDetailsJsonLd(two, { subtotalPaise: 60000, currency: "INR" });
    expect(out.map((o) => (o as { shippingRate: { value: number } }).shippingRate.value).sort((a, b) => a - b)).toEqual([0, 199]);
  });

  it("leaves weight-based rules out when the weight is unknown, and publishes nothing without rules", () => {
    const w: StorefrontShippingRules = { countries: ["IN"], rates: [rate({ rateType: "weight_tier", minWeightGrams: 0, maxWeightGrams: 500 })] };
    expect(buildShippingDetailsJsonLd(w, { subtotalPaise: 1000, weightGrams: null, currency: "INR" })).toEqual([]);
    expect(buildShippingDetailsJsonLd(w, { subtotalPaise: 1000, weightGrams: 200, currency: "INR" })).toHaveLength(1);
    expect(buildShippingDetailsJsonLd(undefined, { subtotalPaise: 1000, currency: "INR" })).toEqual([]);
  });
});

describe("buildReviewsJsonLd", () => {
  it("maps reviews and caps them at five", () => {
    const reviews = Array.from({ length: 7 }, (_, i) => ({ author: `A${i}`, rating: 5, title: i === 0 ? "Great" : null, body: "Lovely", createdAt: "2026-11-01T10:00:00.000Z" }));
    const out = buildReviewsJsonLd(reviews);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ "@type": "Review", name: "Great", datePublished: "2026-11-01", reviewRating: { ratingValue: 5, bestRating: 5 } });
    expect(out[1]).not.toHaveProperty("name");
  });
});

describe("generateProductJsonLd with offer extras", () => {
  const product = {
    id: "p1",
    slug: "tea",
    title: "Tea",
    priceOnRequest: false,
    ratingAvg: "4.5",
    ratingCount: 3,
    media: [],
    variants: [{ id: "v1", sku: "T1", price: 63700, stockStatus: "in_stock", weightGrams: 250 }],
  } as unknown as StorefrontProductDetail;
  const extras = {
    returnPolicy: { acceptReturns: true, returnWindowDays: 7, country: "IN" },
    shipping: { countries: ["IN"], rates: [rate({})] },
    reviews: [{ author: "Asha", rating: 5, title: null, body: "Good", createdAt: "2026-11-01T00:00:00.000Z" }],
  };

  it("adds return policy and shipping to each offer and reviews beside a real rating", () => {
    const ld = generateProductJsonLd(product, "https://r.com", "INR", { extras });
    const offer = ld.offers?.[0] as Record<string, unknown>;
    expect(offer["hasMerchantReturnPolicy"]).toMatchObject({ merchantReturnDays: 7 });
    expect(offer["shippingDetails"]).toMatchObject({ shippingRate: { value: 99 } });
    expect(ld["review"]).toHaveLength(1);
  });

  it("adds nothing when the store configured nothing", () => {
    const ld = generateProductJsonLd(product, "https://r.com", "INR", {});
    const offer = ld.offers?.[0] as Record<string, unknown>;
    expect(offer).not.toHaveProperty("hasMerchantReturnPolicy");
    expect(offer).not.toHaveProperty("shippingDetails");
    expect(ld).not.toHaveProperty("review");
  });

  it("does not publish reviews without a rating count", () => {
    const ld = generateProductJsonLd({ ...product, ratingCount: 0 } as unknown as StorefrontProductDetail, "https://r.com", "INR", { extras });
    expect(ld).not.toHaveProperty("review");
  });
});
