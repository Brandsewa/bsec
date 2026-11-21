import { createHmac } from "node:crypto";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";

/** The closed list of traffic events. Orders and revenue are never events; those reports read the orders tables. */
export const ANALYTICS_EVENT_TYPES = ["pageview", "add_to_cart", "begin_checkout"] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export interface CollectEventInput {
  type: string;
  /** Path of the page. Query strings and hashes are dropped here, never trusted from the caller. */
  path: string;
  /** document.referrer or the Referer header. Only the host is kept. */
  referrer?: string | null | undefined;
  /** The page URL's search string, from which only utm_source, utm_medium and utm_campaign are read. */
  search?: string | null | undefined;
  ip: string;
  userAgent: string;
  /** Edge country code, passed only when the request came through Cloudflare. */
  country?: string | null | undefined;
  /** Sec-GPC or DNT header: the visitor asked not to be measured, so nothing is stored. */
  doNotTrack?: boolean | undefined;
  /** The store's own host, so its own pages never count as an external referrer. */
  ownHost?: string | undefined;
}

export type CollectResult = "recorded" | "ignored";

const BOT_UA = /bot|crawler|spider|crawling|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python-requests|httpclient|go-http|node-fetch|axios|facebookexternalhit|embedly|whatsapp/i;

export function isBotUserAgent(ua: string): boolean {
  return !ua || ua.length < 10 || BOT_UA.test(ua);
}

export function deviceFromUserAgent(ua: string): "desktop" | "mobile" | "tablet" {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * HMAC of tenant + IP + user agent keyed by a secret and the UTC day. Cookieless (nothing is set on the device), cannot be reversed,
 * cannot be linked across days and never matches across stores. The secret is the auth secret already deployed; no new env var.
 */
export function visitorHash(secret: string, tenantId: string, ip: string, userAgent: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", `${secret}:analytics:${day}`).update(`${tenantId}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
}

function cleanPath(raw: string): string | null {
  let p = raw.trim();
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  if (!p.startsWith("/")) return null;
  p = p.slice(0, 200);
  // Control characters have no business in a path; reject instead of storing them.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f]/.test(p) ? null : p;
}

function hostOf(raw: string | null | undefined, ownHost?: string): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.length > 120) return null;
    if (ownHost && host === ownHost.toLowerCase().replace(/^www\./, "").split(":")[0]) return null;
    return host;
  } catch {
    return null;
  }
}

function utm(search: string | null | undefined, key: string): string | null {
  if (!search) return null;
  const v = new URLSearchParams(search).get(key)?.trim().toLowerCase();
  return v ? v.slice(0, 60) : null;
}

/**
 * Stores one traffic event. Public input, so it is strict and quiet: unknown event types, bots, Do-Not-Track and Global Privacy
 * Control requests, and malformed paths are ignored without an error; a database failure never reaches the shopper.
 * The caller (the storefront route) has already resolved the store and rate-limited the request.
 */
export async function recordAnalyticsEvent(
  rt: Runtime,
  tenantId: string,
  input: CollectEventInput,
  opts: { secret: string; now?: Date },
): Promise<CollectResult> {
  if (input.doNotTrack) return "ignored";
  if (!(ANALYTICS_EVENT_TYPES as readonly string[]).includes(input.type)) return "ignored";
  if (isBotUserAgent(input.userAgent)) return "ignored";
  const path = cleanPath(input.path);
  if (!path) return "ignored";
  const now = opts.now ?? new Date();
  const country = input.country && /^[A-Za-z]{2}$/.test(input.country) ? input.country.toUpperCase() : null;
  const slug = /^\/products\/([^/]+)/.exec(path)?.[1] ?? null;

  try {
    await withTenant(rt._db.db, tenantId, async (tx) => {
      await tx.insert(schema.analyticsEvents).values({
        tenantId,
        occurredAt: now,
        eventType: input.type,
        visitorHash: visitorHash(opts.secret, tenantId, input.ip, input.userAgent, now),
        path,
        productSlug: slug ? slug.slice(0, 120) : null,
        referrerHost: hostOf(input.referrer, input.ownHost),
        utmSource: utm(input.search, "utm_source"),
        utmMedium: utm(input.search, "utm_medium"),
        utmCampaign: utm(input.search, "utm_campaign"),
        country,
        device: deviceFromUserAgent(input.userAgent),
      });
    });
    return "recorded";
  } catch {
    // Analytics must never break the storefront.
    return "ignored";
  }
}
