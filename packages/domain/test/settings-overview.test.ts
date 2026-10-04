import { describe, expect, it } from "vitest";
import { deriveSettingsOverviewActions, type SettingsOverviewFacts } from "../src/admin/settings-overview.ts";
import { SettingsOverview } from "@bs/contracts";

const READY: SettingsOverviewFacts = {
  storeStatusMode: "live",
  storefrontUrl: "https://shop.example.com",
  codEnabled: true,
  onlinePaymentAvailable: false,
  hasDefaultShippingRate: true,
  hasProducts: true,
  hasCustomDomain: true,
  plan: { name: "Growth", status: "active", interval: "monthly" },
};

const ids = (facts: SettingsOverviewFacts) => deriveSettingsOverviewActions(facts).map((a) => a.id);

describe("deriveSettingsOverviewActions readiness matrix (prompt §Required test matrix)", () => {
  it("shows nothing when the store is fully ready", () => {
    expect(ids(READY)).toEqual([]);
  });

  it("shows store_not_live for every non-live mode and links to Storefront settings", () => {
    for (const mode of ["coming_soon", "password", "maintenance"] as const) {
      const action = deriveSettingsOverviewActions({ ...READY, storeStatusMode: mode }).find((a) => a.id === "store_not_live");
      expect(action, mode).toBeDefined();
      expect(action!.kind).toBe("required");
      expect(action!.href).toBe("/settings/storefront");
      expect(action!.description, mode).toBeTruthy();
    }
  });

  it("omits store_not_live when live", () => {
    expect(ids(READY)).not.toContain("store_not_live");
  });

  it("shows no_payment_method only when neither COD nor online payment can take an order", () => {
    const action = deriveSettingsOverviewActions({ ...READY, codEnabled: false }).find((a) => a.id === "no_payment_method");
    expect(action).toBeDefined();
    expect(action!.href).toBe("/settings/payments");
    // COD enabled keeps the store sellable even while online payment is unavailable.
    expect(ids({ ...READY, codEnabled: true })).not.toContain("no_payment_method");
  });

  it("shows no_shipping_rate only when the default zone has no rate", () => {
    const action = deriveSettingsOverviewActions({ ...READY, hasDefaultShippingRate: false }).find((a) => a.id === "no_shipping_rate");
    expect(action).toBeDefined();
    expect(action!.href).toBe("/settings/shipping");
    expect(ids(READY)).not.toContain("no_shipping_rate");
  });

  it("shows no_products only when the catalog is empty", () => {
    const action = deriveSettingsOverviewActions({ ...READY, hasProducts: false }).find((a) => a.id === "no_products");
    expect(action).toBeDefined();
    expect(action!.href).toBe("/products/new");
    expect(ids(READY)).not.toContain("no_products");
  });

  it("shows no_custom_domain as informational with no link while no merchant domain UI exists", () => {
    const action = deriveSettingsOverviewActions({ ...READY, hasCustomDomain: false }).find((a) => a.id === "no_custom_domain");
    expect(action).toBeDefined();
    expect(action!.kind).toBe("informational");
    expect(action!.href).toBeNull();
    expect(action!.description).toContain("subdomain");
    expect(ids(READY)).not.toContain("no_custom_domain");
  });
});

describe("SettingsOverview contract shape", () => {
  it("accepts a full read-model payload", () => {
    const parsed = SettingsOverview.parse({
      storeStatus: { mode: "coming_soon", storefrontUrl: "https://alpha.bcom.si" },
      payments: { codEnabled: true, onlinePaymentAvailable: false },
      shipping: { hasDefaultRate: false },
      products: { hasProducts: false },
      domains: { hasCustomDomain: false, storefrontHostname: "alpha.bcom.si" },
      plan: null,
      onboarding: { steps: { store_created: true }, completedCount: 1, totalCount: 5, dismissed: false, allCompleted: false },
      actions: [
        { id: "store_not_live", title: "Store is not live", description: null, href: "/settings/storefront", kind: "required" },
        { id: "no_custom_domain", title: "Using the platform subdomain", description: "info", href: null, kind: "informational" },
      ],
      quickLinks: [{ href: "/settings/storefront", label: "Store availability" }],
    });
    expect(parsed.storeStatus.mode).toBe("coming_soon");
    expect(parsed.plan).toBeNull();
    expect(parsed.actions).toHaveLength(2);
  });

  it("rejects an unknown store status mode", () => {
    expect(() =>
      SettingsOverview.parse({
        storeStatus: { mode: "paused", storefrontUrl: null },
        payments: { codEnabled: true, onlinePaymentAvailable: false },
        shipping: { hasDefaultRate: true },
        products: { hasProducts: true },
        domains: { hasCustomDomain: false, storefrontHostname: null },
        plan: null,
        onboarding: { steps: {}, completedCount: 0, totalCount: 5, dismissed: false, allCompleted: false },
        actions: [],
        quickLinks: [],
      }),
    ).toThrow();
  });
});
