import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  commitProductImportBatch,
  createRuntime,
  getProduct,
  getProductImportRun,
  listProducts,
  parseProductRows,
  processImportImageTask,
  provisionTenant,
  startProductImportRun,
  ImageFetchError,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { activatePlatformStorageConnection, createPlatformStorageConnection } from "../src/platform/storage-connections.ts";
import { invalidateStorageConnectionCache } from "../src/media/connection.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe("product import images (real Postgres, fake downloader)", () => {
  let env: TestDb;
  let rt: Runtime;
  let ctx: TenantContext;
  let dir: string;

  beforeAll(async () => {
    env = await startTestDb();
    const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
    dir = path.join(os.tmpdir(), `bsec-import-images-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = dir;
    const t = await provisionTenant(rtPlatform, { storeName: "Import Images", slug: `import-images-${Date.now()}`, owner: { email: `o-${Date.now()}@imgimport.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
    const staff = await seedPlatformStaff(rtPlatform._db.db, { email: `imgimport-${Date.now()}@platform.test`, role: "platform_admin" });
    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, { name: "Import images local", driver: "local", purpose: "public_media", localDir: dir });
    await activatePlatformStorageConnection(rtPlatform, staff.userId, conn.id);
    invalidateStorageConnectionCache();
    ctx = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-import-images" };
  }, 180_000);

  afterAll(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.STORAGE_LOCAL_DIR;
    invalidateStorageConnectionCache();
    await env?.stop();
  });

  it("downloads, attaches, dedupes by content, reports failures and closes the run", async () => {
    const map = ["handle", "title", "sku", "price", "imageUrl", "additionalImages", "variantImageUrl"];
    const { products } = parseProductRows(
      [["img-tee", "Img Tee", "IMG-1", "10", "https://cdn.example.com/a.png", "https://cdn.example.com/b.png|https://cdn.example.com/missing.png", "https://cdn.example.com/b.png"]],
      map,
      "INR",
    );
    const started = await startProductImportRun(rt, ctx, { total: 1, conflictPolicy: "update", mode: "create_and_update" });
    const { run, imageTasks } = await commitProductImportBatch(rt, ctx, { runId: started.id, products });
    expect(run.imagesTotal).toBe(3);
    expect(run.errors.some((e) => e.kind === "image")).toBe(true); // no queue in this test: reported, not dropped
    const task = imageTasks[0]!;

    // The same bytes behind two URLs must become one media file.
    const fakeFetch = async (url: string) => {
      if (url.includes("missing")) throw new ImageFetchError("the server answered 404");
      return { bytes: PNG, mime: "image/png" as const, filename: "x.png", finalUrl: url };
    };
    // Reset the "no queue" failures so this run is judged on the real processing only.
    await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.update(schema.productImportRuns).set({ imagesFailed: 0, errors: [] }));
    const res = await processImportImageTask(rt._db.db, { tenantId: ctx.tenantId, runId: started.id, actorId: null, task }, { fetch: fakeFetch });
    expect(res).toEqual({ ok: 2, failed: 1 });

    const list = await listProducts(rt, ctx, { limit: 50 });
    const product = await getProduct(rt, ctx, { id: list.items.find((p) => p.slug === "img-tee")!.id });
    expect(product.media).toHaveLength(1); // two URLs, identical content, one gallery entry
    expect(product.variants[0]?.imageMediaId).toBe(product.media[0]?.mediaId);

    const done = await getProductImportRun(rt, ctx, { id: started.id });
    expect(done).toMatchObject({ imagesDone: 2, imagesFailed: 1, status: "completed_with_errors" });
    expect(done.errors.filter((e) => e.kind === "image")).toHaveLength(1);
    expect(done.errors[0]?.message).toMatch(/missing\.png.*404/);
  });
});
