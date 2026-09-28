import { describe, expect, it } from "vitest";
import { platformContract, storeContract } from "../src/index.ts";

describe("Contracts", () => {
  describe("Admin contracts", () => {
    it("defines memberships procedures with route metadata", () => {
      expect(storeContract.admin.memberships.list).toBeDefined();
      expect(storeContract.admin.memberships.invite).toBeDefined();
    });

    it("defines settings get and update procedures", () => {
      expect(storeContract.admin.settings.get).toBeDefined();
      expect(storeContract.admin.settings.update).toBeDefined();
    });

    it("defines featureFlags list procedure", () => {
      expect(storeContract.admin.featureFlags.list).toBeDefined();
    });
  });

  describe("Platform contracts", () => {
    it("defines platform tenants list and get procedures", () => {
      expect(platformContract.tenants.list).toBeDefined();
      expect(platformContract.tenants.get).toBeDefined();
    });
  });
});
