import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Platform Storage Connections (ADMIN-IMPROVEMENTS-PLAN Phase 1, SA-1).
 * Platform-level storage connection configurations (Local, Cloudflare R2, S3-compatible).
 * Platform-scoped: no tenant column, writable only by app_platform, no RLS.
 * Read-only for app_rw so web/worker can resolve upload endpoints and public URLs.
 */
export const platformStorageConnections = pgTable(
  "platform_storage_connections",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    driver: text("driver").notNull(), // 'local' | 'r2' | 's3'
    purpose: text("purpose").notNull(), // 'public_media' | 'private_files'
    isActive: boolean("is_active").notNull().default(false),
    status: text("status").notNull().default("untested"), // 'untested' | 'ok' | 'failed'
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestError: text("last_test_error"),

    // Non-secret config
    endpoint: text("endpoint"),
    region: text("region"),
    bucket: text("bucket"),
    publicBaseUrl: text("public_base_url"),
    forcePathStyle: boolean("force_path_style").notNull().default(false),
    localDir: text("local_dir"),
    accountId: text("account_id"),
    directBrowserUpload: boolean("direct_browser_upload").notNull().default(false),

    // Secrets (AES-256-GCM encrypted via TENANT_SECRETS_KEY)
    accessKeyIdCiphertext: text("access_key_id_ciphertext"),
    secretAccessKeyCiphertext: text("secret_access_key_ciphertext"),
    iv: text("iv"),
    keyVersion: integer("key_version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("platform_storage_connections_active_purpose_idx")
      .on(t.purpose)
      .where(sql`is_active = true`),
  ],
);
