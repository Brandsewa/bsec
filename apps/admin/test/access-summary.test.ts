import { describe, expect, it } from "vitest";
import { STORE_PERMISSIONS, SYSTEM_STORE_ROLES } from "@bs/auth/permissions";
import { ACCESS_LABEL, isFullAccessRole, roleDisplayName, roleSummary, summarizeAccess } from "../src/lib/access-summary.ts";

const row = (granted: readonly string[], key: string) => summarizeAccess(granted).find((r) => r.key === key)!;

describe("summarizeAccess", () => {
  it("lists the ten capability groups in a fixed order", () => {
    expect(summarizeAccess([]).map((r) => r.label)).toEqual([
      "Products & inventory",
      "Orders & fulfilment",
      "Refunds",
      "Customers",
      "Storefront & content",
      "Payments",
      "Shipping & taxes",
      "Settings",
      "Team",
      "Analytics & exports",
    ]);
  });

  it("gives No access to everything for an empty permission list", () => {
    expect(summarizeAccess([]).every((r) => r.level === "none" && !r.sensitive)).toBe(true);
  });

  it("separates Manage from View only", () => {
    expect(row(["products.read"], "products")).toMatchObject({ level: "view" });
    expect(row(["products.read", "products.write"], "products")).toMatchObject({ level: "manage" });
    expect(row(["products.write"], "products")).toMatchObject({ level: "manage" });
    expect(row(["customers.read"], "customers").level).toBe("view");
  });

  it("flags sensitive access: refunds, deleting orders, payments, team, exports", () => {
    expect(row(["orders.refund"], "refunds")).toMatchObject({ level: "manage", sensitive: true });
    expect(row(["orders.read", "orders.write", "orders.delete"], "orders")).toMatchObject({ level: "manage", sensitive: true });
    expect(row(["orders.read", "orders.write"], "orders").sensitive).toBe(false);
    expect(row(["payments.manage"], "payments")).toMatchObject({ level: "manage", sensitive: true });
    expect(row(["finance.read"], "payments")).toMatchObject({ level: "view", sensitive: false });
    expect(row(["staff.manage"], "team")).toMatchObject({ level: "manage", sensitive: true });
    expect(row(["analytics.read"], "analytics")).toMatchObject({ level: "view", sensitive: false });
    expect(row(["analytics.read", "exports.run"], "analytics")).toMatchObject({ level: "manage", sensitive: true });
  });

  it("does not mark an area sensitive when the person has no access to it", () => {
    expect(row(["orders.delete"], "orders")).toMatchObject({ level: "none", sensitive: false });
  });

  it("follows the same legacy rule as enforcement: settings.write covers settings families but never payments or team", () => {
    const g = ["settings.write"];
    expect(row(g, "settings").level).toBe("manage");
    expect(row(g, "shipping").level).toBe("manage");
    expect(row(g, "payments").level).toBe("none");
    expect(row(g, "team").level).toBe("none");
  });

  it("settings.read alone is View only", () => {
    expect(row(["settings.read"], "settings").level).toBe("view");
  });

  it("matches the system roles: the admin cannot manage payments, the owner can do everything, finance only the books", () => {
    const admin = summarizeAccess(SYSTEM_STORE_ROLES.store_admin);
    expect(admin.find((r) => r.key === "payments")).toMatchObject({ level: "manage" }); // finance.write is still held
    expect(SYSTEM_STORE_ROLES.store_admin).not.toContain("payments.manage");
    expect(summarizeAccess(STORE_PERMISSIONS).every((r) => r.level === "manage")).toBe(true);
    const fin = summarizeAccess(SYSTEM_STORE_ROLES.store_finance);
    expect(fin.filter((r) => r.level !== "none").map((r) => r.key)).toEqual(["payments"]);
  });

  it("uses the agreed access labels", () => {
    expect(ACCESS_LABEL).toEqual({ manage: "Manage", view: "View only", none: "No access" });
  });
});

describe("role wording", () => {
  it("shows the owner as full access and names roles readably", () => {
    expect(isFullAccessRole("store_owner")).toBe(true);
    expect(isFullAccessRole("store_admin")).toBe(false);
    expect(roleDisplayName("store_owner")).toBe("Owner");
    expect(roleDisplayName("store_finance")).toBe("Finance");
    expect(roleDisplayName("Warehouse lead")).toBe("Warehouse lead");
  });

  it("writes fixed sentences for system roles and generates one for a custom role", () => {
    expect(roleSummary("store_owner", [])).toMatch(/own this store/);
    const rows = summarizeAccess(["products.read", "products.write", "orders.read"]);
    expect(roleSummary("Warehouse lead", rows)).toBe("You can manage products & inventory, and view orders & fulfilment.");
    expect(roleSummary("Nobody", summarizeAccess([]))).toMatch(/do not have access/);
  });
});
