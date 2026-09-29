import { sql } from "drizzle-orm";
import {
  boolean,
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
import { tenants } from "./tenants.ts";

/**
 * Webhook Inbox (PLAN §5.10, §11.4 / M4).
 * Decoupled inbound webhook queue.
 *
 * CRITICAL CORRECTNESS CONSTRAINT:
 * unique(provider, event_id) — NOT unique on event_id alone.
 * Documented bug: Shiprocket event ID can collide with Razorpay event ID.
 */
export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    signatureValid: boolean("signature_valid").notNull(),
    payloadSanitized: jsonb("payload_sanitized").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`now()`),
    status: text("status").notNull().default("received"), // 'received', 'processing', 'processed', 'failed'
    attempts: integer("attempts").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("webhook_inbox_provider_event_id_uniq").on(t.provider, t.eventId),
    index("webhook_inbox_status_idx").on(t.status),
    index("webhook_inbox_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Idempotency Keys (PLAN §5.10 / M4).
 * Prevents double order placement, duplicate captures, etc. 24h retention.
 */
export const idempotencyKeys = tenantTable(
  "idempotency_keys",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    key: text("key").notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("idempotency_keys_tenant_key_route_uniq").on(t.tenantId, t.key, t.route),
    index("idempotency_keys_tenant_expires_idx").on(t.tenantId, t.expiresAt),
  ],
);

/**
 * Email Log (PLAN §5.10 / M5).
 * Tracks all transactional emails sent or enqueued per tenant.
 */
export const emailLog = tenantTable(
  "email_log",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    template: text("template").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    providerId: text("provider_id"),
    status: text("status").notNull().default("queued"), // queued, sent, failed
    eventRef: text("event_ref"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    unique("email_log_tenant_id_uniq").on(t.tenantId, t.id),
    index("email_log_tenant_status_idx").on(t.tenantId, t.status),
    index("email_log_tenant_to_email_idx").on(t.tenantId, t.toEmail),
  ],
);
