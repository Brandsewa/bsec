import { describe, expect, it } from "vitest";
import { hasPermission, STORE_PERMISSIONS, SYSTEM_STORE_ROLES } from "../src/index.ts";

describe("permissions", () => {
  it("lists the 14 plan permissions without duplicates", () => {
    expect(new Set(STORE_PERMISSIONS).size).toBe(14);
  });
  it("checks membership", () => {
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "orders.refund")).toBe(true);
    expect(hasPermission(["orders.read"], "orders.write")).toBe(false);
  });
});
