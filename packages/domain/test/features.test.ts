import { describe, expect, it } from "vitest";
import { isFeatureEnabled } from "../src/features.ts";
import type { Db } from "@bs/db";

describe("isFeatureEnabled()", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";

  it("prioritizes tenant-level override when present", async () => {
    const mockDb = {
      query: {
        tenantFeatureOverrides: {
          findFirst: async () => ({ enabled: true }),
        },
        featureFlags: {
          findFirst: async () => ({ defaultOn: false, killSwitch: false }),
        },
      },
    } as unknown as Db;

    const enabled = await isFeatureEnabled(mockDb, tenantId, "beta_checkout");
    expect(enabled).toBe(true);
  });

  it("falls back to global default_on when no tenant override exists", async () => {
    const mockDb = {
      query: {
        tenantFeatureOverrides: {
          findFirst: async () => undefined,
        },
        featureFlags: {
          findFirst: async () => ({ defaultOn: true, killSwitch: false }),
        },
      },
    } as unknown as Db;

    const enabled = await isFeatureEnabled(mockDb, tenantId, "reviews");
    expect(enabled).toBe(true);
  });

  it("returns false if kill_switch is active on the feature flag", async () => {
    const mockDb = {
      query: {
        tenantFeatureOverrides: {
          findFirst: async () => ({ enabled: true }),
        },
        featureFlags: {
          findFirst: async () => ({ defaultOn: true, killSwitch: true }),
        },
      },
    } as unknown as Db;

    const enabled = await isFeatureEnabled(mockDb, tenantId, "payment_gateway");
    expect(enabled).toBe(false);
  });

  it("returns false when feature flag is not found", async () => {
    const mockDb = {
      query: {
        tenantFeatureOverrides: {
          findFirst: async () => undefined,
        },
        featureFlags: {
          findFirst: async () => undefined,
        },
      },
    } as unknown as Db;

    const enabled = await isFeatureEnabled(mockDb, tenantId, "nonexistent");
    expect(enabled).toBe(false);
  });
});
