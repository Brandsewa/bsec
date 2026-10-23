import { sql } from "drizzle-orm";
import { boolean, check, index, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { customers } from "./customers.ts";

/**
 * A store's own Google sign-in setup for its customers (docs/GOOGLE-SIGNIN-PLAN.md, Tier B).
 * Holds only the public Client ID: the store creates its own Google app, and One Tap needs no secret. `verifiedAt`
 * is set only by a real test sign-in on the store's custom domain (`verifiedHost`), and is void when the Client ID
 * or that domain changes.
 */
export const storeSocialAuth = tenantTable(
  "store_social_auth",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    provider: text("provider").notNull(), // 'google'
    enabled: boolean("enabled").notNull().default(false),
    clientId: text("client_id"),
    oneTapEnabled: boolean("one_tap_enabled").notNull().default(true),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedClientId: text("verified_client_id"),
    verifiedHost: text("verified_host"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("store_social_auth_tenant_provider_uniq").on(t.tenantId, t.provider),
    unique("store_social_auth_tenant_id_uniq").on(t.tenantId, t.id),
    check("store_social_auth_provider_chk", sql`${t.provider} in ('google')`),
  ],
);

/**
 * Links a customer to an external identity (the Google `sub`). The identity key is the provider's subject, never
 * the email, and the same subject in two stores is two independent customers.
 */
export const customerIdentities = tenantTable(
  "customer_identities",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    customerId: uuid("customer_id").notNull(),
    provider: text("provider").notNull(), // 'google'
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("customer_identities_tenant_provider_subject_uniq").on(t.tenantId, t.provider, t.subject),
    unique("customer_identities_tenant_id_uniq").on(t.tenantId, t.id),
    index("customer_identities_tenant_customer_idx").on(t.tenantId, t.customerId),
    check("customer_identities_provider_chk", sql`${t.provider} in ('google')`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "customer_identities_customer_fk",
      onDelete: "cascade",
    }),
  ],
);
