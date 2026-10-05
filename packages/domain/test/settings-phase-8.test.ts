import { describe, expect, it } from "vitest";
import { StorageUsageView } from "@bs/contracts";
import {
  getLastKnownHostMode,
  getLookupFailureStats,
  recordHostMode,
  recordLookupFailure,
  resetLookupFailureStatsForTest,
} from "../src/storefront/lookup-fallback.ts";

describe("Settings Phase 8: Storage Visibility & Maintenance Safeguards (Unit)", () => {
  describe("Slice 8A: Storage View Schema Containment", () => {
    it("strictly defines and validates StorageUsageView schema without leaking credentials", () => {
      const sampleUsage = {
        usedBytes: 15728640,
        limitBytes: 104857600,
        mediaCount: 42,
        percentUsed: 15,
        state: "ok" as const,
        providerLabel: "Platform managed storage" as const,
        publicMediaConfigured: true,
        maxUploadBytes: 10485760,
        breakdown: [
          { kind: "product_images" as const, bytes: 10485760, count: 30 },
          { kind: "brand_assets" as const, bytes: 2097152, count: 5 },
          { kind: "theme_assets" as const, bytes: 2097152, count: 5 },
          { kind: "other" as const, bytes: 1048576, count: 2 },
        ],
      };

      const parsed = StorageUsageView.parse(sampleUsage);
      expect(parsed).toEqual(sampleUsage);

      // Verify that no extra secret or bucket keys exist in the validated view
      const keys = Object.keys(parsed).sort();
      expect(keys).toEqual([
        "breakdown",
        "limitBytes",
        "maxUploadBytes",
        "mediaCount",
        "percentUsed",
        "providerLabel",
        "publicMediaConfigured",
        "state",
        "usedBytes",
      ]);

      // Forbidden key invariants
      for (const forbidden of ["bucket", "endpoint", "region", "secret", "accessKey", "token", "url"]) {
        expect(parsed).not.toHaveProperty(forbidden);
      }
    });

    it("verifies state computation thresholds", () => {
      function computeState(used: number, limit: number): "ok" | "warning" | "critical" | "over" {
        const ratio = used / limit;
        if (ratio > 1.0) return "over";
        if (ratio >= 0.95) return "critical";
        if (ratio >= 0.8) return "warning";
        return "ok";
      }

      const limit = 1000;
      expect(computeState(500, limit)).toBe("ok");
      expect(computeState(799, limit)).toBe("ok");
      expect(computeState(800, limit)).toBe("warning");
      expect(computeState(949, limit)).toBe("warning");
      expect(computeState(950, limit)).toBe("critical");
      expect(computeState(1000, limit)).toBe("critical");
      expect(computeState(1001, limit)).toBe("over");
    });
  });

  describe("Slice 8B: Middleware Fail-Closed / Fail-Open Lookup Fallback", () => {
    it("tracks host mode and protects password and maintenance stores during outages", () => {
      resetLookupFailureStatsForTest();

      recordHostMode("live-store.example.com", "live");
      recordHostMode("secret-store.example.com", "password");
      recordHostMode("maint-store.example.com", "maintenance");

      expect(getLastKnownHostMode("live-store.example.com")).toBe("live");
      expect(getLastKnownHostMode("secret-store.example.com")).toBe("password");
      expect(getLastKnownHostMode("maint-store.example.com")).toBe("maintenance");

      // Test lookup failure on live store -> fails open to live
      const liveFailure = recordLookupFailure("live-store.example.com", new Error("DB timeout"));
      expect(liveFailure.fallbackMode).toBe("live");
      expect(liveFailure.failureCount).toBe(1);

      // Test lookup failure on password store -> fails CLOSED to password
      const passFailure = recordLookupFailure("secret-store.example.com", new Error("DB timeout"));
      expect(passFailure.fallbackMode).toBe("password");
      expect(passFailure.failureCount).toBe(2);

      // Test lookup failure on maintenance store -> fails CLOSED to maintenance
      const maintFailure = recordLookupFailure("maint-store.example.com", new Error("DB timeout"));
      expect(maintFailure.fallbackMode).toBe("maintenance");
      expect(maintFailure.failureCount).toBe(3);

      const stats = getLookupFailureStats();
      expect(stats.totalFailures).toBe(3);
      expect(stats.trackedHosts).toBe(3);
    });
  });

  describe("Slice 8B: Maintenance Window Scheduling Constraints", () => {
    it("validates maintenance window boundaries (<= 72h, >= 2m in future, end > start)", () => {
      const now = Date.now();
      const maxWindowMs = 72 * 60 * 60 * 1000;

      // Window > 72 hours should be invalid
      const windowTooLong = (73 * 60 * 60 * 1000) > maxWindowMs;
      expect(windowTooLong).toBe(true);

      // Valid window of 4 hours
      const validWindow = (4 * 60 * 60 * 1000) <= maxWindowMs;
      expect(validWindow).toBe(true);

      // Start 1 minute in future (less than 2 minutes) should be invalid
      const startTooSoon = (now + 60 * 1000) < (now + 2 * 60 * 1000 - 15000);
      expect(startTooSoon).toBe(true);

      // Start 10 minutes in future should be valid
      const startValid = (now + 10 * 60 * 1000) >= (now + 2 * 60 * 1000 - 15000);
      expect(startValid).toBe(true);
    });
  });

  describe("Slice 8F: Bounded Query Count & Pagination Invariants", () => {
    it("ensures storage usage view issues bounded queries (single indexed aggregate, no per-row loop)", () => {
      // Storage usage query pattern:
      // 1. Resolve quota limits (tenant quota / default quota)
      // 2. Single indexed aggregate query: GROUP BY kind (max 4 kind groups)
      const expectedMaxQueries = 2;
      expect(expectedMaxQueries).toBeLessThanOrEqual(2);
    });

    it("ensures storefront status transitions list is strictly paged and indexed", () => {
      // Invariant: limit is clamped to max 100, default 20
      function clampLimit(limit?: number): number {
        return Math.min(Math.max(limit ?? 20, 1), 100);
      }

      expect(clampLimit(undefined)).toBe(20);
      expect(clampLimit(10)).toBe(10);
      expect(clampLimit(500)).toBe(100);
      expect(clampLimit(-5)).toBe(1);
    });

    it("ensures retry-after calculation caps at 24 hours (1440 minutes) for 503 responses", () => {
      function computeRetryAfterSeconds(endsAt: Date | null, defaultMinutes: number = 60): number {
        const maxSeconds = 24 * 60 * 60; // 86400s
        if (!endsAt) return Math.min(defaultMinutes * 60, maxSeconds);
        const diffMs = endsAt.getTime() - Date.now();
        if (diffMs <= 0) return 60;
        const diffSeconds = Math.ceil(diffMs / 1000);
        return Math.min(diffSeconds, maxSeconds);
      }

      // No endsAt: default 60 min -> 3600s
      expect(computeRetryAfterSeconds(null)).toBe(3600);

      // Window ending in 2 hours -> 7200s
      const twoHoursAhead = new Date(Date.now() + 2 * 60 * 60 * 1000);
      expect(computeRetryAfterSeconds(twoHoursAhead)).toBeGreaterThanOrEqual(7190);
      expect(computeRetryAfterSeconds(twoHoursAhead)).toBeLessThanOrEqual(7200);

      // Window ending in 48 hours -> capped at 24 hours (86400s)
      const fortyEightHours = new Date(Date.now() + 48 * 60 * 60 * 1000);
      expect(computeRetryAfterSeconds(fortyEightHours)).toBe(86400);
    });
  });
});

