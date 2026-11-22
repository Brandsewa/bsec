/**
 * Pure rules for store redirects (ADR-051): how an address is normalised, which sources are not allowed and what a target may be.
 * No database here, so every rule is unit-tested without one.
 */

/** Paths the store needs to work, or that are not pages: a redirect may not start here (exact match or a sub-path). */
export const RESERVED_REDIRECT_PREFIXES = [
  "/api",
  "/_next",
  "/admin",
  "/cart",
  "/checkout",
  "/account",
  "/orders",
  "/o",
  "/cod",
  "/address",
  "/privacy-request",
  "/privacy-verify",
  "/unsubscribe",
  "/.well-known",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  "/manifest.webmanifest",
] as const;

export const MAX_REDIRECTS_PER_STORE = 5000;
export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const;
export type RedirectStatus = (typeof REDIRECT_STATUS_CODES)[number];

const hasUnsafeChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x5c) return true;
  }
  return false;
};

/**
 * A source address: a path, or a full URL whose path is taken (the host is ignored: redirects belong to the store).
 * Returns null when it is not a usable path. The query string and fragment are dropped: a redirect matches the path only.
 */
export function normalizeFromPath(input: string): string | null {
  let raw = input.trim();
  if (!raw || hasUnsafeChar(raw)) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("//")) return null;
  if (!raw.startsWith("/")) raw = `/${raw}`;
  raw = raw.replace(/[?#].*$/, "").replace(/\/{2,}/g, "/");
  if (raw.length > 1 && raw.endsWith("/")) raw = raw.slice(0, -1);
  if (raw.length > 500) return null;
  return raw;
}

/** The first reason a source address may not be redirected, or null. */
export function reservedReason(from: string): string | null {
  if (from === "/") return "The home page cannot be redirected.";
  const lower = from.toLowerCase();
  for (const p of RESERVED_REDIRECT_PREFIXES) {
    if (lower === p || lower.startsWith(`${p}/`)) return `${p} is part of how the store works and cannot be redirected.`;
  }
  return null;
}

/** A target: a path on the store (query and fragment kept) or an http(s) URL. Returns null when it is neither. */
export function normalizeToPath(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 2000 || hasUnsafeChar(raw)) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
    } catch {
      return null;
    }
  }
  // Any other scheme (javascript:, data:, mailto:, ftp:) is not a place on the web a redirect may send a visitor to.
  if (raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** The path part of a target that stays on the store (no query or fragment, no trailing slash), or null for an outside URL. */
export function targetAsStorePath(to: string): string | null {
  if (!to.startsWith("/")) return null;
  const path = to.replace(/[?#].*$/, "");
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function parseStatus(input: unknown): RedirectStatus | null {
  const n = typeof input === "string" ? Number(input.trim()) : Number(input);
  return (REDIRECT_STATUS_CODES as readonly number[]).includes(n) ? (n as RedirectStatus) : null;
}

/**
 * True when following `to` through the existing redirects (`map`: lower-cased source path to its target) leads back to `from`
 * within `maxHops`. A chain that is merely long is refused too: a visitor should never be bounced more than a few times.
 */
export function wouldLoop(from: string, to: string, map: ReadonlyMap<string, string>, maxHops = 5): boolean {
  const start = from.toLowerCase();
  let current = targetAsStorePath(to);
  for (let hop = 0; current && hop <= maxHops; hop++) {
    const key = current.toLowerCase();
    if (key === start) return true;
    const next = map.get(key);
    if (!next) return false;
    current = targetAsStorePath(next);
  }
  // Ran out of hops while still on the store: treat as a loop (or a chain too long to be useful).
  return current !== null;
}
