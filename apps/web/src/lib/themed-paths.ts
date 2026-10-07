/**
 * Customer account, auth and token pages follow the visitor's light/dark/system choice.
 * Merchant storefront pages keep the store's own look, so they are NOT in this list
 * (an OS dark mode must not change a store's native form controls or scrollbars).
 */
export const THEMED_PATH_SOURCE = "^/(account|signup|unsubscribe|address|o/|orders/|cod/|privacy-request|privacy-verify)";

export function isThemedPath(pathname: string): boolean {
  return new RegExp(THEMED_PATH_SOURCE).test(pathname);
}
