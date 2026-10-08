import fs from "node:fs";
import path from "node:path";
import { resolveSafeLocalPath, getActiveStorageDriver } from "@bs/domain";
import { server } from "@/server/runtime.ts";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/**
 * Serves locally stored media files.
 * Enforces strict path traversal protection, correct content types,
 * immutable caching, and defensive security headers.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    const resolvedParams = await params;
    const rawKey = resolvedParams.key?.join("/") ?? "";
    if (!rawKey) {
      return new Response("Not Found", { status: 404 });
    }

    // Determine base directory from active storage driver or env fallback
    const { rt } = server();
    let baseDir = process.env.MEDIA_LOCAL_DIR || "./.data/media";
    try {
      const { config } = await getActiveStorageDriver(rt._db.db, "public_media");
      if (config.localDir) {
        baseDir = config.localDir;
      }
    } catch {
      // Use fallback base directory
    }

    const resolvedBase = path.resolve(/*turbopackIgnore: true*/ baseDir);
    let filePath: string;
    try {
      filePath = resolveSafeLocalPath(resolvedBase, rawKey);
    } catch {
      return new Response("Invalid key or path traversal detected", { status: 400 });
    }

    // Check file exists on filesystem
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return new Response("Not Found", { status: 404 });
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return new Response("Not Found", { status: 404 });
      }
      throw err;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    const fileStream = fs.createReadStream(filePath);
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
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Frame-Options": "DENY",
      },
    });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
}
