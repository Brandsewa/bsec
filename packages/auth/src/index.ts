/**
 * Auth package (PLAN §4). Server entry: permission model re-exported from ./permissions.ts plus the three
 * Better Auth instances (staff, customer, platform). Browser code imports `@bs/auth/permissions` instead.
 */
export * from "./permissions.ts";

export { createStaffAuth, type StaffAuth, type StaffAuthOptions } from "./staff.ts";
export { createPlatformAuth, type PlatformAuth, type PlatformAuthOptions } from "./platform.ts";
export { hashPassword, verifyPassword } from "better-auth/crypto";
export { createCustomerAuth, type CustomerAuth, type CustomerAuthOptions } from "./customer.ts";


