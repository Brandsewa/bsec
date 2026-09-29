/**
 * Auth package (PLAN §4). M0: permission map and cookie names only.
 * M1 adds two Better Auth instances from one package: staff (global users + memberships)
 * and customer (per-store, cookie __Host-cust scoped to the store host).
 */
export const STAFF_COOKIE_PREFIX = "bs-staff";
export const CUSTOMER_COOKIE = "__Host-cust";

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
] as const;
export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export const PLATFORM_ROLES = ["platform_owner", "platform_admin", "platform_support"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** store_owner: everything. store_admin: everything except billing/ownership (enforced outside this list). */
export const SYSTEM_STORE_ROLES: Record<"store_owner" | "store_admin", readonly StorePermission[]> = {
  store_owner: STORE_PERMISSIONS,
  store_admin: STORE_PERMISSIONS,
};

export function hasPermission(granted: readonly string[], needed: StorePermission): boolean {
  return granted.includes(needed);
}

export { createStaffAuth, type StaffAuth, type StaffAuthOptions } from "./staff.ts";
export { hashPassword, verifyPassword } from "better-auth/crypto";
export { createCustomerAuth, type CustomerAuth, type CustomerAuthOptions } from "./customer.ts";

