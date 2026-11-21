/** A short "Chrome on Windows" label from a user agent string. Best effort; never throws. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

/** A readable address: "::ffff:1.2.3.4" becomes "1.2.3.4" and the many spellings of IPv6 localhost become "localhost". */
export function displayIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/i, "");
  if (/^(0{1,4}:){7}0{0,3}[01]$/.test(v) || v === "::1" || v === "::" || v === "127.0.0.1") return "localhost";
  return v;
}
