import { sql } from "drizzle-orm";
import { bigint, boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
  // The platform's Cashfree credentials (ADR-037). Cashfree signs webhooks with the client secret, so no webhook secret.
  cashfreeTestClientId: text("cashfree_test_client_id"),
  cashfreeTestSecretCiphertext: text("cashfree_test_secret_ciphertext"),
  cashfreeTestSecretIv: text("cashfree_test_secret_iv"),
  cashfreeLiveClientId: text("cashfree_live_client_id"),
  cashfreeLiveSecretCiphertext: text("cashfree_live_secret_ciphertext"),
  cashfreeLiveSecretIv: text("cashfree_live_secret_iv"),
  // Who issues the GST invoices (billing B6). The plan price is quoted inclusive of this tax.
  invoiceLegalName: text("invoice_legal_name"),
  invoiceAddress: text("invoice_address"),
  invoiceState: text("invoice_state"),
  invoiceGstin: text("invoice_gstin"),
  invoiceSac: text("invoice_sac"),
  gstRateBps: integer("gst_rate_bps").notNull().default(1800),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestStatus: text("last_test_status"),
  lastTestError: text("last_test_error"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Razorpay plans the platform created for its own plans (billing B2). Razorpay plans cannot be edited and differ between
 * test and live mode, so each (plan, interval, mode, amount) is its own row; the newest row for the active mode is used.
 */
export const platformRazorpayPlans = pgTable(
  "platform_razorpay_plans",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    planId: uuid("plan_id").notNull(),
    interval: text("interval").notNull(), // monthly | yearly
    mode: text("mode").notNull(), // test | live
    razorpayPlanId: text("razorpay_plan_id").notNull(),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("platform_razorpay_plans_uniq").on(t.planId, t.interval, t.mode, t.amountPaise)],
);

/** Gapless platform invoice numbering per financial-year series (billing B4). Locked by the issuing transaction. */
export const platformInvoiceCounters = pgTable("platform_invoice_counters", {
  series: text("series").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});
