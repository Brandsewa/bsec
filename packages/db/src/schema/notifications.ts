import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { users } from "./identity.ts";

/**
 * Notification manager (docs/NOTIFICATION-MANAGER-PLAN.md, ADR-039).
 * The event catalog is code (`packages/domain/src/notifications/catalog.ts`); these tables only hold what Super Admin,
 * stores and recipients change: rule overrides, email branding and the in-app inbox. Nothing here stores template
 * code or raw HTML (ADR-010): branding is validated tokens.
 */

/** Platform default for one event on one channel. A missing row means "use the catalog default". Super Admin writes it. */
export const notificationRules = pgTable(
  "notification_rules",
  {
    eventKey: text("event_key").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Platform events: Super Admin roles that receive it (platform_role names). */
    roleRecipients: text("role_recipients").array().notNull().default(sql`'{}'::text[]`),
    /** Extra individual addresses added to the recipients (validated, capped in the domain service). */
    extraEmails: text("extra_emails").array().notNull().default(sql`'{}'::text[]`),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.eventKey, t.channel] }),
    check("notification_rules_channel_chk", sql`${t.channel} in ('in_app', 'email', 'sms', 'whatsapp')`),
  ],
);

/** A store's own switch and extra recipient emails for one event and channel (store admin "also send to"). */
export const notificationTenantRules = tenantTable(
  "notification_tenant_rules",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    eventKey: text("event_key").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    extraEmails: text("extra_emails").array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("notification_tenant_rules_uniq").on(t.tenantId, t.eventKey, t.channel),
    check("notification_tenant_rules_channel_chk", sql`${t.channel} in ('in_app', 'email', 'sms', 'whatsapp')`),
  ],
);

/** One row of tokens for the BCom platform emails (platform to store admins and staff). Single row, id = 'default'. */
export const platformEmailBranding = pgTable("platform_email_branding", {
  id: text("id").primaryKey().default("default"),
  /** Validated EmailBrandingTokens JSON (colours, fonts, sizes, footer, logo URL). See email-branding.ts. */
  tokens: jsonb("tokens").notNull().default(sql`'{}'::jsonb`),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** A store's tokens for its customer emails: logo, colours, footer. Fonts are always the platform's. */
export const storeEmailBranding = tenantTable(
  "store_email_branding",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    tokens: jsonb("tokens").notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("store_email_branding_tenant_uniq").on(t.tenantId)],
);

/** In-app inbox for store users. `tab` is the drawer tab: orders | system. The Activity tab reads audit_logs instead. */
export const notifications = tenantTable(
  "notifications",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    tab: text("tab").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    /** Idempotency: one row per event reference and user. */
    eventRef: text("event_ref"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("notifications_tenant_user_idx").on(t.tenantId, t.userId, t.createdAt),
    unique("notifications_event_ref_uniq").on(t.tenantId, t.userId, t.eventRef),
    check("notifications_tab_chk", sql`${t.tab} in ('orders', 'system')`),
  ],
);

/** In-app inbox for Super Admin staff. `tab` is stores | billing | system. */
export const platformNotifications = pgTable(
  "platform_notifications",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    tab: text("tab").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    eventRef: text("event_ref"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("platform_notifications_user_idx").on(t.userId, t.createdAt),
    unique("platform_notifications_event_ref_uniq").on(t.userId, t.eventRef),
    check("platform_notifications_tab_chk", sql`${t.tab} in ('stores', 'billing', 'system')`),
  ],
);
