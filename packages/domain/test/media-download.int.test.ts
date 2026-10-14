import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import {
  uploadMediaDirect,
  trashMedia,
} from "../src/media-services.ts";
import { getMediaForStorefrontDownload } from "../src/media/download.ts";

describe("Media Storefront Download Integration Tests (Plan S1, Real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let rtPlatform: Runtime;
  let ctx: TenantContext;
  let _foreignCtx: TenantContext;
  let tenantId: string;
  let foreignTenantId: string;
  let tempStorageDir: string;

  const SAMPLE_PDF_BYTES = Buffer.from("%PDF-1.4\n%test pdf content\n%%EOF");

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({
      service: "platform",
      databaseUrl: env.as("app_platform"),
      poolMax: 10,
    });

    rt = createRuntime({
      service: "web",
      databaseUrl: env.as("app_rw"),
      saasDatabaseUrl: env.as("app_saas"),
      poolMax: 10,
    });

    tempStorageDir = path.join(os.tmpdir(), `bsec-download-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.MEDIA_LOCAL_DIR = tempStorageDir;

    // Provision main store tenant
    const t1 = await provisionTenant(rtPlatform, {
      storeName: "Download Test Store",
      slug: `dl-test-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@dl-test.com`, name: "DL Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = t1.tenantId;

    ctx = {
      tenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: t1.ownerId },
      roles: ["store_owner"],
      permissions: [...STORE_PERMISSIONS],
      requestId: "test-dl-req",
    };

    // Provision foreign tenant
    const t2 = await provisionTenant(rtPlatform, {
      storeName: "Foreign Download Store",
      slug: `dl-foreign-${Date.now()}`,
      owner: { email: `foreign-${Date.now()}@dl-test.com`, name: "Foreign Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    foreignTenantId = t2.tenantId;

    _foreignCtx = {
      tenantId: foreignTenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: t2.ownerId },
      roles: ["store_owner"],
      permissions: [...STORE_PERMISSIONS],
      requestId: "test-dl-foreign-req",
    };
  });

  afterAll(async () => {
    if (tempStorageDir && fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  it("resolves a ready document with local driver, safe filename, and disposition headers", async () => {
    const uploaded = await uploadMediaDirect(
      rt,
      ctx,
      {
        filename: 'quarterly "financial" report (Q3).pdf',
        mime: "application/pdf",
        folder: "documents",
        fileBytes: SAMPLE_PDF_BYTES,
      },
    );

    const download = await getMediaForStorefrontDownload(rt._db.db, tenantId, uploaded.id);
    expect(download).not.toBeNull();
    expect(download?.mediaId).toBe(uploaded.id);
    expect(download?.driverType).toBe("local");
    expect(download?.mime).toBe("application/pdf");
    expect(download?.bytes).toBe(SAMPLE_PDF_BYTES.length);
    expect(download?.safeFilename).toBe("quarterly financial report (Q3).pdf");
    expect(download?.dispositionHeader).toContain('attachment; filename="quarterly financial report (Q3).pdf"');
    expect(download?.localFilePath).toBeDefined();
    expect(fs.existsSync(download?.localFilePath ?? "")).toBe(true);
  });

  it("allows downloading trashed items while they still exist on disk (before purge)", async () => {
    const uploaded = await uploadMediaDirect(
      rt,
      ctx,
      {
        filename: "catalog-spec.pdf",
        mime: "application/pdf",
        folder: "documents",
        fileBytes: SAMPLE_PDF_BYTES,
      },
    );

    await trashMedia(rt, ctx, { ids: [uploaded.id] });

    // Trashed item is still resolvable for download before purge
    const download = await getMediaForStorefrontDownload(rt._db.db, tenantId, uploaded.id);
    expect(download).not.toBeNull();
    expect(download?.mediaId).toBe(uploaded.id);
  });

  it("strictly enforces tenant isolation: foreign tenant cannot download another store's media", async () => {
    const uploaded = await uploadMediaDirect(
      rt,
      ctx,
      {
        filename: "secret-doc.pdf",
        mime: "application/pdf",
        folder: "documents",
        fileBytes: SAMPLE_PDF_BYTES,
      },
    );

    // Querying with foreignTenantId must return null (404)
    const download = await getMediaForStorefrontDownload(rt._db.db, foreignTenantId, uploaded.id);
    expect(download).toBeNull();
  });

  it("blocks downloading media in private folders (returns, expense-receipts)", async () => {
    // Insert a media row in the private "returns" folder directly via DB under tenant
    const [privateItem] = await withTenant(rt._db.db, tenantId, async (tx) => {
      return await tx
        .insert(schema.media)
        .values({
          tenantId,
          storageKey: `${tenantId}/returns/return-photo.jpg`,
          mime: "image/jpeg",
          bytes: 1234,
          folder: "returns",
          status: "ready",
          filename: "return-photo.jpg",
        })
        .returning();
    });

    if (!privateItem) {
      throw new Error("Failed to insert private media row");
    }

    const download = await getMediaForStorefrontDownload(rt._db.db, tenantId, privateItem.id);
    expect(download).toBeNull();
  });

  it("returns null for non-existent, purged, or invalid IDs", async () => {
    expect(await getMediaForStorefrontDownload(rt._db.db, tenantId, "not-a-uuid")).toBeNull();
    expect(await getMediaForStorefrontDownload(rt._db.db, tenantId, crypto.randomUUID())).toBeNull();
  });
});
