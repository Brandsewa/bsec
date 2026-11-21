import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";

/**
 * Global users: merchants, store staff, platform team (PLAN §4, §5.3).
 * Backs Better Auth staff user model. Global; no RLS.
 */
export const users = pgTable("users", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  email: citext("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  phone: text("phone"),
  image: text("image"),
  /** Platform (Super Admin) authenticator. The tenant runtime never touches this or `two_factors`. */
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  /** Store-admin authenticator (optional), backed by `staff_two_factors` (migration 0118). */
  storeTwoFactorEnabled: boolean("store_two_factor_enabled").default(false),
  locale: text("locale").default("en"),
  /** Profile preferences (account page); NULL means the default. */
  jobTitle: text("job_title"),
  timezone: text("timezone"),
  dateFormat: text("date_format"),
  timeFormat: text("time_format"),
  defaultLanding: text("default_landing"),
  uiDensity: text("ui_density"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Better Auth staff sessions (PLAN §5.3).
 * Global; no RLS.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Better Auth staff accounts (credentials, OAuth providers) (PLAN §5.3).
 * Global; no RLS.
 */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => [
  // Sign-in looks an account up by user (audit A10-02, migration 0114).
  index("accounts_user_id_idx").on(t.userId),
]);

/**
 * Better Auth email/phone verifications (PLAN §5.3).
 * Global; no RLS.
 */
export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Better Auth Two-Factor Authentication credentials (PLAN §4, §6).
 * Used for platform_staff TOTP and backup codes. Global; no RLS.
 */
export const twoFactors = pgTable("two_factors", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(false),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});


/**
 * Store staff authenticator credentials (TOTP seed and backup codes, encrypted by Better Auth). Separate from
 * `two_factors` on purpose: that table is platform-only (migration 0014) and must stay invisible to app_rw.
 */
export const staffTwoFactors = pgTable("staff_two_factors", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(false),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Sign-in security trail for a staff or platform user (account page "Recent security activity"). Global; no RLS;
 * app_rw may insert and read only (migration 0116 revokes update and delete).
 */
export const securityEvents = pgTable("security_events", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** Alerts a user muted for themselves (never adds an alert the store did not route to them). Global; no RLS. */
export const userNotificationMutes = pgTable(
  "user_notification_mutes",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventKey] })],
);

/**
 * Roles: system roles seeded per store + custom roles (PLAN §5.3).
 * Tenant table: RLS enabled.
 */
export const roles = tenantTable(
  "roles",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("roles_tenant_name_uniq").on(t.tenantId, t.name),
    unique("roles_tenant_id_uniq").on(t.tenantId, t.id),
  ],
);

/**
 * Memberships: links staff user to a store with a role (PLAN §4, §5.3).
 * Tenant table: RLS enabled. Checked by admin procedures against X-Store-Id.
 */
export const memberships = tenantTable(
  "memberships",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull(),
    status: text("status").notNull().default("active"),
    invitedBy: uuid("invited_by"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("memberships_tenant_user_uniq").on(t.tenantId, t.userId),
    // "Which stores is this user in" is asked on every admin load (audit A10-02, migration 0114).
    index("memberships_user_id_idx").on(t.userId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.roleId,
      target: roles,
      onDelete: "restrict",
      name: "memberships_role_fk",
    }),
  ],
);

/**
 * Staff invitations: pending invites to join store staff (PLAN §5.3).
 * Tenant table: RLS enabled.
 */
export const staffInvitations = tenantTable(
  "staff_invitations",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    email: citext("email").notNull(),
    roleId: uuid("role_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("staff_invitations_tenant_email_uniq").on(t.tenantId, t.email),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.roleId,
      target: roles,
      onDelete: "restrict",
      name: "staff_invitations_role_fk",
    }),
  ],
);

/**
 * Audit logs: store-visible mutation trail (PLAN §5.3).
 * Tenant table: RLS enabled.
 */
export const auditLogs = tenantTable("audit_logs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  diff: jsonb("diff"),
  ip: text("ip"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => [
  // The activity views read one store's newest rows; the table only grows (audit A10-02, migration 0114).
  index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt.desc()),
]);

/**
 * Customer sessions: store customer Better Auth sessions (PLAN §5.6, M1 minimal).
 * Tenant table: RLS enabled.
 */
export const customerSessions = tenantTable("customer_sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id"),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => [
  // Sign-out everywhere and the account page look sessions up by customer (audit A10-02, migration 0114).
  index("customer_sessions_user_idx").on(t.tenantId, t.userId),
]);
