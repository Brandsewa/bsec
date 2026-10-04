import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { tenants } from "./tenants.ts";
import { users } from "./identity.ts";

/**
 * Plans: Pricing tiers (Starter, Growth, Pro) per PLAN §5.1.
 * Platform-wide; no RLS.
 */
export const plans = pgTable("plans", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  code: text("code").notNull().unique(), // 'starter', 'growth', 'pro'
  name: text("name").notNull(),
  priceMonthlyPaise: bigint("price_monthly_paise", { mode: "number" }).notNull(),
  priceYearlyPaise: bigint("price_yearly_paise", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  limits: jsonb("limits").notNull().default({}), // { products, staff, storage_mb, orders_month, custom_domain }
  features: jsonb("features").notNull().default({}),
  razorpayPlanIdMonthly: text("razorpay_plan_id_monthly"),
  razorpayPlanIdYearly: text("razorpay_plan_id_yearly"),
  isPublic: boolean("is_public").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Subscriptions: Platform-to-merchant recurring billing per PLAN §5.1.
 * Uses separate platform Razorpay credentials (ADR-014).
 * Platform-wide; no RLS.
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
  status: text("status").notNull().default("trialing"), // trialing, active, past_due, suspended, cancelled
  interval: text("interval").notNull().default("monthly"), // monthly, yearly
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  provider: text("provider").notNull().default("razorpay"),
  providerSubscriptionId: text("provider_subscription_id"),
  cancelAt: timestamp("cancel_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Platform Invoices: GST tax invoices issued by platform to merchants (PLAN §5.1).
 * Platform-wide; no RLS.
 */
export const platformInvoices = pgTable("platform_invoices", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  number: text("number").notNull().unique(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  taxPaise: bigint("tax_paise", { mode: "number" }).notNull(),
  status: text("status").notNull().default("issued"), // issued, paid, void
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`now()`),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  pdfKey: text("pdf_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Platform Audit Logs: Append-only log of all Super Admin mutations (PLAN §4, §5.1, §6).
 * Platform-wide; no RLS.
 */
export const platformAuditLogs = pgTable("platform_audit_logs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  actorUserId: uuid("actor_user_id"),
  actorType: text("actor_type").notNull().default("platform_staff"), // platform_staff, system, api
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  diff: jsonb("diff"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Theme Templates: Starter themes offered at signup (PLAN §5.1, §7, ADR-009).
 * Platform-wide; no RLS.
 */
export const themeTemplates = pgTable("theme_templates", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  previewImageKey: text("preview_image_key"),
  defaultTokens: jsonb("default_tokens").notNull().default({}),
  defaultPages: jsonb("default_pages").notNull().default({}),
  // Theme library fields (M10). `defaultPages`/`defaultTokens` are the PUBLISHED snapshot that
  // stores copy on activation; the draft_* columns are the work-in-progress edited in the
  // platform visual editor and only replace the snapshot on publish (which bumps `version`).
  description: text("description"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  draftPages: jsonb("draft_pages"),
  draftTokens: jsonb("draft_tokens"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // Set when staff archive a theme (hidden from stores, kept for later or for deletion). Null = published or still a draft.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Theme previews: a short-lived, immutable snapshot of a theme's draft pages and tokens that Super Admin
 * shares as a link (/preview/<code> on the marketing host) so a theme can be viewed in any browser before
 * it is published. Platform-wide, no RLS. The code is an unguessable random token; rows expire and are
 * pruned. The storefront only reads this table (insert/update/delete from app_rw are revoked in 0021).
 */
export const themePreviews = pgTable(
  "theme_previews",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    code: text("code").notNull().unique(),
    templateCode: text("template_code").notNull(),
    name: text("name").notNull(),
    pages: jsonb("pages").notNull(),
    tokens: jsonb("tokens").notNull(),
    createdBy: uuid("created_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("theme_previews_expires_idx").on(t.expiresAt)],
);

/**
 * Signup Leads: Captures partial signups for analytics and follow-up (PLAN §5.2, §7).
 * Platform-wide; no RLS.
 */
export const signupLeads = pgTable("signup_leads", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  email: citext("email"),
  phone: text("phone"),
  name: text("name"),
  businessName: text("business_name"),
  desiredSlug: citext("desired_slug"),
  industry: text("industry"),
  source: text("source"),
  utm: jsonb("utm"),
  referralCode: text("referral_code"),
  step: text("step").notNull().default("started"), // started, verified, store_created, abandoned
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Slug Reservations: Holds a platform subdomain during signup with 30-min TTL (PLAN §5.2, §7).
 * Platform-wide; no RLS.
 */
export const slugReservations = pgTable("slug_reservations", {
  slug: citext("slug").primaryKey(),
  leadId: uuid("lead_id").references(() => signupLeads.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Reserved Slugs: Platform-reserved subdomain names (PLAN §5.2).
 * Platform-wide; no RLS.
 */
export const reservedSlugs = pgTable("reserved_slugs", {
  slug: citext("slug").primaryKey(),
  reason: text("reason").notNull().default("system_reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Onboarding Progress: Drives the Store Admin Home setup checklist (PLAN §5.2, §8).
 * Tenant table with RLS.
 */
export const onboardingProgress = tenantTable("onboarding_progress", {
  steps: jsonb("steps").notNull().default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Tenant Owner Invites: Cryptographically random single-use hash-stored invite tokens (PLAN §6).
 * Used when a platform operator creates a store on behalf of a client.
 * Platform-wide; no RLS.
 */
export const tenantOwnerInvites = pgTable("tenant_owner_invites", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: citext("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Exports: Per-store export requests (PLAN §5.10, §6.4 / M9).
 * Tenant table: RLS enabled.
 */
export const exports = tenantTable(
  "exports",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    type: text("type").notNull().default("full_store"), // 'full_store' | 'products' | 'orders' | 'customers'
    status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
    fileKey: text("file_key"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    error: text("error"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("exports_tenant_id_uniq").on(t.tenantId, t.id),
  ],
);

/**
 * Plan Change Requests (Settings Phase 5 / SETTINGS-SCHEMA §4, Slice 5D).
 * Tenant table: isolated to merchant side, read by platform staff through app_platform / BYPASSRLS.
 */
export const planChangeRequests = tenantTable(
  "plan_change_requests",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromPlanId: uuid("from_plan_id"),
    toPlanId: uuid("to_plan_id").notNull(),
    interval: text("interval").notNull(), // 'monthly' | 'yearly'
    note: text("note"),
    status: text("status").notNull().default("open"), // 'open' | 'approved' | 'declined' | 'cancelled'
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("plan_change_requests_tenant_id_id_uniq").on(t.tenantId, t.id),
    index("plan_change_requests_tenant_status_idx").on(t.tenantId, t.status),
  ],
);


