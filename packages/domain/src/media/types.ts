import type { AllowedMediaType, MediaKind } from "@bs/contracts";

export type { AllowedMediaType, MediaKind };

export const PRIVATE_MEDIA_FOLDERS = ["returns", "expense-receipts"] as const;
export type PrivateMediaFolder = (typeof PRIVATE_MEDIA_FOLDERS)[number];

export interface MediaTypeDefinition extends AllowedMediaType {
  verifyMagicBytes: (buffer: Uint8Array, filename?: string) => boolean;
}

function hasAscii(buffer: Uint8Array, start: number, str: string): boolean {
  if (buffer.length < start + str.length) return false;
  for (let i = 0; i < str.length; i++) {
    if (buffer[start + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

function hasZipSignature(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

function getExtension(filename?: string): string | undefined {
  if (!filename) return undefined;
  const parts = filename.split(".");
  if (parts.length <= 1) return undefined;
  return parts[parts.length - 1]?.toLowerCase().trim();
}

function isTextWithoutNul(buffer: Uint8Array): boolean {
  if (buffer.length === 0) return false;
  const inspectLen = Math.min(buffer.length, 4096);
  for (let i = 0; i < inspectLen; i++) {
    if (buffer[i] === 0x00) return false;
  }
  return true;
}

export const MEDIA_TYPES: readonly MediaTypeDefinition[] = [
  // 1. JPEG: FF D8 FF
  {
    mime: "image/jpeg",
    kind: "image",
    extensions: ["jpg", "jpeg"],
    verifyMagicBytes: (buf) =>
      buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  // 2. PNG: 89 50 4E 47
  {
    mime: "image/png",
    kind: "image",
    extensions: ["png"],
    verifyMagicBytes: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  // 3. WebP: RIFF....WEBP
  {
    mime: "image/webp",
    kind: "image",
    extensions: ["webp"],
    verifyMagicBytes: (buf) =>
      buf.length >= 12 && hasAscii(buf, 0, "RIFF") && hasAscii(buf, 8, "WEBP"),
  },
  // 4. AVIF: ....ftypavif / ftypavis
  {
    mime: "image/avif",
    kind: "image",
    extensions: ["avif"],
    verifyMagicBytes: (buf) => {
      if (buf.length < 12) return false;
      if (!hasAscii(buf, 4, "ftyp")) return false;
      if (hasAscii(buf, 8, "avif") || hasAscii(buf, 8, "avis")) return true;
      // Also check compatible brands in first 64 bytes
      const limit = Math.min(buf.length - 4, 64);
      for (let i = 8; i <= limit; i += 4) {
        if (hasAscii(buf, i, "avif") || hasAscii(buf, i, "avis")) return true;
      }
      return false;
    },
  },
  // 5. GIF: 47 49 46 38 (GIF87a / GIF89a)
  {
    mime: "image/gif",
    kind: "image",
    extensions: ["gif"],
    verifyMagicBytes: (buf) =>
      buf.length >= 6 && hasAscii(buf, 0, "GIF8") && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61,
  },
  // 6. MP4: usually ....ftyp (brands isom, mp4*, avc1, M4V, etc.), but several encoders and screen recorders start the
  // file with a free / skip / wide / moov / mdat box instead, which is still a valid MP4.
  {
    mime: "video/mp4",
    kind: "video",
    extensions: ["mp4"],
    verifyMagicBytes: (buf) => {
      if (buf.length < 12) return false;
      if (hasAscii(buf, 4, "ftyp")) return true;
      const firstBoxSize = ((buf[0] ?? 0) * 0x1000000) + (((buf[1] ?? 0) << 16) | ((buf[2] ?? 0) << 8) | (buf[3] ?? 0));
      if (firstBoxSize < 8 && firstBoxSize !== 1) return false;
      return ["free", "skip", "wide", "moov", "mdat"].some((box) => hasAscii(buf, 4, box));
    },
  },
  // 7. WebM: 1A 45 DF A3 (EBML)
  {
    mime: "video/webm",
    kind: "video",
    extensions: ["webm"],
    verifyMagicBytes: (buf) =>
      buf.length >= 4 &&
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3,
  },
  // 8. QuickTime MOV: ....ftyp OR QuickTime atom headers
  {
    mime: "video/quicktime",
    kind: "video",
    extensions: ["mov"],
    verifyMagicBytes: (buf) => {
      if (buf.length < 8) return false;
      if (hasAscii(buf, 4, "ftyp")) return true;
      const atoms = ["moov", "mdat", "wide", "free", "skip", "pnot"];
      for (const atom of atoms) {
        if (hasAscii(buf, 4, atom)) return true;
      }
      return false;
    },
  },
  // 9. PDF: 25 50 44 46 (%PDF)
  {
    mime: "application/pdf",
    kind: "document",
    extensions: ["pdf"],
    verifyMagicBytes: (buf) =>
      buf.length >= 4 &&
      buf[0] === 0x25 &&
      buf[1] === 0x50 &&
      buf[2] === 0x44 &&
      buf[3] === 0x46,
  },
  // 10. CSV: no signature, reject NUL in first 4 KB
  {
    mime: "text/csv",
    kind: "document",
    extensions: ["csv"],
    verifyMagicBytes: (buf, filename) => {
      if (!isTextWithoutNul(buf)) return false;
      if (filename) {
        const ext = getExtension(filename);
        if (ext && ext !== "csv") return false;
      }
      return true;
    },
  },
  // 11. Plain text: no signature, reject NUL in first 4 KB
  {
    mime: "text/plain",
    kind: "document",
    extensions: ["txt"],
    verifyMagicBytes: (buf, filename) => {
      if (!isTextWithoutNul(buf)) return false;
      if (filename) {
        const ext = getExtension(filename);
        if (ext && ext !== "txt") return false;
      }
      return true;
    },
  },
  // 12. DOCX: 50 4B 03 04 (zip + docx extension)
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    extensions: ["docx"],
    verifyMagicBytes: (buf, filename) => {
      if (!hasZipSignature(buf)) return false;
      if (filename) {
        const ext = getExtension(filename);
        if (ext && ext !== "docx") return false;
      }
      return true;
    },
  },
  // 13. XLSX: 50 4B 03 04 (zip + xlsx extension)
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
    extensions: ["xlsx"],
    verifyMagicBytes: (buf, filename) => {
      if (!hasZipSignature(buf)) return false;
      if (filename) {
        const ext = getExtension(filename);
        if (ext && ext !== "xlsx") return false;
      }
      return true;
    },
  },
  // 14. PPTX: 50 4B 03 04 (zip + pptx extension)
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
    extensions: ["pptx"],
    verifyMagicBytes: (buf, filename) => {
      if (!hasZipSignature(buf)) return false;
      if (filename) {
        const ext = getExtension(filename);
        if (ext && ext !== "pptx") return false;
      }
      return true;
    },
  },
] as const;

export const MEDIA_TYPE_MAP = new Map<string, MediaTypeDefinition>(
  MEDIA_TYPES.map((t) => [t.mime.toLowerCase(), t]),
);

export function getMediaTypeDefinition(mime: string): MediaTypeDefinition | undefined {
  return MEDIA_TYPE_MAP.get(mime.toLowerCase());
}

export function isAllowedMime(mime: string): boolean {
  return MEDIA_TYPE_MAP.has(mime.toLowerCase());
}

export function getMediaKind(mime: string): MediaKind | undefined {
  return MEDIA_TYPE_MAP.get(mime.toLowerCase())?.kind;
}

export function getAllowedExtensionsForMime(mime: string): readonly string[] {
  return MEDIA_TYPE_MAP.get(mime.toLowerCase())?.extensions ?? [];
}

export interface MagicByteValidationResult {
  valid: boolean;
  error?: string;
  kind?: MediaKind;
}

/**
 * Validates that the provided bytes match the declared MIME type using magic-byte signatures
 * (MEDIA-LIBRARY-PLAN §4).
 */
export function verifyMediaMagicBytes(
  mime: string,
  buffer: Uint8Array | Buffer,
  filename?: string,
): MagicByteValidationResult {
  const normMime = mime.toLowerCase().trim();

  if (normMime === "image/svg+xml") {
    return {
      valid: false,
      error: "SVG uploads are disabled for security reasons",
    };
  }

  const def = getMediaTypeDefinition(normMime);
  if (!def) {
    return {
      valid: false,
      error: `Unsupported MIME type: "${mime}"`,
    };
  }

  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      error: "File is empty",
    };
  }

  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const ok = def.verifyMagicBytes(u8, filename);
  if (!ok) {
    return {
      valid: false,
      error: `File content does not match declared MIME type: "${mime}" (not a recognized image format or does not match file contents)`,
    };
  }

  return {
    valid: true,
    kind: def.kind,
  };
}
