/**
 * Best-effort client IP for rate limiting. Behind Traefik (and optionally Cloudflare) the proxy
 * APPENDS the address it saw to X-Forwarded-For, so the rightmost entry is the trustworthy hop;
 * the leftmost entry is whatever the caller sent and must never be trusted.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
