import { describe, expect, it, vi } from "vitest";

// Mock server-only module for vitest execution
vi.mock("server-only", () => ({}));

describe("Store Router", () => {
  it("imports and defines system and admin routes", async () => {
    const { storeRouter } = await import("../src/server/api.ts");
    expect(storeRouter.system.health).toBeDefined();
    expect(storeRouter.admin.memberships.list).toBeDefined();
    expect(storeRouter.admin.memberships.invite).toBeDefined();
    expect(storeRouter.admin.settings.get).toBeDefined();
    expect(storeRouter.admin.settings.update).toBeDefined();
    expect(storeRouter.admin.featureFlags.list).toBeDefined();
  });
});
