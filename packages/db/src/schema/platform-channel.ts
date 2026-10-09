import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

/**
 * Platform Channel Providers (ADMIN-IMPROVEMENTS-PLAN Phase 4, §6.2).
 * Platform-wide SMS and WhatsApp provider configuration (Zoho CPaaS).
 * Platform-level: no tenant column, writable only by app_platform, read-only by app_rw, no RLS.
 */
export const platformChannelProviders = pgTable(
  "platform_channel_providers",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    channel: text("channel").notNull(), // 'sms' | 'whatsapp'
    provider: text("provider").notNull(), // 'zoho_cpaas'
    displayName: text("display_name").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`), // non-secret: baseUrl, senderKey, templateMap
    secretCiphertext: text("secret_ciphertext"),
    secretIv: text("secret_iv"),
    secretKeyVersion: integer("secret_key_version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestStatus: text("last_test_status"), // 'success' | 'failed'
    lastTestError: text("last_test_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("platform_channel_providers_default_idx")
      .on(t.channel)
      .where(sql`is_default = true`),
  ],
);

/**
 * Platform Message Log (ADMIN-IMPROVEMENTS-PLAN Phase 4, §6.2).
 * Platform diagnostic log for SMS and WhatsApp dispatches.
 * Privacy invariant: never stores message bodies, OTPs, or full phone numbers.
 * Retention: 90-day prune pass in worker maintenance.
 */
export const platformMessageLog = pgTable(
  "platform_message_log",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    channel: text("channel").notNull(), // 'sms' | 'whatsapp'
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    toMasked: text("to_masked").notNull(), // masked phone number e.g. "******7890" (last 4 digits only)
    template: text("template").notNull(),
    provider: text("provider").notNull(), // 'zoho_cpaas'
    status: text("status").notNull(), // 'sent' | 'failed' | 'skipped'
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("platform_message_log_created_at_idx").on(t.createdAt),
    index("platform_message_log_channel_idx").on(t.channel),
    index("platform_message_log_tenant_idx").on(t.tenantId),
  ],
);
