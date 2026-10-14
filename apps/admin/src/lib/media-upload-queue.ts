import type { MediaItem, MediaKind } from "@bs/contracts";
import { ALLOWED_MEDIA_TYPES } from "@bs/contracts";
import { client } from "./orpc.ts";
import { apiBase } from "./config.ts";
import { getActiveStoreId } from "./session.ts";
import { getSupportStoreId, getSupportToken } from "./support.ts";

export type UploadQueueStatus = "queued" | "uploading" | "success" | "error" | "canceled";

export interface UploadQueueItem {
  id: string;
  file: File;
  progress: number;
  status: UploadQueueStatus;
  result?: MediaItem;
  error?: string;
  cancel: () => void;
  retry: () => void;
}

export interface UploadUsageLimits {
  limitBytes?: number;
  usedBytes?: number;
  limits?: {
    image?: number;
    video?: number;
    document?: number;
  };
}

export interface MediaUploadOptions {
  folder?: string;
  alt?: string;
  title?: string;
  onProgress?: (percent: number) => void;
  onXhrCreated?: (xhr: XMLHttpRequest) => void;
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
 * Client-side pre-check for a file before initiating an upload request.
 */
export function preCheckFile(
  file: File,
  usage?: UploadUsageLimits | null,
): { error: string | null; kind: MediaKind | null; mime: string } {
  const lowerName = file.name.toLowerCase();
  const lowerExt = lowerName.split(".").pop() ?? "";

  if (lowerExt === "svg" || file.type === "image/svg+xml") {
    return {
      error: "SVG files are not supported for security reasons.",
      kind: null,
      mime: "image/svg+xml",
    };
  }

  const match = ALLOWED_MEDIA_TYPES.find(
    (t) => t.mime === file.type || (t.extensions as readonly string[]).includes(lowerExt),
  );

  if (!match) {
    return {
      error: "Not a supported file type",
      kind: null,
      mime: file.type || "application/octet-stream",
    };
  }

  const kind = match.kind as MediaKind;
  const mime = match.mime;

  // Check per-kind plan limit
  if (usage?.limits) {
    const limitForKind = usage.limits[kind];
    if (typeof limitForKind === "number" && limitForKind > 0 && file.size > limitForKind) {
      const limitMb = Math.round(limitForKind / (1024 * 1024));
      const kindLabel = kind === "image" ? "Images" : kind === "video" ? "Videos" : "Documents";
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      return {
        error: `Too large: ${kindLabel} can be up to ${limitMb} MB on your plan. This file is ${sizeMb} MB.`,
        kind,
        mime,
      };
    }
  }

  // Check overall storage limit
  if (usage && typeof usage.limitBytes === "number" && usage.limitBytes > 0) {
    const used = usage.usedBytes ?? 0;
    if (used + file.size > usage.limitBytes) {
      return {
        error: "Storage full. Delete unused files or empty the Trash.",
        kind,
        mime,
      };
    }
  }

  return { error: null, kind, mime };
}

/**
 * Extracts width/height for images or width/height/durationMs for videos client-side.
 */
export async function extractMediaMetadata(file: File): Promise<{
  width?: number;
  height?: number;
  durationMs?: number;
}> {
  if (file.type.startsWith("image/")) {
    try {
      if (typeof createImageBitmap !== "undefined") {
        const bmp = await createImageBitmap(file);
        const res = { width: bmp.width, height: bmp.height };
        bmp.close();
        return res;
      }
      return await new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };
        img.src = url;
      });
    } catch {
      return {};
    }
  }

  if (file.type.startsWith("video/")) {
    return await new Promise((resolve) => {
      try {
        const video = document.createElement("video");
        video.preload = "metadata";
        const url = URL.createObjectURL(file);
        video.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          const meta: { width?: number; height?: number; durationMs?: number } = {};
          if (video.videoWidth) meta.width = video.videoWidth;
          if (video.videoHeight) meta.height = video.videoHeight;
          if (Number.isFinite(video.duration)) meta.durationMs = Math.round(video.duration * 1000);
          resolve(meta);
        };
        video.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };
        video.src = url;
      } catch {
        resolve({});
      }
    });
  }

  return {};
}

/**
 * Server-proxied fallback upload with XHR for accurate upload progress.
 */
