import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Platform billing credentials (ADR-036). The platform's own Razorpay account for charging merchants; separate from
 * every store's payment keys (ADR-014). One row. Platform-level: no tenant column, no RLS, written only by
 * app_platform, read by app_saas. Secrets are encrypted; key ids are stored as given.
 */
export const platformBillingSettings = pgTable("platform_billing_settings", {
  id: text("id").primaryKey().default("default"),
  provider: text("provider").notNull().default("razorpay"),
  // Which key set is in use. Switching to 'live' is a deliberate owner action.
  mode: text("mode").notNull().default("test"),
  enabled: boolean("enabled").notNull().default(false),
  // Days a store keeps its plan after a failed payment before it is limited.
  graceDays: integer("grace_days").notNull().default(7),
  testKeyId: text("test_key_id"),
  testSecretCiphertext: text("test_secret_ciphertext"),
  testSecretIv: text("test_secret_iv"),
  testWebhookCiphertext: text("test_webhook_ciphertext"),
  testWebhookIv: text("test_webhook_iv"),
  liveKeyId: text("live_key_id"),
  liveSecretCiphertext: text("live_secret_ciphertext"),
  liveSecretIv: text("live_secret_iv"),
  liveWebhookCiphertext: text("live_webhook_ciphertext"),
  liveWebhookIv: text("live_webhook_iv"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestStatus: text("last_test_status"),
  lastTestError: text("last_test_error"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
