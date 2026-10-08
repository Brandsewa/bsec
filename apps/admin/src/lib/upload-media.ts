import type { MediaItem } from "@bs/contracts";
import { client } from "./orpc.ts";
import { apiBase } from "./config.ts";
import { getActiveStoreId } from "./session.ts";
import { getSupportStoreId, getSupportToken } from "./support.ts";

export interface UploadMediaOptions {
  folder?: string;
  alt?: string;
}

function getStoreHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const support = getSupportToken();
  if (support) {
    headers["x-support-token"] = support;
    const storeId = getSupportStoreId();
    if (storeId) headers["x-store-id"] = storeId;
  } else {
    const id = getActiveStoreId();
    if (id) headers["x-store-id"] = id;
  }
  return headers;
}

/**
 * Server-proxied fallback upload: streams file as multipart/form-data to /api/admin/media/upload.
 * Used when direct browser-to-bucket upload is disabled, or when CORS prevents direct PUT.
 */
async function uploadViaServerProxy(
  file: File,
  options?: UploadMediaOptions,
): Promise<MediaItem> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", options?.folder || "products");
  if (options?.alt) {
    formData.append("alt", options.alt);
  }

  const endpoint = `${apiBase()}/api/admin/media/upload`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: getStoreHeaders(),
    body: formData,
    credentials: "include",
  });

  if (!res.ok) {
    const errorJson = (await res.json().catch(() => null)) as { error?: string } | null;
    const serverMsg = errorJson?.error || `Upload failed with status ${res.status}`;
    if (res.status === 403 && serverMsg.toLowerCase().includes("quota")) {
      throw new Error("Storage quota exceeded for your store plan. Upgrade your plan or delete unused media.");
    }
    if (res.status === 400) {
      throw new Error(`Invalid file: ${serverMsg}`);
    }
    throw new Error(serverMsg);
  }

  return (await res.json()) as MediaItem;
}

/**
 * Unified media upload function for Store Admin.
 * Handles:
 * 1. Requesting upload descriptor from server.
 * 2. If server-proxied or local driver (/api/admin/media/upload), streams directly through server.
 * 3. If direct bucket URL, attempts PUT with automatic fallback to server proxy on CORS failure.
 * 4. Human-friendly error translation (never shows raw "Failed to fetch").
 */
export async function uploadMedia(
  file: File,
  options?: UploadMediaOptions,
): Promise<MediaItem> {
  const folder = options?.folder || "products";
  const mime = file.type || "application/octet-stream";

  // Step 1: Request upload descriptor
  let descriptor: {
    uploadUrl: string;
    method?: string;
    storageKey: string;
    headers: Record<string, string>;
  };
  try {
    descriptor = await client.admin.media.requestUpload({
      filename: file.name,
      mime,
      bytes: file.size,
      folder,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("quota")) {
      throw new Error(
        "Storage quota exceeded for your store plan. Upgrade your plan or delete unused media.",
        { cause: err },
      );
    }
    if (msg.includes("Image storage is not set up")) {
      throw new Error(
        "Storage is not configured yet. Please configure a storage connection in Super Admin.",
        { cause: err },
      );
    }
    throw new Error(`Upload request failed: ${msg}`, { cause: err });
  }

  // Step 2: Route according to descriptor
  const isDirectUrl = descriptor.uploadUrl.startsWith("http://") || descriptor.uploadUrl.startsWith("https://");

  if (!isDirectUrl || descriptor.uploadUrl.includes("/api/admin/media/upload")) {
    // Server-proxied or local storage driver
    return await uploadViaServerProxy(file, options);
  }

  // Direct bucket upload via signed URL
  try {
    // Strip forbidden headers like Content-Length
    const headers: Record<string, string> = { ...descriptor.headers };
    delete headers["content-length"];
    delete headers["Content-Length"];

    const res = await fetch(descriptor.uploadUrl, {
      method: descriptor.method || "PUT",
      headers,
      body: file,
    });

    if (!res.ok) {
      // Non-2xx from storage provider - fallback to server proxy
      console.warn(`Direct storage upload returned status ${res.status}. Falling back to server-proxied upload.`);
      return await uploadViaServerProxy(file, options);
    }
  } catch (fetchErr) {
    // Network error or CORS preflight rejection (e.g. TypeError: Failed to fetch)
    console.warn("Direct storage upload failed (likely bucket CORS). Falling back to server-proxied upload.", fetchErr);
    try {
      return await uploadViaServerProxy(file, options);
    } catch (proxyErr) {
      // Both failed: report clear human-readable error
      throw new Error(
        proxyErr instanceof Error
          ? proxyErr.message
          : "Image upload failed. Ensure storage connection is healthy and bucket CORS is configured.",
        { cause: proxyErr },
      );
    }
  }

  // Step 3: Direct PUT succeeded; persist media record in database
  try {
    return await client.admin.media.create({
      storageKey: descriptor.storageKey,
      mime,
      bytes: file.size,
      folder,
      alt: options?.alt,
    });
  } catch (createErr) {
    throw new Error(
      createErr instanceof Error ? createErr.message : "Failed to record uploaded image in media library",
      { cause: createErr },
    );
  }
}
