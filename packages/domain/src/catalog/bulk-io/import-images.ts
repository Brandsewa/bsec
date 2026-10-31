import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import type { Runtime } from "../../runtime.ts";
import type { TenantContext } from "../../context.ts";
import { attachProductMedia, uploadMediaDirect } from "../../media-services.ts";
import { getProduct, updateVariant } from "../../catalog-services.ts";
import { fetchImageSafely, type FetchedImage } from "./image-fetch.ts";
import { recordImportImageResult, type ImageTask } from "./import.ts";

export interface ImportImageJob {
  tenantId: string;
  runId: string;
  actorId: string | null;
  task: ImageTask;
}

/** The worker has a database handle only; the services below need nothing else from a Runtime. */
const workerRuntime = (db: Db): Runtime => ({ service: "worker", _db: { db, close: async () => {} } as unknown as Runtime["_db"], close: async () => {} });

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^(Bad Request|Conflict|Not Found|Forbidden): /, "") : "download failed");

/**
 * Downloads the images of one imported product and attaches them (docs/PRODUCT-BULK-IO-PLAN.md section 4).
 * Every URL is handled on its own and its result is written to the import run, so this never throws for a bad
 * image (a retry would double-count). The same file is never stored twice: media is matched by SHA-256 first.
 */
export async function processImportImageTask(
  db: Db,
  job: ImportImageJob,
  deps: { fetch?: (url: string) => Promise<FetchedImage> } = {},
): Promise<{ ok: number; failed: number }> {
  const rt = workerRuntime(db);
  const fetchImage = deps.fetch ?? ((u: string) => fetchImageSafely(u));
  const ctx: TenantContext = {
    tenantId: job.tenantId,
    storeStatus: "live",
    actor: job.actorId ? { type: "staff", userId: job.actorId } : { type: "system" },
    roles: ["system"],
    permissions: ["content.write", "products.write", "products.read"],
    requestId: `import-images-${job.runId}`,
  };
  const { task } = job;
  const mediaByUrl = new Map<string, string>();
  let ok = 0;
  let failed = 0;

  for (const [index, url] of task.urls.entries()) {
    try {
      const img = await fetchImage(url);
      const sha = crypto.createHash("sha256").update(img.bytes).digest("hex");
      const [existing] = await withTenant(db, job.tenantId, (tx) =>
        tx
          .select({ id: schema.media.id })
          .from(schema.media)
          .where(and(eq(schema.media.tenantId, job.tenantId), eq(schema.media.sha256, sha), eq(schema.media.status, "ready"), eq(schema.media.kind, "image")))
          .limit(1),
      );
      const mediaId =
        existing?.id ??
        (await uploadMediaDirect(rt, ctx, { fileBytes: img.bytes, filename: img.filename, mime: img.mime, folder: "products", ...(index === 0 && task.alt ? { alt: task.alt } : {}) })).id;
      await attachProductMedia(rt, ctx, { productId: task.productId, mediaId, ...(index === 0 && task.alt ? { alt: task.alt } : {}) });
      mediaByUrl.set(url, mediaId);
      ok++;
      await recordImportImageResult(rt, job.tenantId, job.runId, { ok: true });
    } catch (e) {
      failed++;
      await recordImportImageResult(rt, job.tenantId, job.runId, { ok: false, error: { row: 0, handle: task.handle, kind: "image", message: `${url.slice(0, 120)}: ${message(e)}` } });
    }
  }

  // Link variant images once their files exist.
  const wantsVariants = Object.entries(task.variantImages).filter(([, url]) => mediaByUrl.has(url));
  if (wantsVariants.length) {
    try {
      const product = await getProduct(rt, ctx, { id: task.productId });
      for (const [sku, url] of wantsVariants) {
        const variant = product.variants.find((v) => v.sku.toLowerCase() === sku.toLowerCase());
        if (variant) await updateVariant(rt, ctx, { id: variant.id, imageMediaId: mediaByUrl.get(url)! });
      }
    } catch {
      // The gallery images are already attached; a variant link problem is not worth failing the product.
    }
  }
  return { ok, failed };
}
