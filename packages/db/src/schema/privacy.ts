import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { customers } from "./customers.ts";

/**
 * Privacy Settings (Settings Phase 7 / PLAN §5.4).
 * Single row per tenant configuring contact point, grievance officer, and SLA.
 */
export const privacySettings = tenantTable(
  "privacy_settings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    privacyContactEmail: citext("privacy_contact_email"),
    grievanceOfficerName: text("grievance_officer_name"),
    requestSlaDays: integer("request_sla_days").notNull().default(30),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("privacy_settings_tenant_id_uniq").on(t.tenantId),
    unique("privacy_settings_tenant_id_id_uniq").on(t.tenantId, t.id),
    check("privacy_settings_sla_chk", sql`${t.requestSlaDays} BETWEEN 7 AND 90`),
    check("privacy_settings_grievance_officer_chk", sql`${t.grievanceOfficerName} IS NULL OR char_length(${t.grievanceOfficerName}) BETWEEN 1 AND 120`),
  ],
);

/**
 * Privacy Requests (Settings Phase 7 / PLAN §5.4 / DPDP Act 2023).
 * Data principal requests (access, correction, erasure, grievance, withdraw_consent).
 */
export const privacyRequests = tenantTable(
  "privacy_requests",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    customerId: uuid("customer_id"),
    requesterEmail: citext("requester_email").notNull(),
    kind: text("kind").notNull(),
    details: text("details"),
    status: text("status").notNull().default("pending_verification"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    handledBy: uuid("handled_by"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("privacy_requests_tenant_id_uniq").on(t.tenantId, t.id),
    index("privacy_requests_tenant_status_due_idx").on(t.tenantId, t.status, t.dueAt),
    check("privacy_requests_kind_chk", sql`${t.kind} IN ('access', 'correction', 'erasure', 'grievance', 'withdraw_consent')`),
    check("privacy_requests_details_chk", sql`${t.details} IS NULL OR char_length(${t.details}) <= 2000`),
    check("privacy_requests_status_chk", sql`${t.status} IN ('pending_verification', 'open', 'in_progress', 'completed', 'rejected')`),
    check("privacy_requests_resolution_note_chk", sql`${t.resolutionNote} IS NULL OR char_length(${t.resolutionNote}) <= 1000`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "privacy_requests_customer_fk",
      onDelete: "set null",
    }),
  ],
);
