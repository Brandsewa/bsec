export interface CollectedMediaIds {
  images: string[];
  videos: string[];
  files: string[];
  all: string[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a value is a valid UUID string (case-insensitive).
 */
export function isUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_REGEX.test(val.trim());
}

/**
 * Checks if a property key is a media reference according to MEDIA-LIBRARY-PLAN §5 & Phase 3 S1.
 * Matches: mediaId, *MediaId, mediaIds, *MediaIds, or any key containing "media" (case-insensitive).
 * Ignores: url, href, bgVideoUrl, etc.
 */
export function isMediaKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    key === "mediaId" ||
    key.endsWith("MediaId") ||
    key === "mediaIds" ||
    key.endsWith("MediaIds") ||
    lower.includes("media")
  );
}

function classifyKind(
  key: string,
  blockType: string | null,
): "image" | "video" | "file" {
  const lowerKey = key.toLowerCase();
  const lowerBlock = (blockType ?? "").toLowerCase();

  // 1. Explicit video: Video block mediaId, or key containing "video"
  if ((lowerBlock === "video" && lowerKey === "mediaid") || lowerKey.includes("video")) {
    return "video";
  }

  // 2. Explicit file / document: FileDownload/File block mediaId, or key containing "file" or "doc"
  if (
    (lowerBlock.includes("file") && lowerKey === "mediaid") ||
    lowerKey.includes("file") ||
    lowerKey.includes("doc")
  ) {
    return "file";
  }

  // 3. Default to image (e.g. posterMediaId, backgroundMediaId, avatarMediaId, logoMediaId, Image mediaId, Gallery mediaId)
  return "image";
}

/**
 * Walks a block document, page version, or theme token structure generically and extracts
 * all valid media UUIDs categorized by kind (images, videos, files, and all).
 * Deduplicates IDs, ignores empty strings, and ignores non-UUID values.
 */
export function collectMediaIds(document: unknown): CollectedMediaIds {
  const images = new Set<string>();
  const videos = new Set<string>();
  const files = new Set<string>();
  const all = new Set<string>();

  if (!document || typeof document !== "object") {
    return { images: [], videos: [], files: [], all: [] };
  }

  const visited = new WeakSet<object>();

  function walk(node: unknown, currentBlockType: string | null): void {
    if (!node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (isUuid(trimmed)) {
            images.add(trimmed);
            all.add(trimmed);
          }
        } else if (item && typeof item === "object") {
          walk(item, currentBlockType);
        }
      }
      return;
    }

    const obj = node as Record<string, unknown>;

    // If this object represents a block instance, track blockType
    let blockType = currentBlockType;
    if (typeof obj.type === "string") {
      blockType = obj.type;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (!key) continue;

      if (isMediaKey(key)) {
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (isUuid(trimmed)) {
            const kind = classifyKind(key, blockType);
            if (kind === "video") videos.add(trimmed);
            else if (kind === "file") files.add(trimmed);
            else images.add(trimmed);
            all.add(trimmed);
          }
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") {
              const trimmed = item.trim();
              if (isUuid(trimmed)) {
                const kind = classifyKind(key, blockType);
                if (kind === "video") videos.add(trimmed);
                else if (kind === "file") files.add(trimmed);
                else images.add(trimmed);
                all.add(trimmed);
              }
            } else if (item && typeof item === "object") {
              walk(item, blockType);
            }
          }
        } else if (value && typeof value === "object") {
          walk(value, blockType);
        }
      } else {
        // Non-media key: continue walking nested structures (e.g. props, slots, items, slides)
        if (value && typeof value === "object") {
          walk(value, blockType);
        }
      }
    }
  }

  walk(document, null);

  return {
    images: Array.from(images),
    videos: Array.from(videos),
    files: Array.from(files),
    all: Array.from(all),
  };
}
