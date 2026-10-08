import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { encryptSecret, decryptSecret } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import {
  assertPlatformStaff,
  assertRoleAtLeast,
  writePlatformAudit,
  type AuditMeta,
} from "../platform-services.ts";
import {
  createStorageDriver,
  invalidateStorageConnectionCache,
  type ResolvedStorageConfig,
  type StorageDriverType,
  type StoragePurpose,
} from "../media/connection.ts";

export interface CreateStorageConnectionInput {
  name: string;
  driver: "local" | "r2" | "s3";
  purpose: "public_media" | "private_files";
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket?: string | undefined;
  publicBaseUrl?: string | undefined;
  forcePathStyle?: boolean | undefined;
  localDir?: string | undefined;
  accountId?: string | undefined;
  directBrowserUpload?: boolean | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
}

export interface UpdateStorageConnectionInput {
  id: string;
  name?: string | undefined;
  driver?: "local" | "r2" | "s3" | undefined;
  purpose?: "public_media" | "private_files" | undefined;
  endpoint?: string | null | undefined;
  region?: string | null | undefined;
  bucket?: string | null | undefined;
  publicBaseUrl?: string | null | undefined;
  forcePathStyle?: boolean | undefined;
  localDir?: string | null | undefined;
  accountId?: string | null | undefined;
  directBrowserUpload?: boolean | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
}

function shapeConnectionView(row: typeof schema.platformStorageConnections.$inferSelect) {
  let accessKeyIdLast4: string | null = null;
  const hasAccessKey = Boolean(row.accessKeyIdCiphertext && row.iv);
  const hasSecretAccessKey = Boolean(row.secretAccessKeyCiphertext && row.iv);

  if (row.accessKeyIdCiphertext && row.iv) {
    try {
      const decrypted = decryptSecret({ ciphertext: row.accessKeyIdCiphertext, iv: row.iv });
      accessKeyIdLast4 = decrypted.length >= 4 ? decrypted.slice(-4) : decrypted;
    } catch {
      // Key not decryptable with current secret
    }
  }

  return {
    id: row.id,
    name: row.name,
    driver: row.driver as "local" | "r2" | "s3",
    purpose: row.purpose as "public_media" | "private_files",
    isActive: row.isActive,
    status: row.status as "untested" | "ok" | "failed",
    lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : null,
    lastTestError: row.lastTestError ?? null,
    endpoint: row.endpoint ?? null,
    region: row.region ?? null,
    bucket: row.bucket ?? null,
    publicBaseUrl: row.publicBaseUrl ?? null,
    forcePathStyle: row.forcePathStyle,
    localDir: row.localDir ?? null,
    accountId: row.accountId ?? null,
    directBrowserUpload: row.directBrowserUpload,
    hasAccessKey,
    accessKeyIdLast4,
    hasSecretAccessKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Lists all platform storage connections. Secrets are NEVER returned!
 */
export async function listPlatformStorageConnections(
  rt: Runtime,
  platformStaffUserId: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const rows = await db
    .select()
    .from(schema.platformStorageConnections)
    .orderBy(desc(schema.platformStorageConnections.createdAt));

  return rows.map(shapeConnectionView);
}

/**
 * Gets a platform storage connection by ID. Secrets are NEVER returned!
 */
export async function getPlatformStorageConnection(
  rt: Runtime,
  platformStaffUserId: string,
  id: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const rows = await db
    .select()
    .from(schema.platformStorageConnections)
    .where(eq(schema.platformStorageConnections.id, id))
    .limit(1);

  if (!rows[0]) {
    throw new Error("Storage connection not found");
  }

  return shapeConnectionView(rows[0]);
}

/**
 * Creates a new platform storage connection. Encrypts credentials with AES-256-GCM.
 */
export async function createPlatformStorageConnection(
  rt: Runtime,
  platformStaffUserId: string,
  input: CreateStorageConnectionInput,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "create storage connection");

  const db = rt._db.db;

  let accessKeyIdCiphertext: string | null = null;
  let secretAccessKeyCiphertext: string | null = null;
  let iv: string | null = null;
  let keyVersion = 1;

  if (input.accessKeyId?.trim() || input.secretAccessKey?.trim()) {
    if (input.accessKeyId?.trim()) {
      const encKey = encryptSecret(input.accessKeyId.trim());
      accessKeyIdCiphertext = encKey.ciphertext;
      iv = encKey.iv;
      keyVersion = encKey.keyVersion;
    }
    if (input.secretAccessKey?.trim()) {
      // Use the same IV if already created, or new IV
      const encSecret = encryptSecret(input.secretAccessKey.trim());
      secretAccessKeyCiphertext = encSecret.ciphertext;
      if (!iv) iv = encSecret.iv;
    }
  }

  const [created] = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.platformStorageConnections)
      .values({
        name: input.name.trim(),
        driver: input.driver,
        purpose: input.purpose,
        isActive: false, // New connections start inactive until tested/activated
        status: "untested",
        endpoint: input.endpoint?.trim() || null,
        region: input.region?.trim() || null,
        bucket: input.bucket?.trim() || null,
        publicBaseUrl: input.publicBaseUrl?.trim() || null,
        forcePathStyle: input.forcePathStyle ?? false,
        localDir: input.localDir?.trim() || null,
        accountId: input.accountId?.trim() || null,
        directBrowserUpload: input.directBrowserUpload ?? false,
        accessKeyIdCiphertext,
        secretAccessKeyCiphertext,
        iv,
        keyVersion,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert storage connection");
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "storage_connection.create",
      "platform_storage_connections",
      row.id,
      null,
      {
        name: row.name,
        driver: row.driver,
        purpose: row.purpose,
        bucket: row.bucket,
        endpoint: row.endpoint,
        localDir: row.localDir,
      },
      meta,
    );

    return [row];
  });

  invalidateStorageConnectionCache();

  return { id: created.id, ok: true };
}

