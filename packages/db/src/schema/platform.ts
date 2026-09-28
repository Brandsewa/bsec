import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { users } from "./identity.ts";
import { organizations, tenants } from "./tenants.ts";

export { citext, organizations, tenants };

/**
 * Domains: hostname to tenant mapping for host resolution (PLAN §4, §5.1).
 * Platform-managed; no RLS.
 */
export const domains = pgTable("domains", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  hostname: citext("hostname").notNull().unique(),
  type: text("type").notNull().default("platform_subdomain"),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").notNull().default("active"),
  prevalidateTxt: boolean("prevalidate_txt").default(false),
  cfCustomHostnameId: text("cf_custom_hostname_id"),
  verification: jsonb("verification"),
  sslStatus: text("ssl_status"),
  failureReason: text("failure_reason"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Feature flags catalog: global flag definitions (PLAN §5.1, M1).
 * Platform-managed; no RLS.
 */
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  defaultOn: boolean("default_on").notNull().default(false),
  rules: jsonb("rules"),
  killSwitch: boolean("kill_switch").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenant feature overrides: per-store overrides for feature flags (PLAN §5.1, M1).
 * Tenant table: RLS enabled.
 */
export const tenantFeatureOverrides = tenantTable(
  "tenant_feature_overrides",
  {
    key: text("key").notNull().references(() => featureFlags.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull(),
    setBy: uuid("set_by"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
  ],
);

/**
 * Platform staff: super admin team members (PLAN §5.1).
 * Distinct from store staff; platform-managed; no RLS.
 */
export const platformStaff = pgTable("platform_staff", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("platform_support"),
  isActive: boolean("is_active").notNull().default(true),
  mfaRequired: boolean("mfa_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
