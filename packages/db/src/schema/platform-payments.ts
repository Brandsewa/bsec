import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Platform Payment Providers (ADMIN-IMPROVEMENTS-PLAN Phase 4 slice D, §6.4, ADR-008).
 * Which payment providers the platform lets stores connect. Holds no secrets: each store's keys stay
 * encrypted in tenant_secrets. Platform-level: no tenant column, writable only by app_platform, read-only
 * by app_rw, no RLS.
 */
export const platformPaymentProviders = pgTable("platform_payment_providers", {
  provider: text("provider").primaryKey(), // 'razorpay' | 'stripe'
  displayName: text("display_name").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  // A second switch: stores stay in test mode until the owner allows live keys for this provider.
  liveModeAllowed: boolean("live_mode_allowed").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
