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
    },
    20_000,
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
