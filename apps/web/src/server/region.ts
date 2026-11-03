import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { normalizeIndianState, type InStateCode } from "@bs/domain";
import { getCachedStatePricingScope } from "./cached-storefront.ts";
import { lookupIndianStateByIp } from "./geoip.ts";
import { STATE_COOKIE } from "../lib/market-constants.ts";

export interface RegionContext {
  /** The State Pricing app is active for this store. */
  active: boolean;
  mode: "auto" | "manual";
  /** The state this request is priced for, or null for default prices. */
  region: InStateCode | null;
  /** Manual mode and the shopper has not entered a pincode yet: the popup asks for it. */
  needsPincode: boolean;
}

const INACTIVE: RegionContext = { active: false, mode: "auto", region: null, needsPincode: false };

/** Crawlers always see default prices so search results and structured data match what any visitor can verify (ADR-044). */
const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|headlesschrome|lighthouse|pagespeed|gtmetrix/i;

function clientIp(h: Headers): string | null {
  const viaCloudflare = !!h.get("cf-ray");
  const raw = (viaCloudflare ? h.get("cf-connecting-ip") : null) ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip");
  const ip = raw?.trim();
  return ip ? ip : null;
}

/**
 * Detects the state: Cloudflare's region header when the request really came through Cloudflare from India, then the
 * MaxMind database as the fallback. Detection only ever picks a display and cart price; it carries no authority beyond that.
 */
async function detectState(h: Headers): Promise<InStateCode | null> {
  if (h.get("cf-ray") && h.get("cf-ipcountry")?.toUpperCase() === "IN") {
    const fromCloudflare = normalizeIndianState(h.get("cf-region-code"));
    if (fromCloudflare) return fromCloudflare;
  }
  const ip = clientIp(h);
  return ip ? lookupIndianStateByIp(ip) : null;
}

/** Which state this request is priced for (ADR-044). Inert (no cost beyond one cached read) for stores without the app. */
export const getRegionContext = cache(async (tenantId: string): Promise<RegionContext> => {
  const scope = await getCachedStatePricingScope(tenantId).catch(() => null);
  if (!scope?.active) return INACTIVE;
  const h = await headers();
  if (BOT_UA.test(h.get("user-agent") ?? "")) return { active: true, mode: scope.mode, region: null, needsPincode: false };
  if (scope.mode === "manual") {
    const jar = await cookies();
    const chosen = normalizeIndianState(jar.get(STATE_COOKIE)?.value);
    return { active: true, mode: "manual", region: chosen, needsPincode: chosen === null };
  }
  return { active: true, mode: "auto", region: await detectState(h), needsPincode: false };
});
