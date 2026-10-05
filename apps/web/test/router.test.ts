import { describe, expect, it, vi } from "vitest";

// Mock server-only module for vitest execution
vi.mock("server-only", () => ({}));
process.env.DATABASE_URL_RW = process.env.DATABASE_URL_RW ?? "postgres://x:y@127.0.0.1:1/none";

describe("Store Router", () => {
  // First import of api.ts builds the oRPC OpenAPI schema for the whole router (admin +
  // platform contracts) and pulls in the full Better Auth/Hono/Drizzle import graph. That's
  // consistently slower than vitest's 5s default on a cold, uncached CI runner (not a hang —
  // see the connectionTimeoutMillis fix in packages/db for the actual "DB unreachable" case).
  it(
    "imports and defines system and admin routes",
    async () => {
      const { storeRouter } = await import("../src/server/api.ts");
      expect(storeRouter.system.health).toBeDefined();
      expect(storeRouter.admin.memberships.list).toBeDefined();
      expect(storeRouter.admin.memberships.invite).toBeDefined();
      expect(storeRouter.admin.settings.get).toBeDefined();
      expect(storeRouter.admin.settings.update).toBeDefined();
      expect(storeRouter.admin.featureFlags.list).toBeDefined();

      // M2 Catalog
      expect(storeRouter.admin.products.list).toBeDefined();
      expect(storeRouter.admin.products.get).toBeDefined();
      expect(storeRouter.admin.products.create).toBeDefined();
      expect(storeRouter.admin.products.update).toBeDefined();
      expect(storeRouter.admin.products.delete).toBeDefined();
      expect(storeRouter.admin.variants.update).toBeDefined();
      expect(storeRouter.admin.categories.list).toBeDefined();
      expect(storeRouter.admin.categories.create).toBeDefined();
      expect(storeRouter.admin.categories.update).toBeDefined();
      expect(storeRouter.admin.categories.delete).toBeDefined();
      expect(storeRouter.admin.collections.list).toBeDefined();
      expect(storeRouter.admin.collections.get).toBeDefined();
      expect(storeRouter.admin.collections.create).toBeDefined();
      expect(storeRouter.admin.collections.update).toBeDefined();
      expect(storeRouter.admin.collections.delete).toBeDefined();
      expect(storeRouter.admin.brands.list).toBeDefined();
      expect(storeRouter.admin.brands.create).toBeDefined();
      expect(storeRouter.admin.brands.update).toBeDefined();
      expect(storeRouter.admin.brands.delete).toBeDefined();

      // M2 Inventory & Media
      expect(storeRouter.admin.inventory.list).toBeDefined();
      expect(storeRouter.admin.inventory.adjust).toBeDefined();
      expect(storeRouter.admin.media.list).toBeDefined();
      expect(storeRouter.admin.media.requestUpload).toBeDefined();
      expect(storeRouter.admin.media.create).toBeDefined();
      expect(storeRouter.admin.media.delete).toBeDefined();

      // M2 Branding, Theme, Content
      expect(storeRouter.admin.branding.get).toBeDefined();
      expect(storeRouter.admin.branding.update).toBeDefined();
      expect(storeRouter.admin.branding.publish).toBeDefined();
      expect(storeRouter.admin.themes.get).toBeDefined();
      expect(storeRouter.admin.themes.update).toBeDefined();
      expect(storeRouter.admin.pages.list).toBeDefined();
      expect(storeRouter.admin.pages.get).toBeDefined();
      expect(storeRouter.admin.pages.create).toBeDefined();
      expect(storeRouter.admin.pages.update).toBeDefined();
      expect(storeRouter.admin.pages.saveDraft).toBeDefined();
      expect(storeRouter.admin.pages.publish).toBeDefined();
      expect(storeRouter.admin.pages.rollback).toBeDefined();
      expect(storeRouter.admin.menus.list).toBeDefined();
      expect(storeRouter.admin.menus.get).toBeDefined();
      expect(storeRouter.admin.menus.create).toBeDefined();
      expect(storeRouter.admin.menus.update).toBeDefined();
      expect(storeRouter.admin.menus.delete).toBeDefined();
    },
    60_000,
  );

  it(
    "handles requests via Hono api instance",
    async () => {
      const { api } = await import("../src/server/api.ts");
      const res = await api.request("/api/admin/memberships");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.get("x-request-id")).toBeDefined();
    },
    20_000,
  );
});
