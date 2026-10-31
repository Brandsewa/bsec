import net from "node:net";

/**
 * Address checks for fetching merchant-supplied image URLs (product import, docs/PRODUCT-BULK-IO-PLAN.md section 4).
 * The fetcher resolves DNS itself, runs every resolved address through `isBlockedAddress`, and connects to that
 * address (so a hostname cannot change its answer between the check and the request).
 */

const v4ToInt = (ip: string): number => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast and reserved
  ["240.0.0.0", 4],
];

export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      return n >= v4ToInt(base) && n < v4ToInt(base) + size;
    });
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    if (s === "::" || s === "::1") return true;
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // not an IP at all: refuse
}

/** The URL-level checks that need no network: https, a hostname, no credentials, standard port, no IP literal in a blocked range. */
export function checkImageUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https URLs are allowed" };
  if (url.username || url.password) return { ok: false, reason: "URLs with credentials are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "only the standard https port is allowed" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "internal hostnames are not allowed" };
  }
  if (net.isIP(host) && isBlockedAddress(host)) return { ok: false, reason: "private or reserved addresses are not allowed" };
  return { ok: true, url };
}

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Sniffs the real type from the first bytes; the Content-Type header is never trusted. SVG is not accepted. */
export function sniffImageMime(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
  return null;
}
