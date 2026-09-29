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
