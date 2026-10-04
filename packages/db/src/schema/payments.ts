import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { orders } from "./orders.ts";

/**
 * Payment Intents (PLAN §5.7 / M4).
 * Provider-neutral payment intent tracking the payment lifecycle.
 */
export const paymentIntents = tenantTable(
  "payment_intents",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    provider: text("provider").notNull(), // 'razorpay', 'cod', 'stripe'
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("created"),
    providerOrderId: text("provider_order_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("payment_intents_tenant_id_uniq").on(t.tenantId, t.id),
    index("payment_intents_tenant_order_idx").on(t.tenantId, t.orderId),
    index("payment_intents_tenant_provider_order_idx").on(t.tenantId, t.providerOrderId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "payment_intents_order_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Payment Attempts (PLAN §5.7 / M4).
 * Granular payment attempt records per payment intent.
 */
export const paymentAttempts = tenantTable(
  "payment_attempts",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    intentId: uuid("intent_id").notNull(),
    providerPaymentId: text("provider_payment_id"),
    method: text("method"), // 'upi', 'card', 'netbanking', 'wallet', 'cod'
    status: text("status").notNull().default("pending"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    raw: jsonb("raw").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("payment_attempts_tenant_intent_idx").on(t.tenantId, t.intentId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.intentId,
      target: paymentIntents,
      name: "payment_attempts_intent_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Refunds (PLAN §5.7 / M4).
 * Tracks partial or full refunds against captured payments.
 */
export const refunds = tenantTable(
  "refunds",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    intentId: uuid("intent_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    method: text("method"), // upi, bank_transfer, cash, original_payment_method, other
    reference: text("reference"),
    providerRefundId: text("provider_refund_id"),
    initiatedBy: text("initiated_by").notNull().default("admin"),
    restock: boolean("restock").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("refunds_tenant_order_idx").on(t.tenantId, t.orderId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "refunds_order_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.intentId,
      target: paymentIntents,
      name: "refunds_intent_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Payment Methods (Settings Phase 5 / SETTINGS-SCHEMA §6.1).
 * Metadata and merchant-configuration for checkout payment methods.
 */
export const paymentMethods = tenantTable(
  "payment_methods",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    provider: text("provider").notNull(), // 'cod' | 'razorpay'
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("disabled"), // 'disabled' | 'pending_setup' | 'active' | 'unavailable' | 'error'
    mode: text("mode"), // 'live' | 'test' | null
    sortOrder: integer("sort_order").notNull().default(0),
    publicConfig: jsonb("public_config").notNull().default(sql`'{}'::jsonb`),
    setupState: jsonb("setup_state").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("payment_methods_tenant_provider_uniq").on(t.tenantId, t.provider),
    unique("payment_methods_tenant_id_id_uniq").on(t.tenantId, t.id),
  ],
);

