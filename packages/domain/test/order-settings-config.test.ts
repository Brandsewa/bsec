import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDER_PROCESSING_CONFIG,
  parseOrderProcessingConfig,
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
