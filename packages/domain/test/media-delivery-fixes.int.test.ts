import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import {
  collectDerivativeKeys,
  createMediaRecord,
  deleteMediaPermanent,
  purgeMediaObjects,
  replaceMedia,
  replaceMediaDirect,
  trashMedia,
  uploadMediaDirect,
} from "../src/media-services.ts";
import { backfillMediaDerivatives, processMediaDerive } from "../src/media/derivatives.ts";
import { backfillMediaHashes, processMediaHash } from "../src/media/hashing.ts";
import { getActiveStorageDriver } from "../src/media/connection.ts";

/**
 * Phase 4 review fixes (Claude): derivative purge, replace without key reuse, EXIF orientation,
 * backfill termination and hash trust. Real Postgres, local storage, worker handlers run as app_rw.
 */
describe("Media delivery: Phase 4 review fixes (real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let rtPlatform: Runtime;
  let rtJobs: Runtime;
  const sentJobs: Array<{ queue: string; data: unknown }> = [];
  let ctx: TenantContext;
  let tenantId: string;
  let tempStorageDir: string;

  const solid = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

  const rowOf = async (id: string) =>
    withTenant(rt._db.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(schema.media).where(eq(schema.media.id, id)).limit(1);
      return row;
    });

  const exists = async (key: string) => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    return (await driver.head(key)).exists;
  };

  const insertRow = async (values: {
    storageKey: string;
    mime: string;
    bytes: number;
    kind: "image" | "video" | "document";
    folder: string;
    filename: string;
  }) => {
    // Like a real upload, record the storage connection the file was written to. Without it a row falls back to the
    // environment storage, which differs from the active connection when an earlier test file left one active
    // (CI runs every file against one shared database).
    const { config } = await getActiveStorageDriver(rt._db.db, "public_media");
    return withTenant(rt._db.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.media)
        .values({ tenantId, status: "ready", storageConnectionId: config.id ?? null, ...values })
        .returning({ id: schema.media.id });
      if (!row) throw new Error("insert failed");
      return row.id;
    });
  };

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), saasDatabaseUrl: env.as("app_saas"), poolMax: 10 });
    // Same as production web: jobs are enqueued, and a worker (below) later runs the purge
    rtJobs = createRuntime({
      service: "web",
      databaseUrl: env.as("app_rw"),
      saasDatabaseUrl: env.as("app_saas"),
      poolMax: 4,
      jobs: {
        isRunning: () => true,
        stop: async () => undefined,
        send: async (queue: string, data: object) => {
          sentJobs.push({ queue, data });
          return "job-id";
        },
      },
    });

    tempStorageDir = path.join(os.tmpdir(), `bsec-delivery-fixes-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.MEDIA_LOCAL_DIR = tempStorageDir;

    const t = await provisionTenant(rtPlatform, {
      storeName: "Delivery Fixes Store",
      slug: `delivery-fixes-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@delivery-fixes.test`, name: "Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = t.tenantId;
    ctx = {
      tenantId,
      storeStatus: "live",
      roles: ["owner"],
      permissions: [...STORE_PERMISSIONS],
      actor: { type: "staff", userId: t.ownerId },
      requestId: "test-delivery-fixes",
    };
  });

  afterAll(async () => {
    try {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("collectDerivativeKeys reads both the stored map and a plain list", () => {
    expect(
      collectDerivativeKeys({ w320: { key: "t/_derived/a/b/w320.webp" }, w640: { key: "t/_derived/a/b/w640.webp" } }),
    ).toEqual(["t/_derived/a/b/w320.webp", "t/_derived/a/b/w640.webp"]);
    expect(collectDerivativeKeys([{ key: "k1" }, { key: "k2" }])).toEqual(["k1", "k2"]);
    expect(collectDerivativeKeys(null)).toEqual([]);
    expect(collectDerivativeKeys({ w320: { nokey: true } })).toEqual([]);
  });

  it("permanent delete removes the derived files too", async () => {
    const bytes = await solid(1400, 900).jpeg().toBuffer();
    const item = await uploadMediaDirect(rt, ctx, { filename: "to-delete.jpg", mime: "image/jpeg", folder: "products", fileBytes: bytes });
    await processMediaDerive(rt._db.db, { tenantId, mediaId: item.id });

    const before = await rowOf(item.id);
    const keys = collectDerivativeKeys(before?.derivatives);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(await exists(key)).toBe(true);

    await trashMedia(rt, ctx, { ids: [item.id] });
    sentJobs.length = 0;
    const res = await deleteMediaPermanent(rtJobs, ctx, { ids: [item.id] });
    expect(res.deleted).toBe(1);

    // Nothing is removed inside the request; the purge job carries the original and every derived file
    const purge = sentJobs.find((j) => j.queue === "media.purge");
    expect(purge).toBeDefined();
    expect(await exists(item.storageKey as string)).toBe(true);

    // The worker handler then deletes them all
    await purgeMediaObjects(rt._db.db, purge?.data as Parameters<typeof purgeMediaObjects>[1]);
    expect(await exists(item.storageKey as string)).toBe(false);
    for (const key of keys) expect(await exists(key)).toBe(false);
  });

  it("permanent delete from the web service (no job queue) removes the files right after the commit", async () => {
    const bytes = await solid(1300, 800).jpeg().toBuffer();
    const item = await uploadMediaDirect(rt, ctx, { filename: "web-delete.jpg", mime: "image/jpeg", folder: "products", fileBytes: bytes });
    await processMediaDerive(rt._db.db, { tenantId, mediaId: item.id });
    const keys = collectDerivativeKeys((await rowOf(item.id))?.derivatives);
    expect(keys.length).toBeGreaterThan(0);

    await trashMedia(rt, ctx, { ids: [item.id] });
    // `rt` has no jobs, exactly like apps/web: nothing could be enqueued, so the files must be removed directly
    const res = await deleteMediaPermanent(rt, ctx, { ids: [item.id] });
    expect(res.deleted).toBe(1);
    expect(await exists(item.storageKey as string)).toBe(false);
    for (const key of keys) expect(await exists(key)).toBe(false);
  });

  it("replace derives to new keys and removes the old derived files", async () => {
    const first = await solid(1400, 900).jpeg().toBuffer();
    const item = await uploadMediaDirect(rt, ctx, { filename: "swap.jpg", mime: "image/jpeg", folder: "products", fileBytes: first });
    await processMediaDerive(rt._db.db, { tenantId, mediaId: item.id });
    const oldKeys = collectDerivativeKeys((await rowOf(item.id))?.derivatives);
    expect(oldKeys.length).toBeGreaterThan(0);

    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const newKey = `${tenantId}/products/${crypto.randomUUID()}.jpg`;
    const second = await solid(1800, 1200).jpeg().toBuffer();
    await driver.put({ key: newKey, body: second, contentType: "image/jpeg" });

    await replaceMedia(rt, ctx, { id: item.id, storageKey: newKey, mime: "image/jpeg", bytes: second.length, filename: "swap.jpg" });
    // No jobs runtime in tests: the old files are purged inline and the replaced row waits for its derive job
    expect((await rowOf(item.id))?.derivatives).toBeNull();
    for (const key of oldKeys) expect(await exists(key)).toBe(false);

    await processMediaDerive(rt._db.db, { tenantId, mediaId: item.id });
    const newKeys = collectDerivativeKeys((await rowOf(item.id))?.derivatives);
    expect(newKeys.length).toBeGreaterThan(0);
    for (const key of newKeys) {
      expect(oldKeys).not.toContain(key);
      expect(await exists(key)).toBe(true);
    }
  });

  it("replace through the server swaps the bytes, keeps the id and refuses another kind", async () => {
    const first = await solid(900, 600).png().toBuffer();
    const item = await uploadMediaDirect(rt, ctx, { filename: "proxy-swap.png", mime: "image/png", folder: "products", fileBytes: first });
    const oldKey = item.storageKey as string;

    const second = await solid(500, 300).png().toBuffer();
    const replaced = await replaceMediaDirect(rt, ctx, { id: item.id, fileBytes: second, filename: "proxy-swap-2.png", mime: "image/png" });
    expect(replaced.id).toBe(item.id);
    expect(replaced.width).toBe(500);
    expect(replaced.height).toBe(300);
    expect(replaced.storageKey).not.toBe(oldKey);
    expect(await exists(replaced.storageKey as string)).toBe(true);
    expect(await exists(oldKey)).toBe(false);

    // A PDF cannot replace an image, and nothing is left behind
    const pdf = Buffer.from("%PDF-1.4 not an image");
    await expect(
      replaceMediaDirect(rt, ctx, { id: item.id, fileBytes: pdf, filename: "doc.pdf", mime: "application/pdf" }),
    ).rejects.toThrow(/same type/i);
    expect((await rowOf(item.id))?.storageKey).toBe(replaced.storageKey);

    // SVG stays refused, and an unknown id is not found
    await expect(
      replaceMediaDirect(rt, ctx, { id: item.id, fileBytes: Buffer.from("<svg/>"), filename: "x.svg", mime: "image/svg+xml" }),
    ).rejects.toThrow(/SVG/);
    await expect(
      replaceMediaDirect(rt, ctx, { id: crypto.randomUUID(), fileBytes: second, filename: "n.png", mime: "image/png" }),
    ).rejects.toThrow(/Not Found/);
  });

  it("derives upright images and stores oriented dimensions for phone photos (EXIF 6)", async () => {
    // 600 wide x 400 high on disk, turned 90 degrees by EXIF: it displays 400 wide x 600 high
    const exifPortrait = await solid(600, 400).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const item = await uploadMediaDirect(rt, ctx, { filename: "phone.jpg", mime: "image/jpeg", folder: "products", fileBytes: exifPortrait });
    expect(item.width).toBe(400);
    expect(item.height).toBe(600);

    await processMediaDerive(rt._db.db, { tenantId, mediaId: item.id });
    const row = await rowOf(item.id);
    expect(row?.width).toBe(400);
    expect(row?.height).toBe(600);

    const keys = collectDerivativeKeys(row?.derivatives);
    expect(keys.length).toBeGreaterThan(0);
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const derived = await driver.get(keys[0] as string);
    const meta = await sharp(derived as Buffer).metadata();
    expect(meta.width as number).toBeLessThan(meta.height as number);
  });

  it("backfill terminates on unreadable images and never re-selects them", async () => {
    // Rows whose image bytes cannot be decoded (a truncated PNG), more than one batch of them
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const broken = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const key = `${tenantId}/products/${crypto.randomUUID()}.png`;
      await driver.put({ key, body: broken, contentType: "image/png" });
      ids.push(
        await insertRow({ storageKey: key, mime: "image/png", bytes: broken.length, kind: "image", folder: "products", filename: `broken-${i}.png` }),
      );
    }

    const sent: Array<{ queue: string; data: object }> = [];
    const jobs = { send: async (queue: string, data: object) => void sent.push({ queue, data }) };

    // First pass handles one batch of 2 and asks for more
    const first = await backfillMediaDerivatives(rt._db.db, { tenantId, batchSize: 2, jobs });
    expect(first.hasMore).toBe(true);
    expect(sent.some((s) => s.queue === "media.backfill_derivatives")).toBe(true);

    // The unreadable rows are marked "no derivatives", so repeated passes run out of work
    let guard = 0;
    let last = first;
    while (last.hasMore && guard++ < 10) last = await backfillMediaDerivatives(rt._db.db, { tenantId, batchSize: 2, jobs });
    expect(last.hasMore).toBe(false);

    for (const id of ids) expect((await rowOf(id))?.derivatives).toEqual({});
    const again = await backfillMediaDerivatives(rt._db.db, { tenantId, batchSize: 2, jobs });
    expect(again.processed).toBe(0);
  });

  it("hash backfill pages by cursor: unreadable rows cannot starve the readable ones", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

    // Two rows whose files are missing (lowest ids), then one readable document
    const missingIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      missingIds.push(
        await insertRow({
          storageKey: `${tenantId}/documents/${crypto.randomUUID()}.pdf`,
          mime: "application/pdf",
          bytes: 10,
          kind: "document",
          folder: "documents",
          filename: `missing-${i}.pdf`,
        }),
      );
    }
    const pdf = Buffer.from("%PDF-1.4 readable document body");
    const pdfKey = `${tenantId}/documents/${crypto.randomUUID()}.pdf`;
    await driver.put({ key: pdfKey, body: pdf, contentType: "application/pdf" });
    const readableId = await insertRow({
      storageKey: pdfKey,
      mime: "application/pdf",
      bytes: pdf.length,
      kind: "document",
      folder: "documents",
      filename: "readable.pdf",
    });

    const sent: Array<{ queue: string; data: Record<string, unknown> }> = [];
    const jobs = { send: async (queue: string, data: object) => void sent.push({ queue, data: data as Record<string, unknown> }) };

    // Pages of 2: follow the continuation chain like the worker does. Unreadable rows are skipped by the cursor,
    // so the chain reaches the readable document and then ends.
    let afterId: string | undefined;
    let pages = 0;
    do {
      sent.length = 0;
      await backfillMediaHashes(rt._db.db, 2, tenantId, { afterId, jobs });
      const next = sent.find((job) => job.queue === "media.backfill_hashes");
      afterId = next ? (next.data.afterId as string) : undefined;
      pages++;
    } while (afterId && pages < 50);
    expect(afterId).toBeUndefined();
    expect(pages).toBeGreaterThan(1);

    const readable = await rowOf(readableId);
    expect(readable?.sha256).toBe(crypto.createHash("sha256").update(pdf).digest("hex"));
    for (const id of missingIds) expect((await rowOf(id))?.sha256).toBeNull();
  });

  it("a browser-supplied hash is never stored; the worker computes the real one", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const pdf = Buffer.from("%PDF-1.4 client hash must not be trusted");
    const key = `${tenantId}/documents/${crypto.randomUUID()}.pdf`;
    await driver.put({ key, body: pdf, contentType: "application/pdf" });

    const fake = "a".repeat(64);
    const created = await createMediaRecord(rt, ctx, {
      storageKey: key,
      mime: "application/pdf",
      bytes: pdf.length,
      filename: "client-hash.pdf",
      sha256: fake,
    });
    expect((await rowOf(created.id))?.sha256).not.toBe(fake);

    await processMediaHash(rt._db.db, { tenantId, mediaId: created.id });
    expect((await rowOf(created.id))?.sha256).toBe(crypto.createHash("sha256").update(pdf).digest("hex"));

    // The planted value never made it into the duplicate lookup
    const planted = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(and(eq(schema.media.tenantId, tenantId), eq(schema.media.sha256, fake))),
    );
    expect(planted).toHaveLength(0);
  });
});
