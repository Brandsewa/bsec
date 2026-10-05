import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";

/**
 * Store Policy Versions (Settings Phase 7 / PLAN §5.4).
 * Append-only immutable version snapshots of published policies.
 * Privileges: app_rw is granted SELECT, INSERT only (no UPDATE/DELETE).
 */
export const storePolicyVersions = tenantTable(
  "store_policy_versions",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    policyId: uuid("policy_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    contentSha256: text("content_sha256").notNull(),
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("store_policy_versions_policy_version_uniq").on(t.policyId, t.version),
    unique("store_policy_versions_tenant_id_uniq").on(t.tenantId, t.id),
    check("store_policy_versions_version_chk", sql`${t.version} >= 1`),
  ],
);

/**
 * Store Policies (Settings Phase 7 / PLAN §5.4).
 * Single authoritative policy root entity per store handle.
 * Allowed handles: refund, privacy, terms, shipping, legal_notice.
 */
export const storePolicies = tenantTable(
  "store_policies",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    draftContent: jsonb("draft_content").notNull(),
    publishedVersionId: uuid("published_version_id"),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("store_policies_tenant_handle_uniq").on(t.tenantId, t.handle),
    unique("store_policies_tenant_id_uniq").on(t.tenantId, t.id),
    check("store_policies_handle_chk", sql`${t.handle} IN ('refund', 'privacy', 'terms', 'shipping', 'legal_notice')`),
    check("store_policies_title_chk", sql`char_length(${t.title}) BETWEEN 1 AND 120`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.publishedVersionId,
      target: storePolicyVersions,
      name: "store_policies_published_version_fk",
      onDelete: "set null",
    }),
  ],
);

