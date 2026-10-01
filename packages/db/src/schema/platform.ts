import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { bytea, citext } from "./custom-types.ts";
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
  /** Set when MFA enrolment completed; a session is only valid if it was created after this. */
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Platform Staff Invitations: Pending invites for new Super Admin members (PLAN §6).
 * Platform-managed; no RLS.
 */
export const platformStaffInvitations = pgTable("platform_staff_invitations", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  email: citext("email").notNull().unique(),
  role: text("role").notNull().default("platform_support"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Support Sessions: Audited time-boxed impersonation (PLAN §5.1, §6.3).
 * Platform-managed; no RLS.
 */
export const supportSessions = pgTable("support_sessions", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  platformUserId: uuid("platform_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  impersonatedUserId: uuid("impersonated_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  ticketRef: text("ticket_ref").notNull(),
  scope: text("scope").notNull().default("read_only"), // 'read_only' | 'write'
  consent: text("consent").notNull().default("owner_approved"), // 'owner_approved' | 'standing_consent' | 'emergency'
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedBy: uuid("ended_by").references(() => users.id, { onDelete: "set null" }),
  actionsCount: integer("actions_count").notNull().default(0),
  /** SHA-256 of the raw support token (shown once to the staff member who started the session). */
  tokenHash: text("token_hash").unique(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  deniedAt: timestamp("denied_at", { withTimezone: true }),
  extendedAt: timestamp("extended_at", { withTimezone: true }),
  writeConfirmedAt: timestamp("write_confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenant Deletions: Long-running deletion workflow (PLAN §5.1, §6.4).
 * Platform-managed; no RLS.
 */
export const tenantDeletions = pgTable("tenant_deletions", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  step: text("step").notNull().default("requested"), // 'requested', 'exported', 'billing_stopped', 'domains_disconnected', 'media_scheduled', 'db_purged', 'verified', 'deleted'
  exportId: uuid("export_id"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  error: text("error"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenant Notes: Internal operator notes for Super Admin (PLAN §6 "Notes tab").
 * Platform-managed; no RLS.
 */
export const tenantNotes = pgTable("tenant_notes", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});


/**
 * Export archive contents (gzipped JSON). Platform-only: the tenant runtime has no access.
 */
export const exportFiles = pgTable("export_files", {
  exportId: uuid("export_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull().default("application/gzip"),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});