/**
 * Updates a platform storage connection. Secrets are write-only and optional.
 */
export async function updatePlatformStorageConnection(
  rt: Runtime,
  platformStaffUserId: string,
  input: UpdateStorageConnectionInput,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "update storage connection");

  const db = rt._db.db;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.platformStorageConnections)
      .where(eq(schema.platformStorageConnections.id, input.id))
      .limit(1);

    if (!existing[0]) {
      throw new Error("Storage connection not found");
    }

    const prev = existing[0];
    let accessKeyIdCiphertext = prev.accessKeyIdCiphertext;
    let secretAccessKeyCiphertext = prev.secretAccessKeyCiphertext;
    let iv = prev.iv;
    let keyVersion = prev.keyVersion;

    if (input.accessKeyId && input.accessKeyId.trim().length > 0) {
      const enc = encryptSecret(input.accessKeyId.trim());
      accessKeyIdCiphertext = enc.ciphertext;
      iv = enc.iv;
      keyVersion = enc.keyVersion;
    }

    if (input.secretAccessKey && input.secretAccessKey.trim().length > 0) {
      const enc = encryptSecret(input.secretAccessKey.trim());
      secretAccessKeyCiphertext = enc.ciphertext;
      if (!iv) iv = enc.iv;
    }

    await tx
      .update(schema.platformStorageConnections)
      .set({
        name: input.name !== undefined ? input.name.trim() : prev.name,
        driver: input.driver ?? prev.driver,
        purpose: input.purpose ?? prev.purpose,
        endpoint: input.endpoint !== undefined ? (input.endpoint?.trim() || null) : prev.endpoint,
        region: input.region !== undefined ? (input.region?.trim() || null) : prev.region,
        bucket: input.bucket !== undefined ? (input.bucket?.trim() || null) : prev.bucket,
        publicBaseUrl: input.publicBaseUrl !== undefined ? (input.publicBaseUrl?.trim() || null) : prev.publicBaseUrl,
        forcePathStyle: input.forcePathStyle ?? prev.forcePathStyle,
        localDir: input.localDir !== undefined ? (input.localDir?.trim() || null) : prev.localDir,
        accountId: input.accountId !== undefined ? (input.accountId?.trim() || null) : prev.accountId,
        directBrowserUpload: input.directBrowserUpload ?? prev.directBrowserUpload,
        accessKeyIdCiphertext,
        secretAccessKeyCiphertext,
        iv,
        keyVersion,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.platformStorageConnections.id, input.id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "storage_connection.update",
      "platform_storage_connections",
      input.id,
      null,
      {
        name: input.name ?? prev.name,
        driver: input.driver ?? prev.driver,
        purpose: input.purpose ?? prev.purpose,
        keysUpdated: Boolean(input.accessKeyId || input.secretAccessKey),
      },
      meta,
    );
  });

  invalidateStorageConnectionCache();

  return { ok: true };
}

/**
 * Activates a storage connection for its purpose.
 * Exactly one active connection per purpose; atomically deactivates previous.
 */
