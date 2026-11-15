/**
 * hreflang for stores that sell in more than one market (ADR-040, docs/SEO-GEO-AEO-PLAN.md Phase 2). Each market has its own URL
 * prefix and currency; hreflang tells search engines which URL is meant for which audience so they show the right one and do not
 * treat them as duplicates. Only emitted when every market has a distinct, valid language-region code: a wrong or repeated code is
 * worse than none.
 */
import { defaultLocaleForCurrency } from "@bs/contracts/money";
import type { StorefrontMarket } from "../markets/lookup.ts";

export interface HreflangAlternate {
  hreflang: string;
  href: string;
}

const HREFLANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** marketId to hreflang code, or null when there are fewer than two markets or the codes are invalid or not unique. */
export function marketHreflangs(markets: StorefrontMarket[]): Map<string, string> | null {
  if (markets.length < 2) return null;
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const m of markets) {
    const code = (m.locale ?? defaultLocaleForCurrency(m.currency)).replace(/_/g, "-").trim();
    if (!HREFLANG.test(code) || seen.has(code.toLowerCase())) return null;
    seen.add(code.toLowerCase());
    out.set(m.id, code);
  }
  return out;
}

/**
 * The alternates for one page: every market that serves it (listed by `entries`), plus x-default pointing at the base market's URL.
 * A page served by only one market has no alternates.
 */
export function buildHreflangAlternates(
  entries: Array<{ marketId: string; isBase: boolean; href: string }>,
  hreflangs: Map<string, string>,
): HreflangAlternate[] {
  const alts: HreflangAlternate[] = [];
  for (const e of entries) {
    const code = hreflangs.get(e.marketId);
    if (code) alts.push({ hreflang: code, href: e.href });
  }
  if (alts.length < 2) return [];
  const base = entries.find((e) => e.isBase);
  if (base) alts.push({ hreflang: "x-default", href: base.href });
  return alts;
}

/** `<link rel="alternate" hreflang>` map for the home page of a multi-market store (every market serves its home), or undefined. */
export function homeLanguageAlternates(markets: StorefrontMarket[], host: string): Record<string, string> | undefined {
  const codes = marketHreflangs(markets);
  if (!codes) return undefined;
  const base = `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const out: Record<string, string> = {};
  for (const m of markets) {
    const code = codes.get(m.id);
    if (!code) continue;
    const prefix = m.isBase ? "" : m.pathPrefix ? (m.pathPrefix.startsWith("/") ? m.pathPrefix : `/${m.pathPrefix}`) : null;
    if (prefix === null) return undefined; // a non-base market without a prefix shares the base URL: no safe alternate
    out[code] = `${base}${prefix}` || base;
  }
  const baseMarket = markets.find((m) => m.isBase);
  if (baseMarket) out["x-default"] = base;
  return out;
}
