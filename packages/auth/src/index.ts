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
export const SYSTEM_STORE_ROLES: Record<"store_owner" | "store_admin", readonly StorePermission[]> = {
  store_owner: STORE_PERMISSIONS,
  store_admin: STORE_PERMISSIONS.filter((p) => p !== "payments.manage"),
};

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


