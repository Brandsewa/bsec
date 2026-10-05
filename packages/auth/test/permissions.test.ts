import { describe, expect, it } from "vitest";
import {
  FINANCE_EXPORT_ROLES,
  hasPermission,
  LEGACY_SETTINGS_WRITE_FAMILIES,
  STORE_PERMISSIONS,
  SYSTEM_STORE_ROLES,
  systemRoleFinancePermissions,
} from "../src/index.ts";

describe("permissions", () => {
  it("lists all store permissions without duplicates", () => {
    expect(new Set(STORE_PERMISSIONS).size).toBe(STORE_PERMISSIONS.length);
    expect(STORE_PERMISSIONS.length).toBe(31); // 14 legacy + 15 capability families + 2 finance permissions
  });

  it("checks system store roles delegation matrix (owner-approved 2026-10-04)", () => {
    // store_owner holds all permissions including payments.manage and finance.*
    expect(hasPermission(SYSTEM_STORE_ROLES.store_owner, "payments.manage")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_owner, "staff.manage")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_owner, "audit.read")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_owner, "settings.manage")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_owner, "finance.read")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_owner, "finance.write")).toBe(true);

    // store_admin lacks exactly payments.manage, holds staff.manage, audit.read, finance.*
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "payments.manage")).toBe(false);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "staff.manage")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "audit.read")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "domains.manage")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "orders.refund")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "finance.read")).toBe(true);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_admin, "finance.write")).toBe(true);
  });

  it("satisfies migrated families when legacy settings.write is granted (aggregate mapping)", () => {
    const legacyRole = ["settings.write"];

    // Satisfies all migrated families
    for (const family of LEGACY_SETTINGS_WRITE_FAMILIES) {
      expect(hasPermission(legacyRole, family)).toBe(true);
    }

    // NEVER satisfies payments.manage or staff.manage
    expect(hasPermission(legacyRole, "payments.manage")).toBe(false);
    expect(hasPermission(legacyRole, "staff.manage")).toBe(false);
    // Nor non-settings permissions
    expect(hasPermission(legacyRole, "products.write")).toBe(false);
    expect(hasPermission(legacyRole, "orders.write")).toBe(false);
  });

  it("grants only itself when a capability family is held directly", () => {
    const auditStaff = ["audit.read"];
    expect(hasPermission(auditStaff, "audit.read")).toBe(true);
    expect(hasPermission(auditStaff, "settings.read")).toBe(false);
    expect(hasPermission(auditStaff, "settings.manage")).toBe(false);
    expect(hasPermission(auditStaff, "settings.write")).toBe(false);
    expect(hasPermission(auditStaff, "payments.manage")).toBe(false);
    expect(hasPermission(auditStaff, "staff.manage")).toBe(false);

    const domainsStaff = ["domains.manage"];
    expect(hasPermission(domainsStaff, "domains.manage")).toBe(true);
    expect(hasPermission(domainsStaff, "settings.write")).toBe(false);
    expect(hasPermission(domainsStaff, "audit.read")).toBe(false);
  });

  it("defines the finance role (owner decision 2026-10-05): finance.read and finance.write only", () => {
    expect([...SYSTEM_STORE_ROLES.store_finance]).toEqual(["finance.read", "finance.write"]);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_finance, "exports.run")).toBe(false);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_finance, "orders.read")).toBe(false);
    expect(hasPermission(SYSTEM_STORE_ROLES.store_finance, "staff.manage")).toBe(false);
  });

  it("limits finance CSV export to the owner and admin roles", () => {
    expect([...FINANCE_EXPORT_ROLES]).toEqual(["store_owner", "store_admin"]);
    expect(FINANCE_EXPORT_ROLES).not.toContain("store_finance");
  });

  it("derives finance.* from the system role, and grants nothing to other roles", () => {
    expect([...systemRoleFinancePermissions("store_owner")]).toEqual(["finance.read", "finance.write"]);
    expect([...systemRoleFinancePermissions("store_admin")]).toEqual(["finance.read", "finance.write"]);
    expect([...systemRoleFinancePermissions("store_finance")]).toEqual(["finance.read", "finance.write"]);
    expect(systemRoleFinancePermissions("store_viewer")).toEqual([]);
    expect(systemRoleFinancePermissions("anything")).toEqual([]);
  });
});
