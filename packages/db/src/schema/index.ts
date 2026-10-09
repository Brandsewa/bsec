import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * M0 schema: one platform-level key/value table proving migrations run as app_owner.
 */
export const platformMeta = pgTable("_platform_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export * from "./platform.ts";
export * from "./identity.ts";
export * from "./settings.ts";
export * from "./catalog.ts";
export * from "./branding.ts";
export * from "./content.ts";
export * from "./search.ts";
export * from "./marketing.ts";
export * from "./cart.ts";
export * from "./orders.ts";
export * from "./payments.ts";
export * from "./inventory-reservations.ts";
export * from "./tenant-secrets.ts";
export * from "./system.ts";
export * from "./customers.ts";
export * from "./shipping.ts";
export * from "./quotas.ts";
export * from "./saas.ts";
export * from "./platform-email.ts";
export * from "./quotes.ts";
export * from "./reviews.ts";
export * from "./tax.ts";
export * from "./policies.ts";
export * from "./privacy.ts";
export * from "./finance.ts";
export * from "./platform-storage.ts";
export * from "./platform-channel.ts";
export * from "./platform-payments.ts";