export async function activatePlatformStorageConnection(
  rt: Runtime,
  platformStaffUserId: string,
  id: string,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "activate storage connection");

  const db = rt._db.db;

  await db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(schema.platformStorageConnections)
      .where(eq(schema.platformStorageConnections.id, id))
      .limit(1);

    if (!target[0]) {
      throw new Error("Storage connection not found");
    }

    const purpose = target[0].purpose;

    // Deactivate existing connection for the same purpose
    await tx
      .update(schema.platformStorageConnections)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(eq(schema.platformStorageConnections.purpose, purpose));

    // Activate the target connection
    await tx
      .update(schema.platformStorageConnections)
      .set({ isActive: true, updatedAt: sql`now()` })
      .where(eq(schema.platformStorageConnections.id, id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "storage_connection.activate",
      "platform_storage_connections",
      id,
      null,
      {
        name: target[0].name,
        driver: target[0].driver,
        purpose,
      },
      meta,
    );
  });

  invalidateStorageConnectionCache();

  return { ok: true };
}

/**
 * Tests connection: performs diagnostics (put 1-byte, head, delete) and inspects bucket CORS.
 * Updates test status on the connection row.
 */
export async function testPlatformStorageConnection(
  rt: Runtime,
  platformStaffUserId: string,
  id: string,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "test storage connection");
  const db = rt._db.db;

  const rows = await db
    .select()
    .from(schema.platformStorageConnections)
    .where(eq(schema.platformStorageConnections.id, id))
    .limit(1);

  if (!rows[0]) {
    throw new Error("Storage connection not found");
  }

  const row = rows[0];
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;

  if (row.accessKeyIdCiphertext && row.iv) {
    try {
      accessKeyId = decryptSecret({ ciphertext: row.accessKeyIdCiphertext, iv: row.iv });
    } catch {
      // Decryption failed
    }
  }

  if (row.secretAccessKeyCiphertext && row.iv) {
    try {
      secretAccessKey = decryptSecret({ ciphertext: row.secretAccessKeyCiphertext, iv: row.iv });
    } catch {
      // Decryption failed
    }
  }

  const config: ResolvedStorageConfig = {
    id: row.id,
    name: row.name,
    driver: row.driver as StorageDriverType,
    purpose: row.purpose as StoragePurpose,
    isActive: row.isActive,
    endpoint: row.endpoint ?? undefined,
    region: row.region ?? undefined,
    bucket: row.bucket ?? undefined,
    publicBaseUrl: row.publicBaseUrl ?? undefined,
    forcePathStyle: row.forcePathStyle,
    localDir: row.localDir ?? undefined,
    accountId: row.accountId ?? undefined,
    directBrowserUpload: row.directBrowserUpload,
    accessKeyId,
    secretAccessKey,
  };

  const driver = createStorageDriver(config);
  const testRes = await driver.testConnection();

  const newStatus = testRes.ok ? "ok" : "failed";
  const newError = testRes.ok ? null : testRes.error || "Test failed";

  await db.transaction(async (tx) => {
    await tx
      .update(schema.platformStorageConnections)
      .set({
        status: newStatus,
        lastTestAt: sql`now()`,
        lastTestError: newError,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.platformStorageConnections.id, id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "storage_connection.test",
      "platform_storage_connections",
      id,
      null,
      {
        name: row.name,
        driver: row.driver,
        ok: testRes.ok,
        status: newStatus,
        error: newError,
      },
      meta,
    );
  });

  return {
    ok: testRes.ok,
    status: newStatus,
    error: newError ?? undefined,
    corsOk: testRes.corsOk,
    corsDetails: testRes.corsDetails,
  };
}

/**
 * Deletes a storage connection. Refused if any media records reference it.
 */
export async function deletePlatformStorageConnection(
  rt: Runtime,
  platformStaffUserId: string,
  id: string,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "delete storage connection");

  const db = rt._db.db;

  await db.transaction(async (tx) => {
    // Check if any media rows reference this connection
    const mediaRefs = await tx
      .select({ count: sql<string>`count(*)::text` })
      .from(schema.media)
      .where(eq(schema.media.storageConnectionId, id));

    const count = parseInt(mediaRefs[0]?.count ?? "0", 10);
    if (count > 0) {
      throw new Error(
        `Cannot delete storage connection: it is referenced by ${count} existing media record(s). Deactivate the connection instead.`,
      );
    }

    const existing = await tx
      .select()
      .from(schema.platformStorageConnections)
      .where(eq(schema.platformStorageConnections.id, id))
      .limit(1);

    if (!existing[0]) {
      throw new Error("Storage connection not found");
    }

    await tx
      .delete(schema.platformStorageConnections)
      .where(eq(schema.platformStorageConnections.id, id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "storage_connection.delete",
      "platform_storage_connections",
      id,
      null,
      {
        name: existing[0].name,
        driver: existing[0].driver,
        purpose: existing[0].purpose,
      },
      meta,
    );
  });

  invalidateStorageConnectionCache();

  return { ok: true };
}
