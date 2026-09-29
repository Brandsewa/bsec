import { sql } from "drizzle-orm";
import {
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";

/**
 * Tenant Secrets (PLAN §4, §5.3 / M4).
 * Secure storage for provider credentials (Razorpay key/secret, etc.)
 * encrypted with AES-256-GCM. Never returned to the browser.
 */
export const tenantSecrets = tenantTable(
  "tenant_secrets",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    provider: text("provider").notNull(),
    keyName: text("key_name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("tenant_secrets_tenant_provider_key_uniq").on(t.tenantId, t.provider, t.keyName),
  ],
);
