import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Platform auth providers (docs/GOOGLE-SIGNIN-PLAN.md section 5, 6).
 * On/off switches for social sign-in. Holds no secrets. Platform-level: no tenant column, writable only by
 * app_platform, read-only by app_rw, no RLS.
 *  - enabled: Tier A, Google sign-in for Super Admin, platform staff and store owners/staff.
 *  - staffSignupAllowed: lets a new store owner create their account with Google on /signup.
 *  - customerSigninAllowed: lets stores (with a verified custom domain) offer Google to their own customers (Tier B).
 */
export const platformAuthProviders = pgTable("platform_auth_providers", {
  provider: text("provider").primaryKey(), // 'google'
  kind: text("kind").notNull().default("social"),
  displayName: text("display_name").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  staffSignupAllowed: boolean("staff_signup_allowed").notNull().default(true),
  customerSigninAllowed: boolean("customer_signin_allowed").notNull().default(false),
  oneTapAllowed: boolean("one_tap_allowed").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * The single platform Google OAuth client (Tier A only). The Client ID is public configuration; the secret is
 * AES-256-GCM encrypted (TENANT_SECRETS_KEY) and never returned across an API boundary.
 */
export const platformGoogleClient = pgTable(
  "platform_google_client",
  {
    id: text("id").primaryKey().default("default"),
    clientId: text("client_id"),
    secretCiphertext: text("secret_ciphertext"),
    secretIv: text("secret_iv"),
    keyVersion: integer("key_version").notNull().default(1),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestStatus: text("last_test_status"), // 'success' | 'failed'
    lastTestError: text("last_test_error"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [check("platform_google_client_single_row", sql`${t.id} = 'default'`)],
);
