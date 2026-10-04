import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  parseCheckoutSettings,
} from "../src/admin/checkout-config.ts";

describe("parseCheckoutSettings", () => {
  it("returns clean defaults for null or empty object", () => {
    const fromNull = parseCheckoutSettings(null);
    expect(fromNull).toEqual(DEFAULT_CHECKOUT_SETTINGS);

    const fromEmpty = parseCheckoutSettings({});
    expect(fromEmpty).toEqual(DEFAULT_CHECKOUT_SETTINGS);

    expect(fromNull.v).toBe(1);
    expect(fromNull.guestCheckout).toBe(true);
    expect(fromNull.accountCreation).toBe("after_completed_order");
    expect(fromNull.phoneRequired).toBe(true);
    expect(fromNull.addressLine2).toBe("optional");
    expect(fromNull.companyName).toBe("hidden");
    expect(fromNull.marketingEmail.enabled).toBe(false);
    expect(fromNull.marketingEmail.label).toBe("Keep me updated on news and exclusive offers");
    expect(fromNull.abandoned.detectAfterMinutes).toBe(60);
    expect(fromNull.abandoned.recoveryEnabled).toBe(false);
    expect(fromNull.abandoned.steps).toEqual([]);
  });

  it("parses valid partial settings and keeps defaults for omitted keys", () => {
    const parsed = parseCheckoutSettings({
      guestCheckout: false,
      addressLine2: "hidden",
      marketingEmail: {
        enabled: true,
        label: "Get 10% off updates",
      },
    });

    expect(parsed.guestCheckout).toBe(false);
    expect(parsed.addressLine2).toBe("hidden");
    expect(parsed.marketingEmail.enabled).toBe(true);
    expect(parsed.marketingEmail.label).toBe("Get 10% off updates");
    // defaults for untouched fields
    expect(parsed.phoneRequired).toBe(true);
    expect(parsed.abandoned.detectAfterMinutes).toBe(60);
  });

  it("clamps and validates abandoned checkout settings", () => {
    // Under minimum (15 min) -> clamped to 15
    const clampedLow = parseCheckoutSettings({
      abandoned: { detectAfterMinutes: 5, recoveryEnabled: true, steps: [] },
    });
    expect(clampedLow.abandoned.detectAfterMinutes).toBe(15);
    expect(clampedLow.abandoned.recoveryEnabled).toBe(true);

    // Over maximum (10080 min = 7 days) -> clamped to 10080
    const clampedHigh = parseCheckoutSettings({
      abandoned: { detectAfterMinutes: 99999, recoveryEnabled: false, steps: [] },
    });
    expect(clampedHigh.abandoned.detectAfterMinutes).toBe(10080);

    // Limits steps to at most 3
    const withSteps = parseCheckoutSettings({
      abandoned: {
        detectAfterMinutes: 120,
        recoveryEnabled: true,
        steps: [{ delayHours: 1 }, { delayHours: 6 }, { delayHours: 24 }, { delayHours: 48 }],
      },
    });
    expect(withSteps.abandoned.steps).toHaveLength(3);
    expect(withSteps.abandoned.steps[0]?.delayHours).toBe(1);
    expect(withSteps.abandoned.steps[2]?.delayHours).toBe(24);
  });

  it("sanitizes marketing email label length", () => {
    const tooLong = "A".repeat(200);
    const parsed = parseCheckoutSettings({
      marketingEmail: { enabled: true, label: tooLong },
    });
    expect(parsed.marketingEmail.label.length).toBeLessThanOrEqual(120);
  });
});
