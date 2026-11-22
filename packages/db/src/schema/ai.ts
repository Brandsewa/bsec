import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { users } from "./identity.ts";
import { tenants } from "./tenants.ts";

/**
 * AI access for stores (ADR-050, docs/MCP-PLAN.md). Tables are named for agents, not for MCP, so a later protocol reuses them.
 *
 * Tenant tables (forced RLS): store_ai_settings, agent_connections, agent_call_log.
 * Platform-scoped tables (no RLS, like support_sessions, because an OAuth client, an authorization request or a token must be
 * resolved BEFORE the store is known): oauth_clients, oauth_authorization_requests, agent_tokens. Only hashes of secrets are stored.
 */

/** One row per store: the master switch, the permission matrix and the accepted consent version. */
export const storeAiSettings = tenantTable(
  "store_ai_settings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    /** `{ products: { read, write, delete }, collections: {...}, ... }`; validated by the domain (ai/matrix.ts). Missing = off. */
    matrix: jsonb("matrix").notNull().default({}),
    /** Extra switch under Products: may the AI make products visible (publish). */
    allowPublishing: boolean("allow_publishing").notNull().default(false),
    consentVersion: integer("consent_version"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentByUserId: uuid("consent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [unique("store_ai_settings_tenant_uniq").on(t.tenantId)],
);

/** A connected AI app: one store, the staff user who approved it, one OAuth client. */
export const agentConnections = tenantTable(
  "agent_connections",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    /** mcp today; any later adapter writes its own value. */
    protocol: text("protocol").notNull().default("mcp"),
    /** active | revoked | paused (abuse pause or plan downgrade). */
    status: text("status").notNull().default("active"),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("agent_connections_tenant_id_uniq").on(t.tenantId, t.id),
    index("agent_connections_tenant_status_idx").on(t.tenantId, t.status),
    index("agent_connections_user_idx").on(t.userId),
  ],
);

/** One row per AI call, for the activity log and usage meter. Never holds payloads or prompts. Pruned after 90 days. */
export const agentCallLog = tenantTable(
  "agent_call_log",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    tool: text("tool").notNull(),
    /** ok | denied | rate_limited | error */
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    bytes: integer("bytes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("agent_call_log_tenant_time_idx").on(t.tenantId, t.createdAt),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.connectionId, target: agentConnections, name: "agent_call_log_connection_fk", onDelete: "cascade" }),
  ],
);

/** Registered OAuth clients (dynamic registration, or a client metadata document fetched from an allowlisted host). Platform-scoped. */
export const oauthClients = pgTable("oauth_clients", {
  /** The client_id: `bsc_...` for dynamic registration, the metadata document URL for CIMD. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").notNull().default([]),
  /** dcr | cimd */
  source: text("source").notNull().default("dcr"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** A pending authorization (before the merchant approves) and, once approved, its single-use code. Platform-scoped. */
export const oauthAuthorizationRequests = pgTable(
  "oauth_authorization_requests",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    state: text("state"),
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope"),
    resource: text("resource"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Filled when the merchant approves. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    codeHash: text("code_hash").unique(),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("oauth_authorization_requests_expires_idx").on(t.expiresAt)],
);

/** Access and refresh tokens. Platform-scoped; only the SHA-256 of the token is stored. `family` links a refresh chain for reuse detection. */
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    /** access | refresh */
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    family: uuid("family").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("agent_tokens_connection_idx").on(t.tenantId, t.connectionId), index("agent_tokens_family_idx").on(t.family)],
);
