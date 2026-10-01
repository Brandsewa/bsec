import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { citext } from "./custom-types.ts";
import { tenants } from "./tenants.ts";
import { users } from "./identity.ts";

/**
 * Platform Email Settings (AUTH-OVERHAUL-PLAN §3.1).
 * Single platform-wide SMTP configuration row (Zoho ZeptoMail).
 * Platform-level: no tenant column, writable only by app_platform, no RLS.
 */
export const platformEmailSettings = pgTable("platform_email_settings", {
  id: text("id").primaryKey().default("default"), // Enforces single row
  provider: text("provider").notNull().default("zoho_zeptomail"),
  host: text("host").notNull().default("smtp.zeptomail.in"),
  port: integer("port").notNull().default(587),
  secureMode: text("secure_mode").notNull().default("starttls"), // 'starttls' | 'ssl'
  username: text("username").notNull().default("emailapikey"),
  passwordCiphertext: text("password_ciphertext"),
  passwordIv: text("password_iv"),
  keyVersion: integer("key_version").notNull().default(1),
  fromEmail: citext("from_email").notNull().default("no-reply@gobs.cloud"),
  fromName: text("from_name").notNull().default("Brand Sewa"),
  replyTo: citext("reply_to"),
  enabled: boolean("enabled").notNull().default(false),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestStatus: text("last_test_status"), // 'success' | 'failed'
  lastTestError: text("last_test_error"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Platform Email Log (AUTH-OVERHAUL-PLAN §3.1).
 * Platform-level diagnostic log for all emails sent via platform mailer.
 * Never stores message bodies or reset links.
 */
export const platformEmailLog = pgTable(
  "platform_email_log",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    toEmail: citext("to_email").notNull(),
    template: text("template").notNull(),
    status: text("status").notNull(), // 'sent' | 'failed' | 'skipped'
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("platform_email_log_created_at_idx").on(t.createdAt),
    index("platform_email_log_tenant_idx").on(t.tenantId),
    index("platform_email_log_to_email_idx").on(t.toEmail),
  ],
);