function uploadViaServerProxyXhr(
  file: File,
  options: MediaUploadOptions & {
    width?: number;
    height?: number;
    durationMs?: number;
  },
): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", options.folder || "catalog");
    if (options.alt) formData.append("alt", options.alt);
    if (options.title) formData.append("title", options.title);
    if (options.durationMs) formData.append("durationMs", String(options.durationMs));

    const xhr = new XMLHttpRequest();
    options.onXhrCreated?.(xhr);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const item = JSON.parse(xhr.responseText) as MediaItem;
          resolve(item);
        } catch (e) {
          reject(new Error("Invalid response from server", { cause: e }));
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const json = JSON.parse(xhr.responseText) as { error?: string; message?: string };
          msg = json.error || json.message || msg;
        } catch {
          // ignore
        }
        if (xhr.status === 403 && msg.toLowerCase().includes("quota")) {
          msg = "Storage quota exceeded for your store plan. Upgrade your plan or delete unused media.";
        }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.onabort = () => {
      reject(new Error("Upload canceled"));
    };

    xhr.open("POST", `${apiBase()}/api/admin/media/upload`);
    const headers = getStoreHeaders();
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.withCredentials = true;
    xhr.send(formData);
  });
}

/**
 * Uploads a single media file via direct PUT when available, falling back to server proxy.
 */
export async function uploadSingleFile(
  file: File,
  options: MediaUploadOptions = {},
): Promise<MediaItem> {
  const folder = options.folder || "catalog";
  const { error, mime } = preCheckFile(file);
  if (error) {
    throw new Error(error);
  }

  const metadata = await extractMediaMetadata(file);
  const title = options.title || file.name.replace(/\.[^/.]+$/, "");

  // Step 1: requestUpload
  let descriptor: {
    uploadUrl: string;
    method?: "PUT" | "POST";
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("quota")) {
      throw new Error("Storage quota exceeded for your store plan.", { cause: err });
    }
    if (msg.includes("Image storage is not set up")) {
      throw new Error("Storage is not configured. Please configure storage in Super Admin.", { cause: err });
    }
    throw new Error(`Upload request failed: ${msg}`, { cause: err });
  }

  const isDirectUrl =
    (descriptor.uploadUrl.startsWith("http://") || descriptor.uploadUrl.startsWith("https://")) &&
    !descriptor.uploadUrl.includes("/api/admin/media/upload");

  if (!isDirectUrl) {
    return await uploadViaServerProxyXhr(file, {
      ...options,
      ...metadata,
      title,
    });
  }

  // Step 2: Direct PUT with XHR for progress tracking
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      options.onXhrCreated?.(xhr);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && options.onProgress) {
          options.onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Direct storage upload returned status ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error("Direct upload failed (likely CORS)"));
      };

      xhr.onabort = () => {
        reject(new Error("Upload canceled"));
      };

      xhr.open(descriptor.method || "PUT", descriptor.uploadUrl);
      const headers = { ...descriptor.headers };
      delete headers["content-length"];
      delete headers["Content-Length"];
      for (const [k, v] of Object.entries(headers)) {
        xhr.setRequestHeader(k, v);
      }
      xhr.send(file);
    });
  } catch (err) {
    // Fallback to server proxy on CORS or direct upload error
    console.warn("Direct storage upload failed, falling back to server-proxied upload.", err);
    return await uploadViaServerProxyXhr(file, {
      ...options,
      ...metadata,
      title,
    });
  }

  // Step 3: Record media in DB
  return await client.admin.media.create({
    storageKey: descriptor.storageKey,
    mime,
    bytes: file.size,
    folder,
    filename: file.name,
    title,
    width: metadata.width,
    height: metadata.height,
    durationMs: metadata.durationMs,
    alt: options.alt,
  });
}

/**
 * Shared in-memory upload queue for Media Library and pickers.
 * Manages up to 4 concurrent uploads, client pre-checks, progress updates, and retries.
 */
class MediaUploadQueueManager {
  private queue: UploadQueueItem[] = [];
  private activeCount = 0;
  private readonly maxConcurrent = 4;
  private listeners = new Set<(items: UploadQueueItem[]) => void>();
  private onItemCompletedListeners = new Set<(item: MediaItem) => void>();

  public subscribe(listener: (items: UploadQueueItem[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.queue]);
    return () => this.listeners.delete(listener);
  }

  public onUploadSuccess(cb: (item: MediaItem) => void): () => void {
    this.onItemCompletedListeners.add(cb);
    return () => this.onItemCompletedListeners.delete(cb);
  }

