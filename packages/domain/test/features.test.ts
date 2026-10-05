import { describe, expect, it } from "vitest";
import { isFeatureEnabled, FeatureDisabledError } from "../src/features.ts";
import type { Db } from "@bs/db";

describe("isFeatureEnabled()", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";

  function createMockDb(overrides: {
    tenantOverride?: { enabled: boolean } | undefined;
    featureFlag?: { defaultOn: boolean; killSwitch: boolean } | undefined;
  }) {
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
      execute: async () => {},
      query: {
        tenantFeatureOverrides: {
          findFirst: async () => overrides.tenantOverride,
        },
        featureFlags: {
          findFirst: async () => overrides.featureFlag,
        },
      },
    };
    return db as unknown as Db;
  }

  it("prioritizes tenant-level override when present", async () => {
    const mockDb = createMockDb({
      tenantOverride: { enabled: true },
      featureFlag: { defaultOn: false, killSwitch: false },
    });

    const enabled = await isFeatureEnabled(mockDb, tenantId, "beta_checkout");
    expect(enabled).toBe(true);
  });

  it("falls back to global default_on when no tenant override exists", async () => {
    const mockDb = createMockDb({
      tenantOverride: undefined,
      featureFlag: { defaultOn: true, killSwitch: false },
    });

    const enabled = await isFeatureEnabled(mockDb, tenantId, "reviews");
    expect(enabled).toBe(true);
  });

  it("returns false if kill_switch is active on the feature flag", async () => {
    const mockDb = createMockDb({
      tenantOverride: { enabled: true },
      featureFlag: { defaultOn: true, killSwitch: true },
    });

    const enabled = await isFeatureEnabled(mockDb, tenantId, "payment_gateway");
    expect(enabled).toBe(false);
  });

  it("returns false when feature flag is not found", async () => {
    const mockDb = createMockDb({
      tenantOverride: undefined,
      featureFlag: undefined,
    });

    const enabled = await isFeatureEnabled(mockDb, tenantId, "nonexistent");
    expect(enabled).toBe(false);
  });

  it("exports FeatureDisabledError with statusCode 503 and featureKey", () => {
    const err = new FeatureDisabledError("checkout", "Checkout is disabled");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(503);
    expect(err.featureKey).toBe("checkout");
    expect(err.message).toBe("Checkout is disabled");
    expect(err.name).toBe("FeatureDisabledError");
  });

  it("handles settings rebuild flags with default off, override, and kill switch", async () => {
    const settingsFlags = [
      "settings.gst_v2",
      "settings.policies",
      "settings.customer_accounts",
      "settings.notifications",
      "settings.storage",
      "settings.maintenance",
    ];

    for (const flagKey of settingsFlags) {
      // 1. Default off (no tenant override)
      const defaultOffDb = createMockDb({
        tenantOverride: undefined,
        featureFlag: { defaultOn: false, killSwitch: false },
      });
      expect(await isFeatureEnabled(defaultOffDb, tenantId, flagKey)).toBe(false);

      // 2. Tenant override to true
      const enabledDb = createMockDb({
        tenantOverride: { enabled: true },
        featureFlag: { defaultOn: false, killSwitch: false },
      });
      expect(await isFeatureEnabled(enabledDb, tenantId, flagKey)).toBe(true);

      // 3. Kill switch overrides tenant override
      const killedDb = createMockDb({
        tenantOverride: { enabled: true },
        featureFlag: { defaultOn: false, killSwitch: true },
      });
      expect(await isFeatureEnabled(killedDb, tenantId, flagKey)).toBe(false);
    }
  });
});

