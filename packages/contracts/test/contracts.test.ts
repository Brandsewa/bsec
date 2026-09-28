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

    it("defines catalog procedures (products, variants, categories, collections, brands)", () => {
      expect(storeContract.admin.products.list).toBeDefined();
      expect(storeContract.admin.products.get).toBeDefined();
      expect(storeContract.admin.products.create).toBeDefined();
      expect(storeContract.admin.products.update).toBeDefined();
      expect(storeContract.admin.products.delete).toBeDefined();

      expect(storeContract.admin.variants.update).toBeDefined();

      expect(storeContract.admin.categories.list).toBeDefined();
      expect(storeContract.admin.categories.create).toBeDefined();
      expect(storeContract.admin.categories.update).toBeDefined();
      expect(storeContract.admin.categories.delete).toBeDefined();

      expect(storeContract.admin.collections.list).toBeDefined();
      expect(storeContract.admin.collections.get).toBeDefined();
      expect(storeContract.admin.collections.create).toBeDefined();
      expect(storeContract.admin.collections.update).toBeDefined();
      expect(storeContract.admin.collections.delete).toBeDefined();

      expect(storeContract.admin.brands.list).toBeDefined();
      expect(storeContract.admin.brands.create).toBeDefined();
      expect(storeContract.admin.brands.update).toBeDefined();
      expect(storeContract.admin.brands.delete).toBeDefined();
    });

    it("defines inventory procedures (list, adjust)", () => {
      expect(storeContract.admin.inventory.list).toBeDefined();
      expect(storeContract.admin.inventory.adjust).toBeDefined();
    });

    it("defines media procedures (list, requestUpload, create, delete)", () => {
      expect(storeContract.admin.media.list).toBeDefined();
      expect(storeContract.admin.media.requestUpload).toBeDefined();
      expect(storeContract.admin.media.create).toBeDefined();
      expect(storeContract.admin.media.delete).toBeDefined();
    });

    it("defines branding and theme procedures", () => {
      expect(storeContract.admin.branding.get).toBeDefined();
      expect(storeContract.admin.branding.update).toBeDefined();
      expect(storeContract.admin.branding.publish).toBeDefined();

      expect(storeContract.admin.themes.get).toBeDefined();
      expect(storeContract.admin.themes.update).toBeDefined();
    });

    it("defines content procedures (pages, menus)", () => {
      expect(storeContract.admin.pages.list).toBeDefined();
      expect(storeContract.admin.pages.get).toBeDefined();
      expect(storeContract.admin.pages.create).toBeDefined();
      expect(storeContract.admin.pages.update).toBeDefined();
      expect(storeContract.admin.pages.saveDraft).toBeDefined();
      expect(storeContract.admin.pages.publish).toBeDefined();
      expect(storeContract.admin.pages.rollback).toBeDefined();

      expect(storeContract.admin.menus.list).toBeDefined();
      expect(storeContract.admin.menus.get).toBeDefined();
      expect(storeContract.admin.menus.create).toBeDefined();
      expect(storeContract.admin.menus.update).toBeDefined();
      expect(storeContract.admin.menus.delete).toBeDefined();
    });
  });

  describe("Platform contracts", () => {
    it("defines platform tenants list and get procedures", () => {
      expect(platformContract.tenants.list).toBeDefined();
      expect(platformContract.tenants.get).toBeDefined();
    });
  });
});
