/**
 * Auth package (PLAN §4). M0: permission map and cookie names only.
 * M1 adds two Better Auth instances from one package: staff (global users + memberships)
 * and customer (per-store, cookie __Host-cust scoped to the store host).
 */
export const STAFF_COOKIE_PREFIX = "bs-staff";
export const CUSTOMER_COOKIE = "__Host-cust";
export const PLATFORM_COOKIE_PREFIX = "bs-platform";

export const STORE_PERMISSIONS = [
  "products.read",
  "products.write",
  "orders.read",
  "orders.write",
  "orders.refund",
  "customers.read",
  "customers.write",
  "discounts.write",
  "content.write",
  "theme.publish",
  "settings.write",
  "staff.manage",
  "analytics.read",
  "exports.run",
  "finance.read",
  "finance.write",
  // Settings capability families (Phase 2, ADR-020, docs/SETTINGS-SCHEMA.md §3.2)
  "settings.read",
  "settings.manage",
  "branding.manage",
  "storefront.manage",
  "checkout.manage",
  "payments.manage",
  "shipping.manage",
  "taxes.manage",
  "orders.settings.manage",
  "returns.manage",
  "notifications.manage",
  "domains.manage",
  "policies.manage",
  "privacy.manage",
  "audit.read",
] as const;
export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export const PLATFORM_ROLES = ["platform_owner", "platform_admin", "platform_support"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Delegated capability families satisfied by legacy `settings.write` during expand/migrate/contract (ADR-020).
 * `payments.manage` is strictly owner-only and excluded here.
 * `staff.manage` was always a separate permission and is excluded here.
 */
export const LEGACY_SETTINGS_WRITE_FAMILIES: readonly StorePermission[] = [
  "settings.read",
  "settings.manage",
  "branding.manage",
  "storefront.manage",
  "checkout.manage",
  "shipping.manage",
  "taxes.manage",
  "orders.settings.manage",
  "returns.manage",
  "notifications.manage",
  "domains.manage",
  "policies.manage",
  "privacy.manage",
  "audit.read",
];

const LEGACY_SETTINGS_WRITE_SET = new Set<string>(LEGACY_SETTINGS_WRITE_FAMILIES);

/**
 * System store roles (PLAN §4, ADR-020).
 * store_owner: all permissions.
 * store_admin: all permissions EXCEPT payments.manage (owner-only per owner decision 2026-10-04).
 */
export const SYSTEM_STORE_ROLES: Record<"store_owner" | "store_admin" | "store_finance", readonly StorePermission[]> = {
  store_owner: STORE_PERMISSIONS,
  store_admin: STORE_PERMISSIONS.filter((p) => p !== "payments.manage"),
  // Owner decision 2026-10-05 (finance D14): a role that sees and edits the books and nothing else.
  store_finance: ["finance.read", "finance.write"],
};

/**
 * Who may download Finance CSV exports (owner decision 2026-10-05, D10): the store owner and store admin
 * system roles only, on top of holding `exports.run` and `finance.read`. The finance role cannot export.
 */
export const FINANCE_EXPORT_ROLES: readonly string[] = ["store_owner", "store_admin"];

/**
 * Finance permissions are defined by the system role, not by the permission array stored on each store's
 * role row: stores created before the Finance section have stale arrays, and without this the books would
 * be unreachable for their owners. Returns the finance permissions a system role is defined to hold.
 */
export function systemRoleFinancePermissions(roleName: string): readonly StorePermission[] {
  const defined = (SYSTEM_STORE_ROLES as Record<string, readonly StorePermission[] | undefined>)[roleName];
  return defined ? defined.filter((p) => p.startsWith("finance.")) : [];
}

export function hasPermission(granted: readonly string[], needed: StorePermission): boolean {
  if (granted.includes(needed)) return true;
  // Check-time aggregate mapping: legacy settings.write satisfies migrated families except payments.manage and staff.manage
  if (granted.includes("settings.write") && LEGACY_SETTINGS_WRITE_SET.has(needed)) {
    return true;
  }
  return false;
}

export { createStaffAuth, type StaffAuth, type StaffAuthOptions } from "./staff.ts";
export { createPlatformAuth, type PlatformAuth, type PlatformAuthOptions } from "./platform.ts";
export { hashPassword, verifyPassword } from "better-auth/crypto";
export { createCustomerAuth, type CustomerAuth, type CustomerAuthOptions } from "./customer.ts";


