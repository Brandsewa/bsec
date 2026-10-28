import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { pickMarket, type StorefrontMarket } from "@bs/domain";
import { defaultLocaleForCurrency } from "@bs/contracts/money";
import { getCachedStorefrontMarkets } from "./cached-storefront.ts";
import { MARKET_COOKIE, MARKET_PREFIX_HEADER } from "../lib/market-constants.ts";

export interface MarketContext {
  /** Every market a shopper can pick (base + active). Empty for a store that has no markets yet. */
  markets: StorefrontMarket[];
  /** The market this request is priced in; null for a store without markets. */
  market: StorefrontMarket | null;
  /** A better-fitting market for the visitor's country, offered as a banner and never applied silently. */
  suggestion: StorefrontMarket | null;
  /** Passed to cached loaders and the cart. null = the base market / no markets (nothing to scope). */
  marketId: string | null;
  currency: string;
  locale: string;
  /** "/us" for a prefixed market, "" otherwise: prepend to internal storefront links. */
  prefix: string;
}

/** Visitor country from Cloudflare, trusted only when the request really came through Cloudflare (cf-ray is present). */
function visitorCountry(h: Headers): string | null {
  const c = h.get("cf-ipcountry");
  return c && h.get("cf-ray") && /^[A-Za-z]{2}$/.test(c) && c.toUpperCase() !== "XX" ? c.toUpperCase() : null;
}

/** Which market this request is in (plan section 5): URL prefix, then the shopper's saved choice, then the base market. */
export const getMarketContext = cache(async (tenantId: string, fallbackCurrency = "INR"): Promise<MarketContext> => {
  const markets = await getCachedStorefrontMarkets(tenantId).catch(() => [] as StorefrontMarket[]);
  const h = await headers();
  const jar = await cookies();
  const picked = pickMarket(markets, {
    pathPrefix: h.get(MARKET_PREFIX_HEADER),
    cookieHandle: jar.get(MARKET_COOKIE)?.value ?? null,
    country: visitorCountry(h),
  });
  if (!picked) {
    return { markets, market: null, suggestion: null, marketId: null, currency: fallbackCurrency, locale: defaultLocaleForCurrency(fallbackCurrency), prefix: "" };
  }
  const m = picked.market;
  return {
    markets,
    market: m,
    suggestion: picked.suggestion,
    // A store with a single market has nothing to scope: reads stay exactly as before markets existed.
    marketId: markets.length > 1 ? m.id : null,
    currency: m.currency,
    locale: m.locale ?? defaultLocaleForCurrency(m.currency),
    prefix: m.pathPrefix ?? "",
  };
});