  public getItems(): UploadQueueItem[] {
    return [...this.queue];
  }

  private notify() {
    const snapshot = [...this.queue];
    for (const l of this.listeners) {
      l(snapshot);
    }
  }

  public addFiles(files: File[], usageLimits?: UploadUsageLimits | null) {
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const { error } = preCheckFile(file, usageLimits);

      const item: UploadQueueItem = {
        id,
        file,
        progress: 0,
        status: error ? "error" : "queued",
        cancel: () => this.cancelItem(id),
        retry: () => this.retryItem(id),
      };
      if (error) {
        item.error = error;
      }

      this.queue.push(item);
    }
    this.notify();
    this.processQueue();
  }

  public cancelItem(id: string) {
    const item = this.queue.find((q) => q.id === id);
    if (!item) return;
    if (item.status === "uploading" || item.status === "queued") {
      item.status = "canceled";
      this.notify();
      this.processQueue();
    }
  }

  public retryItem(id: string) {
    const item = this.queue.find((q) => q.id === id);
    if (!item) return;
    item.status = "queued";
    delete item.error;
    item.progress = 0;
    this.notify();
    this.processQueue();
  }

  public removeItem(id: string) {
    const index = this.queue.findIndex((q) => q.id === id);
    if (index >= 0) {
      const item = this.queue[index];
      if (item && item.status === "uploading") {
        item.status = "canceled";
      }
      this.queue.splice(index, 1);
      this.notify();
      this.processQueue();
    }
  }

  public clearCompleted() {
    this.queue = this.queue.filter((q) => q.status === "uploading" || q.status === "queued");
    this.notify();
  }

  private processQueue() {
    while (this.activeCount < this.maxConcurrent) {
      const next = this.queue.find((q) => q.status === "queued");
      if (!next) break;

      this.startUpload(next);
    }
  }

  private async startUpload(item: UploadQueueItem) {
    this.activeCount++;
    item.status = "uploading";
    item.progress = 0;
    this.notify();

    let currentXhr: XMLHttpRequest | null = null;
    const cancelItem = () => {
      if (currentXhr) {
        currentXhr.abort();
      }
      item.status = "canceled";
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.notify();
      this.processQueue();
    };
    item.cancel = cancelItem;

    try {
      const result = await uploadSingleFile(item.file, {
        onProgress: (pct) => {
          if (item.status === "uploading") {
            item.progress = pct;
            this.notify();
          }
        },
        onXhrCreated: (xhr) => {
          currentXhr = xhr;
        },
      });

      item.status = "success";
      item.progress = 100;
      item.result = result;
      for (const cb of this.onItemCompletedListeners) {
        cb(result);
      }
    } catch (err: unknown) {
      if ((item.status as UploadQueueStatus) !== "canceled") {
        item.status = "error";
        item.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.notify();
      this.processQueue();
    }
  }
}

export const mediaUploadQueue = new MediaUploadQueueManager();

/**
 * Replaces an existing media file's content while keeping id, references, and metadata.
 */
export async function replaceMediaFile(
  mediaId: string,
  file: File,
  options: {
    expectedKind?: MediaKind | undefined;
    usage?: UploadUsageLimits | null | undefined;
    onProgress?: ((percent: number) => void) | undefined;
  } = {},
): Promise<MediaItem> {
  const { error, kind, mime } = preCheckFile(file, options.usage);
  if (error) {
    throw new Error(error);
  }
  if (options.expectedKind && kind !== options.expectedKind) {
    throw new Error(
      `Cannot replace ${options.expectedKind} with ${kind}. Replacement must be the same file type.`,
    );
  }

  const metadata = await extractMediaMetadata(file);

  const descriptor = await client.admin.media.requestUpload({
    filename: file.name,
    mime,
    bytes: file.size,
    folder: "uploads",
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Direct storage upload returned status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Direct upload failed"));
    xhr.onabort = () => reject(new Error("Upload canceled"));

    xhr.open(descriptor.method || "PUT", descriptor.uploadUrl);
    const headers = { ...descriptor.headers };
    delete headers["content-length"];
    delete headers["Content-Length"];
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.send(file);
  });

  return await client.admin.media.replace({
    id: mediaId,
    storageKey: descriptor.storageKey,
    mime,
    bytes: file.size,
    filename: file.name,
    durationMs: metadata.durationMs,
  });
}
