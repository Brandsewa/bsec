/** State Pricing app, manual mode: the Indian state the shopper entered a pincode for (ADR-044). Strictly necessary: it remembers their price. */
export const STATE_COOKIE = "bs_state";
/** Manual mode: the shopper chose to continue with standard prices; remembered for the browser session. */
export const STATE_SKIP_COOKIE = "bs_state_skip";
/** One-shot message after a failed pincode form post (60 seconds). */
export const PIN_ERROR_COOKIE = "bs_pin_error";
/** The shopper's saved market (a strictly necessary cookie: it remembers the country/currency they chose). */
export const MARKET_COOKIE = "bs_market";
/** Set by middleware when the URL starts with a market prefix such as /us; the prefix is stripped before routing. */
export const MARKET_PREFIX_HEADER = "x-bs-market-prefix";
/** The request path without any market prefix, set by middleware for hreflang links and the market switcher. */
export const PATH_HEADER = "x-bs-path";
