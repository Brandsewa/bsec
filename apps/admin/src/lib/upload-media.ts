import type { MediaItem } from "@bs/contracts";
import { uploadSingleFile } from "./media-upload-queue.ts";

export interface UploadMediaOptions {
  folder?: string;
  alt?: string;
  title?: string;
}

/**
 * Unified media upload function for Store Admin.
 * Re-exports backwards-compatible uploadMedia built on top of the media upload queue engine.
 */
export async function uploadMedia(
  file: File,
  options?: UploadMediaOptions,
): Promise<MediaItem> {
  return await uploadSingleFile(file, options);
}

export { mediaUploadQueue, preCheckFile, extractMediaMetadata } from "./media-upload-queue.ts";
