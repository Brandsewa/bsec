import { sql } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { citext } from "./custom-types.ts";

/**
 * Organizations: business entity owning one or more stores (PLAN §5.1).
 * Root platform entity; no RLS.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  gstin: text("gstin"),
  pan: text("pan"),
  billingEmail: citext("billing_email"),
  billingAddress: jsonb("billing_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenants: root of multi-tenant isolation (PLAN §4, §5.1).
 * No RLS: read via platform router (app_platform role) or host resolver.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  slug: citext("slug").notNull().unique(),
  name: text("name").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  ownerUserId: uuid("owner_user_id"),
  status: text("status").notNull().default("active"),
  planId: text("plan_id"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  country: text("country").notNull().default("IN"),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  locale: text("locale").notNull().default("en-IN"),
  industry: text("industry"),
  suspendedReason: text("suspended_reason"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  dataRegion: text("data_region").notNull().default("ap-south-1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
