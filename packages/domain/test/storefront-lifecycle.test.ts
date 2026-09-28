import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@bs/db";
import {
  evaluateStorefrontAccess,
  hashBypassToken,
  hashStorePassword,
  invalidateHostCache,
  resolveHostToTenant,
  verifyBypassToken,
  verifyStorePassword,
} from "../src/index.ts";

describe("Storefront Lifecycle & Host Resolution", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";
  const host = "store.gobs.cloud";

  beforeEach(() => {
    invalidateHostCache();
  });

  // Helper to create mock database for storefront lifecycle testing
  function createLifecycleMockDb(options: {
    domain?: { tenantId: string; domainStatus: string; tenantStatus: string } | null;
    storeStatus?: {
      mode?: string;
      headline?: string | null;
      launchAt?: Date | null;
      showCountdown?: boolean;
      collectEmails?: boolean;
      passwordHash?: string | null;
      retryAfterMinutes?: number;
      bypassTokenHash?: string | null;
    } | null;
    seoSettings?: {
      indexingEnabled?: boolean;
    } | null;
  }) {
    return {
      select: (_fields?: unknown) => ({
        from: (table: unknown) => {
          // If selecting with innerJoin (domains + tenants)
          return {
            innerJoin: () => ({
              where: () => ({
                limit: async () => {
                  if (options.domain) return [options.domain];
                  return [];
                },
              }),
            }),
            where: () => ({
              limit: async () => {
                // Determine if querying storeStatus or seoSettings
                // In Drizzle, table name or structure can be inspected
                if (table === schema.seoSettings) {
                  if (options.seoSettings) {
                    return [
                      {
                        indexingEnabled: options.seoSettings.indexingEnabled ?? true,
                      },
                    ];
                  }
                  return [];
                }
                // Default to storeStatus
                if (options.storeStatus) {
                  return [
                    {
                      mode: options.storeStatus.mode ?? "coming_soon",
                      headline: options.storeStatus.headline ?? null,
                      launchAt: options.storeStatus.launchAt ?? null,
                      showCountdown: options.storeStatus.showCountdown ?? false,
                      collectEmails: options.storeStatus.collectEmails ?? true,
                      passwordHash: options.storeStatus.passwordHash ?? null,
                      retryAfterMinutes: options.storeStatus.retryAfterMinutes ?? 60,
                      bypassTokenHash: options.storeStatus.bypassTokenHash ?? null,
                    },
                  ];
                }
                return [];
              },
            }),
          };
        },
      }),
    } as unknown as Db;
  }

  describe("resolveHostToTenant()", () => {
    it("returns { tenantId, tenantStatus } for active domain and tenant", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "active",
        },
      });

      const res = await resolveHostToTenant(mockDb, host);
      expect(res).toEqual({ tenantId, tenantStatus: "active" });
    });

    it("returns null for unknown domain", async () => {
      const mockDb = createLifecycleMockDb({ domain: null });
      const res = await resolveHostToTenant(mockDb, "unknown.gobs.cloud");
      expect(res).toBeNull();
    });

    it("returns null for inactive domain status", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "pending",
          tenantStatus: "active",
        },
      });
      const res = await resolveHostToTenant(mockDb, host);
      expect(res).toBeNull();
    });

    it("returns { tenantId, tenantStatus } even when tenant is suspended or provisioning", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "suspended",
        },
      });
      const res = await resolveHostToTenant(mockDb, host);
      expect(res).toEqual({ tenantId, tenantStatus: "suspended" });
    });
  });

  describe("evaluateStorefrontAccess() - Tenant Lifecycle", () => {
    it("returns 404 for unknown host", async () => {
      const mockDb = createLifecycleMockDb({ domain: null });
      const access = await evaluateStorefrontAccess(mockDb, "nonexistent.gobs.cloud");

      expect(access.allowed).toBe(false);
      expect(access.httpStatus).toBe(404);
      expect(access.reason).toBe("not_found");
    });

    it("returns 503 provisioning for tenant.status === 'provisioning'", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "provisioning",
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.httpStatus).toBe(503);
      expect(access.reason).toBe("provisioning");
      expect(access.message).toMatch(/provisioning|provisioned/i);
    });

    it("returns 503 suspended for tenant.status === 'suspended'", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "suspended",
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.httpStatus).toBe(503);
      expect(access.reason).toBe("suspended");
      expect(access.message).toMatch(/temporarily unavailable/i);
    });

    it("returns 404 not found for tenant.status === 'archived'", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "archived",
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.httpStatus).toBe(404);
      expect(access.reason).toBe("not_found");
    });

    it("returns 404 not found for tenant.status === 'deleted' or 'deletion_requested'", async () => {
      const mockDb = createLifecycleMockDb({
        domain: {
          tenantId,
          domainStatus: "active",
          tenantStatus: "deleted",
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.httpStatus).toBe(404);
      expect(access.reason).toBe("not_found");
    });
  });

  describe("evaluateStorefrontAccess() - Store Status Modes for Active Tenant", () => {
    it("returns allowed: true, httpStatus: 200 for mode 'live'", async () => {
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: { mode: "live" },
        seoSettings: { indexingEnabled: true },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(true);
      expect(access.httpStatus).toBe(200);
      expect(access.mode).toBe("live");
      expect(access.noindex).toBe(false);
    });

    it("returns allowed: false, reason: 'coming_soon', httpStatus: 200, noindex: true for mode 'coming_soon'", async () => {
      const launchAt = new Date("2026-10-01T00:00:00Z");
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "coming_soon",
          headline: "Launching Soon!",
          launchAt,
          showCountdown: true,
          collectEmails: true,
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe("coming_soon");
      expect(access.httpStatus).toBe(200);
      expect(access.noindex).toBe(true);
      expect(access.headline).toBe("Launching Soon!");
      expect(access.launchAt).toEqual(launchAt);
      expect(access.showCountdown).toBe(true);
      expect(access.collectEmails).toBe(true);
    });

    it("defaults to mode 'coming_soon' if store_status is not configured", async () => {
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: null,
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe("coming_soon");
      expect(access.httpStatus).toBe(200);
      expect(access.noindex).toBe(true);
    });

    it("returns allowed: false, reason: 'maintenance', httpStatus: 503, retryAfterSeconds for mode 'maintenance'", async () => {
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "maintenance",
          retryAfterMinutes: 60,
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe("maintenance");
      expect(access.httpStatus).toBe(503);
      expect(access.retryAfterSeconds).toBe(3600);
    });

    it("handles mode 'password': prompts if password missing or incorrect", async () => {
      const passwordHash = await hashStorePassword("super-secret");
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "password",
          passwordHash,
        },
      });

      // No password provided
      const access1 = await evaluateStorefrontAccess(mockDb, host);
      expect(access1.allowed).toBe(false);
      expect(access1.reason).toBe("password_required");
      expect(access1.httpStatus).toBe(200);
      expect(access1.noindex).toBe(true);

      // Wrong password cookie
      const access2 = await evaluateStorefrontAccess(mockDb, host, {
        cookies: { bs_store_password: "wrong" },
      });
      expect(access2.allowed).toBe(false);
      expect(access2.reason).toBe("password_required");
    });

    it("handles mode 'password': unlocks when correct password cookie is provided", async () => {
      const plainPassword = "open-sesame-123";
      const passwordHash = await hashStorePassword(plainPassword);
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "password",
          passwordHash,
        },
      });

      // Provide plain password in bs_store_password cookie
      const access1 = await evaluateStorefrontAccess(mockDb, host, {
        cookies: { bs_store_password: plainPassword },
      });
      expect(access1.allowed).toBe(true);
      expect(access1.isPasswordUnlocked).toBe(true);
      expect(access1.httpStatus).toBe(200);

      // Provide cookie via headers
      const access2 = await evaluateStorefrontAccess(mockDb, host, {
        headers: { cookie: `bs_store_password=${plainPassword}` },
      });
      expect(access2.allowed).toBe(true);
      expect(access2.isPasswordUnlocked).toBe(true);
    });
  });

  describe("evaluateStorefrontAccess() - Bypass Handling", () => {
    it("staff session bypasses coming_soon, maintenance, and password", async () => {
      const mockDbComingSoon = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: { mode: "coming_soon" },
      });

      const access = await evaluateStorefrontAccess(mockDbComingSoon, host, {
        session: {
          user: { id: "staff-user-1" },
          type: "staff",
        },
      });

      expect(access.allowed).toBe(true);
      expect(access.isBypass).toBe(true);
      expect(access.httpStatus).toBe(200);
    });

    it("valid preview token via query param bypasses restricted modes", async () => {
      const token = "preview-token-secret-xyz";
      const tokenHash = hashBypassToken(token);

      const mockDbMaintenance = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "maintenance",
          bypassTokenHash: tokenHash,
        },
      });

      const access = await evaluateStorefrontAccess(mockDbMaintenance, host, {
        previewToken: token,
      });

      expect(access.allowed).toBe(true);
      expect(access.isBypass).toBe(true);
      expect(access.httpStatus).toBe(200);
    });

    it("valid preview token via bs_preview cookie bypasses restricted modes", async () => {
      const token = "preview-cookie-secret-abc";
      const tokenHash = hashBypassToken(token);

      const mockDbPassword = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "password",
          bypassTokenHash: tokenHash,
          passwordHash: "some-password-hash",
        },
      });

      const access = await evaluateStorefrontAccess(mockDbPassword, host, {
        cookies: { bs_preview: token },
      });

      expect(access.allowed).toBe(true);
      expect(access.isBypass).toBe(true);
      expect(access.httpStatus).toBe(200);
    });

    it("invalid preview token does NOT bypass", async () => {
      const tokenHash = hashBypassToken("legit-token");
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: {
          mode: "coming_soon",
          bypassTokenHash: tokenHash,
        },
      });

      const access = await evaluateStorefrontAccess(mockDb, host, {
        previewToken: "wrong-token",
      });

      expect(access.allowed).toBe(false);
      expect(access.isBypass).toBeFalsy();
      expect(access.reason).toBe("coming_soon");
    });
  });

  describe("evaluateStorefrontAccess() - SEO Policy", () => {
    it("sets noindex: true when indexing_enabled === false even in live mode", async () => {
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: { mode: "live" },
        seoSettings: { indexingEnabled: false },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(true);
      expect(access.httpStatus).toBe(200);
      expect(access.noindex).toBe(true);
    });

    it("sets noindex: false when indexing_enabled === true and mode is live", async () => {
      const mockDb = createLifecycleMockDb({
        domain: { tenantId, domainStatus: "active", tenantStatus: "active" },
        storeStatus: { mode: "live" },
        seoSettings: { indexingEnabled: true },
      });

      const access = await evaluateStorefrontAccess(mockDb, host);
      expect(access.allowed).toBe(true);
      expect(access.noindex).toBe(false);
    });
  });

  describe("Password and Bypass Token Crypto Helpers", () => {
    it("hashes and verifies store passwords", async () => {
      const password = "my-secret-store-password-2026";
      const hash = await hashStorePassword(password);

      expect(hash).not.toBe(password);
      expect(await verifyStorePassword(password, hash)).toBe(true);
      expect(await verifyStorePassword("wrong-password", hash)).toBe(false);
      expect(await verifyStorePassword("", hash)).toBe(false);
    });

    it("hashes and verifies preview bypass tokens", () => {
      const token = "preview-token-12345";
      const hash = hashBypassToken(token);

      expect(hash).not.toBe(token);
      expect(verifyBypassToken(token, hash)).toBe(true);
      expect(verifyBypassToken("wrong-token", hash)).toBe(false);
      expect(verifyBypassToken("", hash)).toBe(false);
    });
  });
});
