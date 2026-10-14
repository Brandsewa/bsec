import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
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
  replaceMedia,
} from "../src/media-services.ts";
import {
  processMediaDerive,
  backfillMediaDerivatives,
} from "../src/media/derivatives.ts";

describe("Media Derivatives Worker & Backfill Integration Tests (Plan S2, Real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let rtPlatform: Runtime;
  let ctx: TenantContext;
  let foreignCtx: TenantContext;
  let tenantId: string;
  let foreignTenantId: string;
  let tempStorageDir: string;

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

    tempStorageDir = path.join(os.tmpdir(), `bsec-derivatives-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.MEDIA_LOCAL_DIR = tempStorageDir;

    // Provision main store tenant
    const t1 = await provisionTenant(rtPlatform, {
      storeName: "Derivatives Test Store",
      slug: `derive-test-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@derive-test.com`, name: "Derive Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = t1.tenantId;

    // Provision foreign tenant
    const t2 = await provisionTenant(rtPlatform, {
      storeName: "Foreign Test Store",
      slug: `foreign-derive-${Date.now()}`,
      owner: { email: `foreign-${Date.now()}@derive-test.com`, name: "Foreign Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    foreignTenantId = t2.tenantId;

    ctx = {
      tenantId,
      storeStatus: "live",
      roles: ["owner"],
      permissions: [...STORE_PERMISSIONS],
      actor: { type: "staff", userId: t1.ownerId },
      requestId: "test-derive-req",
    };

    foreignCtx = {
      tenantId: foreignTenantId,
      storeStatus: "live",
      roles: ["owner"],
      permissions: [...STORE_PERMISSIONS],
      actor: { type: "staff", userId: t2.ownerId },
      requestId: "test-derive-foreign-req",
    };
  });

  afterAll(async () => {
    try {
      if (tempStorageDir && fs.existsSync(tempStorageDir)) {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      }
    } catch {
      // Best effort cleanup
    }
  });

  it("generates WebP derivatives <= original width and extracts dominant color", async () => {
    // Generate 1200x800 solid blue image
    const imageBuffer = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 10, g: 80, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const upload = await uploadMediaDirect(rt, ctx, {
      filename: "test-product.jpg",
      mime: "image/jpeg",
      folder: "products",
      fileBytes: imageBuffer,
    });

    expect(upload.id).toBeDefined();

    // Run processMediaDerive
    const result = await processMediaDerive(rt._db.db, {
      tenantId,
      mediaId: upload.id,
    });

    // 1200px image produces 320, 640, 1024 (1600 is omitted because 1600 > 1200)
    expect(result.derived).toBe(3);
    expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.derivatives.length).toBe(3);

    // Verify DB columns
    const [row] = await withTenant(rt._db.db, tenantId, (tx) =>
      tx
        .select({
          derivatives: schema.media.derivatives,
          dominantColor: schema.media.dominantColor,
          width: schema.media.width,
          height: schema.media.height,
        })
        .from(schema.media)
        .where(eq(schema.media.id, upload.id)),
    );

    expect(row).toBeDefined();
    expect(row?.dominantColor).toBe(result.dominantColor);
    expect(row?.width).toBe(1200);
    expect(row?.height).toBe(800);

    const derivatives = row?.derivatives as Record<string, { key: string; width: number; height: number; bytes: number }>;
    const w320 = derivatives["w320"];
    expect(w320).toBeDefined();
    expect(derivatives["w640"]).toBeDefined();
    expect(derivatives["w1024"]).toBeDefined();
    expect(derivatives["w1600"]).toBeUndefined();

    // Verify file on disk is valid WebP
    const w320Key = w320 ? w320.key : "";
    const w320Path = path.join(tempStorageDir, ...w320Key.split("/"));
    expect(fs.existsSync(w320Path)).toBe(true);

    const w320Meta = await sharp(w320Path).metadata();
    expect(w320Meta.format).toBe("webp");
    expect(w320Meta.width).toBe(320);
    expect(w320Meta.height).toBe(Math.round((800 * 320) / 1200));

    // Verify idempotency
    const rerun = await processMediaDerive(rt._db.db, {
      tenantId,
      mediaId: upload.id,
    });
    expect(rerun.derived).toBe(3);
  });

  it("skips non-static images (GIF, PDF) gracefully", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.4\n%dummy pdf\n%%EOF");
    const upload = await uploadMediaDirect(rt, ctx, {
      filename: "manual.pdf",
      mime: "application/pdf",
      fileBytes: pdfBuffer,
    });

    const result = await processMediaDerive(rt._db.db, {
      tenantId,
      mediaId: upload.id,
    });

    expect(result.derived).toBe(0);
    expect(result.dominantColor).toBeNull();
    expect(result.derivatives.length).toBe(0);
  });

  it("enforces tenant boundary on derive", async () => {
    // Generate small image in foreign tenant
    const img = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 50, g: 50, b: 50 } },
    })
      .png()
      .toBuffer();

    const upload = await uploadMediaDirect(rt, foreignCtx, {
      filename: "foreign.png",
      mime: "image/png",
      fileBytes: img,
    });

    // Main tenant tries to derive foreign tenant's mediaId
    const result = await processMediaDerive(rt._db.db, {
      tenantId,
      mediaId: upload.id,
    });

    expect(result.derived).toBe(0);

    // Foreign record remains untouched
    const [row] = await withTenant(rt._db.db, foreignTenantId, (tx) =>
      tx
        .select({ derivatives: schema.media.derivatives })
        .from(schema.media)
        .where(eq(schema.media.id, upload.id)),
    );
    expect(row?.derivatives).toBeNull();
  });

  it("backfillMediaDerivatives finds images needing derivatives and dispatches derive jobs", async () => {
    // Create an image and clear its derivatives in DB to simulate pre-migration image
    const img = await sharp({
      create: { width: 500, height: 500, channels: 3, background: { r: 100, g: 20, b: 80 } },
    })
      .jpeg()
      .toBuffer();

    const upload = await uploadMediaDirect(rt, ctx, {
      filename: "legacy.jpg",
      mime: "image/jpeg",
      fileBytes: img,
    });

    // Explicitly reset derivatives to null
    await withTenant(rt._db.db, tenantId, (tx) =>
      tx
        .update(schema.media)
        .set({ derivatives: null, dominantColor: null })
        .where(eq(schema.media.id, upload.id)),
    );

    const backfill = await backfillMediaDerivatives(rt._db.db, {
      tenantId,
      batchSize: 10,
    });

    expect(backfill.processed).toBeGreaterThanOrEqual(1);

    const [updatedRow] = await withTenant(rt._db.db, tenantId, (tx) =>
      tx
        .select({
          derivatives: schema.media.derivatives,
          dominantColor: schema.media.dominantColor,
        })
        .from(schema.media)
        .where(eq(schema.media.id, upload.id)),
    );

    expect(updatedRow?.derivatives).toBeDefined();
    expect(updatedRow?.dominantColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
