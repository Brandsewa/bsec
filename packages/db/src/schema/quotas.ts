import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

/**
 * Rate Limit Counters (PLAN §14 / M7).
 * Postgres-backed fixed-window atomic rate limiter counters.
 * Key format: e.g. "otp:req:phone:919800000001:179064000", "storefront:tenant:<id>:179064000".
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("rate_limit_counters_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Quota Definitions (PLAN §6.1, §14 / M7-M8).
 * Defines limits across tenant size tiers (XS, S, M, L).
 * NOTE(M8): Minimal quota schema built for M7 rate limiting and job concurrency enforcement;
 * M8 will formalize additional quotas (products, staff, storage, etc.) and admin management.
 */
export const quotaDefinitions = pgTable("quota_definitions", {
  key: text("key").primaryKey(),
  description: text("description"),
  unit: text("unit").notNull().default("count"),
  enforcement: text("enforcement").notNull().default("hard"), // 'hard', 'soft', 'notify'
  tierXs: integer("tier_xs").notNull(),
  tierS: integer("tier_s").notNull(),
  tierM: integer("tier_m").notNull(),
  tierL: integer("tier_l").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenant Size Tiers (PLAN §6.1, §14 / M7-M8).
 * Maps a tenant to its current size tier (XS, S, M, L). Defaults to XS.
 */
export const tenantSizeTiers = pgTable("tenant_size_tiers", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  tier: text("tier").notNull().default("XS"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenant Quota Overrides (PLAN §6.1, §14 / M7-M8).
 * Per-tenant limit overrides that supersede size tier and plan defaults.
 */
export const tenantQuotaOverrides = pgTable(
  "tenant_quota_overrides",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    quotaKey: text("quota_key")
      .notNull()
      .references(() => quotaDefinitions.key, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    setBy: uuid("set_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.quotaKey] }),
  ],
);

/**
 * Quota Events (PLAN §5.1, §6.1).
 * Warnings and notifications when soft/hard thresholds are approached or exceeded.
 */
export const quotaEvents = pgTable(
  "quota_events",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    quotaKey: text("quota_key")
      .notNull()
      .references(() => quotaDefinitions.key, { onDelete: "cascade" }),
    level: text("level").notNull(), // 'pct_80', 'pct_100', 'blocked'
    value: integer("value").notNull(),
    limitValue: integer("limit_value").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("quota_events_tenant_key_idx").on(t.tenantId, t.quotaKey),
    index("quota_events_level_idx").on(t.level),
  ],
);

/**
 * Tenant Active Background Jobs (PLAN §6.1, §14 / M7).
 * Tracks running background jobs per tenant to enforce concurrency ceilings (XS=1, S=2, M=4, L=8).
 */
export const tenantActiveJobs = pgTable("tenant_active_jobs", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  activeCount: integer("active_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
