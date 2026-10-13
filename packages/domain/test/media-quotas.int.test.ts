import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  assertMediaUploadQuota,
  getTenantMediaUsageStats,
  QuotaExceededError,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtPlatform: Runtime;
let tenantId: string;
let ownerId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

  const tenant = await provisionTenant(rtPlatform, {
    storeName: "Media Quota Test Store",
    slug: "media-quota-test-store",
    owner: { email: "owner@media-quota.test", name: "Media Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = tenant.tenantId;
  ownerId = tenant.ownerId;
});

afterAll(async () => {
  await env?.stop();
});

describe("assertMediaUploadQuota and per-kind quota enforcement (MEDIA-LIBRARY-PLAN §6)", () => {
  it("enforces default per-kind file size limits: 5 MB image, 10 MB video, 5 MB document", async () => {
    // 1. Image: 4 MB allowed, 6 MB rejected
    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "image",
        bytes: 4 * 1024 * 1024,
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "image",
        bytes: 6 * 1024 * 1024,
      }),
    ).rejects.toThrowError(QuotaExceededError);

    try {
      await assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "image",
        bytes: 6 * 1024 * 1024,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quotaKey).toBe("media_image_mb");
      expect(qe.limit).toBe(5);
      expect(qe.message).toContain("Images can be up to 5 MB");
    }

    // 2. Video: 9 MB allowed, 11 MB rejected
    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "video",
        bytes: 9 * 1024 * 1024,
      }),
    ).resolves.toBeUndefined();

    try {
      await assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "video",
        bytes: 11 * 1024 * 1024,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quotaKey).toBe("media_video_mb");
      expect(qe.limit).toBe(10);
      expect(qe.message).toContain("Videos can be up to 10 MB");
    }

    // 3. Document: 4 MB allowed, 6 MB rejected
    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "document",
        bytes: 4 * 1024 * 1024,
      }),
    ).resolves.toBeUndefined();

    try {
      await assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "document",
        bytes: 6 * 1024 * 1024,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quotaKey).toBe("media_document_mb");
      expect(qe.limit).toBe(5);
      expect(qe.message).toContain("Documents can be up to 5 MB");
    }
  });

  it("permits 11 MB video when tier limit is updated to 20 MB", async () => {
    // Find the store's tier
    const tierRes = await rt._db.db.execute<{ tier: string }>(sql`
      SELECT tier FROM tenant_size_tiers WHERE tenant_id = ${tenantId} LIMIT 1;
    `);
    const tier = tierRes.rows[0]?.tier || "XS";

    // Super Admin updates quota_tier_limits for media_video_mb to 20
    await rtPlatform._db.db.execute(sql`
      INSERT INTO quota_tier_limits (tier_code, quota_key, value, updated_at)
      VALUES (${tier}, 'media_video_mb', 20, now())
      ON CONFLICT (tier_code, quota_key) DO UPDATE SET value = 20, updated_at = now();
    `);

    // 11 MB video should now be allowed!
    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "video",
        bytes: 11 * 1024 * 1024,
      }),
    ).resolves.toBeUndefined();

    // 21 MB video is rejected
    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "video",
        bytes: 21 * 1024 * 1024,
      }),
    ).rejects.toThrowError(QuotaExceededError);
  });

  it("per-store override in tenant_quota_overrides wins over tier limit", async () => {
    // Add override: media_image_mb = 8 for this tenant
    await rtPlatform._db.db.execute(sql`
      INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value, created_at, updated_at)
      VALUES (${tenantId}, 'media_image_mb', 8, now(), now())
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 8, updated_at = now();
    `);

    // 7 MB image is now allowed
    await expect(
      assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "image",
        bytes: 7 * 1024 * 1024,
      }),
    ).resolves.toBeUndefined();

    // 9 MB image is rejected (exceeds override of 8)
    try {
      await assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "image",
        bytes: 9 * 1024 * 1024,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quotaKey).toBe("media_image_mb");
      expect(qe.limit).toBe(8);
    }
  });

  it("enforces storage_mb limit and includes Trash bytes in storage usage", async () => {
    // Override storage_mb to 10 MB for this tenant
    await rtPlatform._db.db.execute(sql`
      INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value, created_at, updated_at)
      VALUES (${tenantId}, 'storage_mb', 10, now(), now())
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 10, updated_at = now();
    `);

    // Insert an active media row taking 6 MB and a trashed row taking 3 MB
    await withTenant(rt._db.db, tenantId, async (tx) => {
      await tx.insert(schema.media).values({
        tenantId,
        storageKey: `${tenantId}/products/img1.jpg`,
        mime: "image/jpeg",
        bytes: 6 * 1024 * 1024,
        kind: "image",
        status: "ready",
        filename: "img1.jpg",
      });

      await tx.insert(schema.media).values({
        tenantId,
        storageKey: `${tenantId}/products/img2.jpg`,
        mime: "image/jpeg",
        bytes: 3 * 1024 * 1024,
        kind: "image",
        status: "trashed",
        trashedAt: new Date(),
        filename: "img2.jpg",
      });
    });

    // Total storage is 6 MB + 3 MB = 9 MB.
    // Uploading a 2 MB file (9 + 2 = 11 MB > 10 MB limit) MUST be refused!
    try {
      await assertMediaUploadQuota(rt._db.db, tenantId, {
        kind: "image",
        bytes: 2 * 1024 * 1024,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.quotaKey).toBe("storage_mb");
      expect(qe.message).toContain("Your store has used");
    }

    // Check that getTenantMediaUsageStats correctly counts both active and trashed bytes
    const stats = await getTenantMediaUsageStats(rt._db.db, tenantId);
    expect(stats.usedBytes).toBe(9 * 1024 * 1024);
    expect(stats.trashedBytes).toBe(3 * 1024 * 1024);
    expect(stats.fileCount).toBe(2);
    expect(stats.limitBytes).toBe(10 * 1024 * 1024);
  });
});
