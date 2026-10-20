/**
 * Only the platform's own sign-up page follows the visitor's light/dark/system choice.
 * Every store page, including the customer account, sign-in and order pages, stays light: stores have no dark theme
 * yet, so a visitor's OS dark mode (or an old saved choice) must not turn a customer's sign-in dark
 * (owner decision 2026-10-20). Widen this list when stores get a dark theme.
 */
export const THEMED_PATH_SOURCE = "^/signup";

export function isThemedPath(pathname: string): boolean {
  return new RegExp(THEMED_PATH_SOURCE).test(pathname);
}
