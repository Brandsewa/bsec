import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import {
  evaluateStorefrontAccess,
  checkStorefrontRateLimit,
  RateLimitExceededError,
  getMediaForStorefrontDownload,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * Same-origin document download route per Phase 4 Plan S1.
 * Serves ready or trashed (before permanent purge), non-private library media under tenant RLS.
 * Redirects 302 to a short-lived (60s) presigned URL for S3/R2 drivers with ResponseContentDisposition set,
 * or directly streams the file with Content-Disposition: attachment for local storage drivers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  try {
    const { mediaId } = await params;
    if (!mediaId) {
      return new Response("Not Found", { status: 404 });
    }

    const host =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: req.headers });

    if (!access.allowed || !access.tenantId) {
      if (access.httpStatus === 503) {
        return new Response("Store Unavailable", { status: 503 });
      }
      return new Response("Store Not Found", { status: 404 });
    }

    // Rate limiting: protects download endpoint from abuse
    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(err.retryAfter) },
        });
      }
      throw err;
    }

    const download = await getMediaForStorefrontDownload(rt._db.db, access.tenantId, mediaId);
    if (!download) {
      return new Response("Not Found", { status: 404 });
    }

    // S3 / R2 storage driver: 302 redirect to presigned download URL
    if (download.driverType === "s3" || download.driverType === "r2") {
      if (!download.downloadUrl) {
        return new Response("Not Found", { status: 404 });
      }
      return NextResponse.redirect(download.downloadUrl, 302);
    }

    // Local storage driver: stream file directly with attachment Content-Disposition
    if (!download.localFilePath) {
      return new Response("Not Found", { status: 404 });
    }

    const fileStream = fs.createReadStream(download.localFilePath);
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on("data", (chunk) => controller.enqueue(chunk));
        fileStream.on("end", () => controller.close());
        fileStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        fileStream.destroy();
      },
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": download.mime || "application/octet-stream",
        "Content-Disposition": download.dispositionHeader,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Frame-Options": "DENY",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
}
