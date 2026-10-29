import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDER_PROCESSING_CONFIG,
  parseOrderProcessingConfig,
  parseTrackingConfig,
  carrierTrackingUrl,
  DEFAULT_TRACKING_CONFIG,
} from "../src/admin/order-settings-config.ts";

describe("parseOrderProcessingConfig", () => {
  it("returns default values for null or undefined input", () => {
    expect(parseOrderProcessingConfig(null)).toEqual(DEFAULT_ORDER_PROCESSING_CONFIG);
    expect(parseOrderProcessingConfig(undefined)).toEqual(DEFAULT_ORDER_PROCESSING_CONFIG);
    expect(DEFAULT_ORDER_PROCESSING_CONFIG.v).toBe(1);
    expect(DEFAULT_ORDER_PROCESSING_CONFIG.stockHoldMinutes).toBe(30);
    expect(DEFAULT_ORDER_PROCESSING_CONFIG.minimumOrderPaise).toBe(0);
  });

  it("parses valid config values", () => {
    const parsed = parseOrderProcessingConfig({
      v: 1,
      stockHoldMinutes: 45,
      minimumOrderPaise: 50000,
    });
    expect(parsed.stockHoldMinutes).toBe(45);
    expect(parsed.minimumOrderPaise).toBe(50000);
  });

  it("clamps stockHoldMinutes between 5 and 120", () => {
    const tooLow = parseOrderProcessingConfig({ stockHoldMinutes: 1 });
    expect(tooLow.stockHoldMinutes).toBe(5);

    const tooHigh = parseOrderProcessingConfig({ stockHoldMinutes: 999 });
    expect(tooHigh.stockHoldMinutes).toBe(120);
  });

  it("clamps minimumOrderPaise between 0 and 10_000_00", () => {
    const negative = parseOrderProcessingConfig({ minimumOrderPaise: -500 });
    expect(negative.minimumOrderPaise).toBe(0);

    const tooHigh = parseOrderProcessingConfig({ minimumOrderPaise: 99_999_999 });
    expect(tooHigh.minimumOrderPaise).toBe(10_000_00);
  });
});

describe("tracking config", () => {
  it("defaults when absent or malformed", () => {
    expect(parseTrackingConfig(null)).toEqual(DEFAULT_TRACKING_CONFIG);
    expect(parseTrackingConfig({ tracking: "x" })).toEqual(DEFAULT_TRACKING_CONFIG);
  });

  it("clamps and cleans what it reads", () => {
    const c = parseTrackingConfig({
      tracking: {
        enabled: false,
        lookup: "sms",
        estimatedDeliveryDays: 500,
        message: "m".repeat(400),
        carriers: [{ name: "  Bluedart ", urlTemplate: "javascript:alert(1)" }, { name: "", urlTemplate: "https://x.test/{awb}" }, { name: "DTDC", urlTemplate: "https://t.test/{awb}" }],
      },
    });
    expect(c.enabled).toBe(false);
    expect(c.lookup).toBe("either");
    expect(c.estimatedDeliveryDays).toBe(60);
    expect(c.message).toHaveLength(300);
    expect(c.carriers).toEqual([{ name: "Bluedart", urlTemplate: "" }, { name: "DTDC", urlTemplate: "https://t.test/{awb}" }]);
  });

  it("builds a carrier link only from an http(s) template and a number", () => {
    const carriers = [{ name: "DTDC", urlTemplate: "https://t.test/?n={awb}" }, { name: "None", urlTemplate: "" }];
    expect(carrierTrackingUrl(carriers, "dtdc", " A B1 ")).toBe("https://t.test/?n=A%20B1");
    expect(carrierTrackingUrl(carriers, "None", "123")).toBeNull();
    expect(carrierTrackingUrl(carriers, "DTDC", "")).toBeNull();
    expect(carrierTrackingUrl(carriers, "Other", "123")).toBeNull();
  });
});
