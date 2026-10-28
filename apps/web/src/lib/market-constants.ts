/** The shopper's saved market (a strictly necessary cookie: it remembers the country/currency they chose). */
export const MARKET_COOKIE = "bs_market";
/** Set by middleware when the URL starts with a market prefix such as /us; the prefix is stripped before routing. */
export const MARKET_PREFIX_HEADER = "x-bs-market-prefix";
/** The request path without any market prefix, set by middleware for hreflang links and the market switcher. */
export const PATH_HEADER = "x-bs-path";
