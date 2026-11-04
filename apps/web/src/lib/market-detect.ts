/**
 * Which market a visitor should be in when the URL does not say (ADR-040). Pure, so the rules are tested without a request.
 *
 * One rule for the URL: a market's prefix (/global) always shows that market, and an address with no prefix is the base market.
 * A shopper who has a market of their own saved is sent to its prefixed address, so a reload or a link without the prefix never
 * shows another currency. A first-time visitor is placed by country, once, and the choice is saved; a country no market covers
 * goes to the base market. Crawlers are never moved, so search results match what any visitor can verify.
 */
export interface MarketEntry {
  prefix: string;
  handle: string;
  isBase: boolean;
  countries: string[];
}

export const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|headlesschrome|lighthouse|pagespeed|gtmetrix/i;

export interface MarketDecision {
  /** Send the browser to this prefix plus the same path (null: stay where it is). */
  redirectPrefix: string | null;
  /** Remember this market for the visitor (null: leave the cookie alone). */
  setCookie: string | null;
}

const NONE: MarketDecision = { redirectPrefix: null, setCookie: null };

export function decideMarket(input: {
  markets: readonly MarketEntry[];
  /** The URL already carried a market prefix. */
  prefixMatched: boolean;
  cookieHandle: string | null;
  country: string | null;
  isBot: boolean;
  /** A page request from a browser (not an API call, a file, or a client-side fetch). */
  isDocument: boolean;
}): MarketDecision {
  if (input.markets.length < 2 || input.prefixMatched || input.isBot || !input.isDocument) return NONE;
  const base = input.markets.find((m) => m.isBase);
  if (!base) return NONE;

  const saved = input.cookieHandle ? input.markets.find((m) => m.handle === input.cookieHandle) : undefined;
  if (saved) return !saved.isBase && saved.prefix ? { redirectPrefix: saved.prefix, setCookie: null } : NONE;

  const country = input.country?.toUpperCase() ?? null;
  const target = (country ? input.markets.find((m) => m.countries.includes(country)) : undefined) ?? base;
  return { redirectPrefix: !target.isBase && target.prefix ? target.prefix : null, setCookie: target.handle };
}
