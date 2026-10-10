import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { eq } from "drizzle-orm";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import {
  listPlatformStorageConnections,
  getPlatformStorageConnection,
  createPlatformStorageConnection,
  activatePlatformStorageConnection,
  deletePlatformStorageConnection,
} from "../src/platform/storage-connections.ts";
import {
  resolveDriverForMediaRow,
  resolveLocalMediaFilePath,
  getActiveStorageDriver,
  uploadMediaDirect,
  invalidateStorageConnectionCache,
} from "../src/media/connection.ts";
import { deleteMediaRecord } from "../src/media-services.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let adminUserId: string;
let ctx: TenantContext;
const testDirs: string[] = [];

function makeTempDir(label: string): string {
  const dir = path.join(os.tmpdir(), `bsec-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  testDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 4 });

  const runId = Math.random().toString(36).slice(2, 7);
  const staff = await seedPlatformStaff(rt._db.db, {
    email: `storage-admin-${runId}@platform.test`,
    role: "platform_admin",
  });
  adminUserId = staff.userId;

  const tenant = await provisionTenant(rt, {
    storeName: "Storage Test Store",
    slug: `store-${runId}`,
    owner: { email: `owner-${runId}@store.test`, name: "Store Owner" },
    planCode: "starter",
    source: "platform_admin",
  });

  ctx = {
    tenantId: tenant.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tenant.ownerId },
    roles: ["store_owner"],
    permissions: ["content.read", "content.write", "products.read", "products.write"],
    requestId: `req-${runId}`,
  };
}, 180_000);

afterAll(async () => {
  for (const dir of testDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  try {
    await rt._db.db.delete(schema.platformStorageConnections);
    invalidateStorageConnectionCache();
  } catch {
    // ignore
  }
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Platform Storage Connections (Real Database Integration)", () => {
  it("secrets are stored encrypted and never returned by list or get procedures", async () => {
    const rawKeyId = "AKIA12345678TESTKEY9";
    const rawSecret = "super-secret-aws-key-xyz-987654321";

    const created = await createPlatformStorageConnection(rt, adminUserId, {
      name: "S3 Primary Backup",
      driver: "s3",
      purpose: "private_files",
      bucket: "secure-backup-bucket",
      region: "ap-south-1",
      accessKeyId: rawKeyId,
      secretAccessKey: rawSecret,
    });

    // 1. Direct database check: secrets MUST NOT be stored in plaintext
    const [dbRow] = await rt._db.db
      .select()
      .from(schema.platformStorageConnections)
      .where(eq(schema.platformStorageConnections.id, created.id))
      .limit(1);

    expect(dbRow).toBeDefined();
    expect(dbRow!.accessKeyIdCiphertext).toBeDefined();
    expect(dbRow!.accessKeyIdCiphertext).not.toBe(rawKeyId);
    expect(dbRow!.secretAccessKeyCiphertext).toBeDefined();
    expect(dbRow!.secretAccessKeyCiphertext).not.toBe(rawSecret);
    expect(dbRow!.iv).toBeDefined();

    // 2. listPlatformStorageConnections procedure: secrets absent, masked access key returned
    const list = await listPlatformStorageConnections(rt, adminUserId);
    const item = list.find((c) => c.id === created.id);
    expect(item).toBeDefined();
    expect((item as Record<string, unknown>).accessKeyIdCiphertext).toBeUndefined();
    expect((item as Record<string, unknown>).secretAccessKeyCiphertext).toBeUndefined();
    expect((item as Record<string, unknown>).accessKeyId).toBeUndefined();
    expect((item as Record<string, unknown>).secretAccessKey).toBeUndefined();
    expect(item!.hasAccessKey).toBe(true);
    expect(item!.accessKeyIdLast4).toBe("KEY9");
    expect(item!.hasSecretAccessKey).toBe(true);

    // 3. getPlatformStorageConnection procedure: secrets absent
    const detail = await getPlatformStorageConnection(rt, adminUserId, created.id);
    expect((detail as Record<string, unknown>).accessKeyIdCiphertext).toBeUndefined();
    expect((detail as Record<string, unknown>).secretAccessKeyCiphertext).toBeUndefined();
    expect((detail as Record<string, unknown>).accessKeyId).toBeUndefined();
    expect((detail as Record<string, unknown>).secretAccessKey).toBeUndefined();
    expect(detail.hasAccessKey).toBe(true);
    expect(detail.accessKeyIdLast4).toBe("KEY9");
    expect(detail.hasSecretAccessKey).toBe(true);
  });

  it("enforces exactly one active connection per purpose via partial unique index", async () => {
    const dirA = makeTempDir("active-a");
    const dirB = makeTempDir("active-b");

    const connA = await createPlatformStorageConnection(rt, adminUserId, {
      name: "Local Active A",
      driver: "local",
      purpose: "public_media",
      localDir: dirA,
    });
    await activatePlatformStorageConnection(rt, adminUserId, connA.id);

    const connB = await createPlatformStorageConnection(rt, adminUserId, {
      name: "Local Inactive B",
      driver: "local",
      purpose: "public_media",
      localDir: dirB,
    });

    const initA = await getPlatformStorageConnection(rt, adminUserId, connA.id);
    const initB = await getPlatformStorageConnection(rt, adminUserId, connB.id);
    expect(initA.isActive).toBe(true);
    expect(initB.isActive).toBe(false);

    // Activating B automatically deactivates A
    await activatePlatformStorageConnection(rt, adminUserId, connB.id);
    invalidateStorageConnectionCache();

    const detailA = await getPlatformStorageConnection(rt, adminUserId, connA.id);
    const detailB = await getPlatformStorageConnection(rt, adminUserId, connB.id);
    expect(detailA.isActive).toBe(false);
    expect(detailB.isActive).toBe(true);

    // Attempting direct SQL update to have two active public_media connections MUST fail on unique constraint
    let conflictErr: Error | null = null;
    try {
      await rt._db.db
        .update(schema.platformStorageConnections)
        .set({ isActive: true })
        .where(eq(schema.platformStorageConnections.id, connA.id));
    } catch (err: unknown) {
      conflictErr = err as Error;
    }
    expect(conflictErr).not.toBeNull();
    const conflictMsg = `${conflictErr?.message} ${(conflictErr as unknown as { cause?: Error })?.cause?.message || ""}`;
    expect(conflictMsg).toMatch(/platform_storage_connections_active_purpose_idx/i);
  });

  it("media row continues to resolve through original connection after another is activated", async () => {
    const dir1 = makeTempDir("resolve-dir1");
    const dir2 = makeTempDir("resolve-dir2");

    // 1. Activate Connection 1
    const conn1 = await createPlatformStorageConnection(rt, adminUserId, {
      name: "Cluster Local 1",
      driver: "local",
      purpose: "public_media",
      localDir: dir1,
    });
    await activatePlatformStorageConnection(rt, adminUserId, conn1.id);

    invalidateStorageConnectionCache();
    const active1 = await getActiveStorageDriver(rt._db.db, "public_media");
    expect(active1.config.id).toBe(conn1.id);

    // 2. Upload media under Connection 1
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const uploaded = await uploadMediaDirect(rt, ctx, {
      fileBytes: validPng,
      filename: "product-1.png",
      mime: "image/png",
      folder: "products",
    });

    expect(uploaded.id).toBeDefined();

    // Verify row points to conn1.id
    const [mediaRow] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return tx.select().from(schema.media).where(eq(schema.media.id, uploaded.id)).limit(1);
    });
    expect(mediaRow).toBeDefined();
    expect(mediaRow!.storageConnectionId).toBe(conn1.id);

    // 3. Create and activate Connection 2
    const conn2 = await createPlatformStorageConnection(rt, adminUserId, {
      name: "Cluster Local 2",
      driver: "local",
      purpose: "public_media",
      localDir: dir2,
    });
    await activatePlatformStorageConnection(rt, adminUserId, conn2.id);
    invalidateStorageConnectionCache();

    // Verify active is now Connection 2
    const active2 = await getActiveStorageDriver(rt._db.db, "public_media");
    expect(active2.config.id).toBe(conn2.id);

    // 4. Existing media row MUST still resolve driver from Connection 1!
    const resolvedDriver = await resolveDriverForMediaRow(rt._db.db, mediaRow!.storageConnectionId);
    expect(resolvedDriver).not.toBeNull();
    expect(resolvedDriver!.driverType).toBe("local");
    expect((resolvedDriver as unknown as { baseDir: string }).baseDir).toBe(path.resolve(dir1));

    // 5. Local file serve path MUST resolve through media row's connection 1 directory
    const filePath = await resolveLocalMediaFilePath(rt._db.db, mediaRow!.storageKey);
    expect(filePath).not.toBeNull();
    expect(filePath).toBe(path.resolve(dir1, mediaRow!.storageKey));
    expect(fs.existsSync(filePath!)).toBe(true);
  });

  it("refuses to delete a storage connection when referenced by existing media records", async () => {
    const dir = makeTempDir("delete-ref");
    const conn = await createPlatformStorageConnection(rt, adminUserId, {
      name: "Referenced Local Conn",
      driver: "local",
      purpose: "public_media",
      localDir: dir,
    });

    // Insert a media row referencing conn.id
    const storageKey = `${ctx.tenantId}/products/referenced.png`;
    const [insertedMedia] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return tx
        .insert(schema.media)
        .values({
          tenantId: ctx.tenantId,
          storageKey,
          storageConnectionId: conn.id,
          mime: "image/png",
          bytes: 1024,
          folder: "products",
        })
        .returning();
    });

    // Attempting delete MUST throw
    await expect(
      deletePlatformStorageConnection(rt, adminUserId, conn.id),
    ).rejects.toThrow(/referenced by 1 existing media record/i);

    // Delete the referencing media row
    await deleteMediaRecord(rt, ctx, { id: insertedMedia!.id });

    // Now delete MUST succeed
    const delResult = await deletePlatformStorageConnection(rt, adminUserId, conn.id);
    expect(delResult.ok).toBe(true);
  });

  it("app_rw role can SELECT platform_storage_connections but CANNOT insert, update, or delete", async () => {
    // 1. SELECT is allowed for app_rw
    const rows = await rtWeb._db.db
      .select({ id: schema.platformStorageConnections.id })
      .from(schema.platformStorageConnections)
      .limit(5);
    expect(Array.isArray(rows)).toBe(true);

    // 2. INSERT rejected for app_rw
    let insertErr: Error | null = null;
    try {
      await rtWeb._db.db
        .insert(schema.platformStorageConnections)
        .values({
          name: "Rogue Connection",
          driver: "local",
          purpose: "public_media",
        });
    } catch (err: unknown) {
      insertErr = err as Error;
    }
    expect(insertErr).not.toBeNull();
    const insertMsg = `${insertErr?.message} ${(insertErr as unknown as { cause?: Error })?.cause?.message || ""}`;
    expect(insertMsg).toMatch(/permission denied for table platform_storage_connections/i);

    // 3. UPDATE rejected for app_rw
    let updateErr: Error | null = null;
    try {
      await rtWeb._db.db
        .update(schema.platformStorageConnections)
        .set({ name: "Hacked Name" });
    } catch (err: unknown) {
      updateErr = err as Error;
    }
    expect(updateErr).not.toBeNull();
    const updateMsg = `${updateErr?.message} ${(updateErr as unknown as { cause?: Error })?.cause?.message || ""}`;
    expect(updateMsg).toMatch(/permission denied for table platform_storage_connections/i);

    // 4. DELETE rejected for app_rw
    let deleteErr: Error | null = null;
    try {
      await rtWeb._db.db
        .delete(schema.platformStorageConnections);
    } catch (err: unknown) {
      deleteErr = err as Error;
    }
    expect(deleteErr).not.toBeNull();
    const deleteMsg = `${deleteErr?.message} ${(deleteErr as unknown as { cause?: Error })?.cause?.message || ""}`;
    expect(deleteMsg).toMatch(/permission denied for table platform_storage_connections/i);
  });

  it("uploadMediaDirect rejects non-images and MIME mismatches before saving", async () => {
    // 1. Non-image (HTML content declared as image/png)
    const fakeHtml = Buffer.from("<!DOCTYPE html><html><body><h1>Hacked</h1></body></html>");
    await expect(
      uploadMediaDirect(rt, ctx, {
        fileBytes: fakeHtml,
        filename: "malicious.png",
        mime: "image/png",
      }),
    ).rejects.toThrow(/not a recognized image format/i);

    // 2. MIME mismatch (JPEG bytes declared as image/png)
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    await expect(
      uploadMediaDirect(rt, ctx, {
        fileBytes: jpegBytes,
        filename: "mismatched.png",
        mime: "image/png",
      }),
    ).rejects.toThrow(/does not match file contents/i);
  });
});
