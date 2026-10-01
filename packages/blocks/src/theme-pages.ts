/**
 * Theme pages that are not reachable at /pages/<slug>: the store header and footer, plus the
 * templates every product and collection page is drawn with. A theme defines them under these
 * keys; activating the theme copies them into the store's own `pages` rows (so the store edits
 * its copy), and the storefront falls back to the built-in layout when a store has none.
 */
export const THEME_SYSTEM_PAGES = {
  collection: { type: "collection_template", slug: "template-collection", title: "Collection page" },
  product: { type: "product_template", slug: "template-product", title: "Product page" },
  header: { type: "header", slug: "template-header", title: "Header" },
  footer: { type: "footer", slug: "template-footer", title: "Footer" },
} as const;

export type ThemeSystemPageKey = keyof typeof THEME_SYSTEM_PAGES;

export const THEME_SYSTEM_PAGE_KEYS = Object.keys(THEME_SYSTEM_PAGES) as ThemeSystemPageKey[];
export const THEME_SYSTEM_PAGE_TYPES: readonly string[] = THEME_SYSTEM_PAGE_KEYS.map((k) => THEME_SYSTEM_PAGES[k].type);
/** Same list as a Set, for filtering page lists. */
export const THEME_PAGE_TYPES: ReadonlySet<string> = new Set(THEME_SYSTEM_PAGE_TYPES);

export function isThemeSystemPageKey(key: string): key is ThemeSystemPageKey {
  return Object.prototype.hasOwnProperty.call(THEME_SYSTEM_PAGES, key);
}

/** Display names for the theme's pages, in the order editors list them. */
export const THEME_PAGE_LABELS: Record<"home" | ThemeSystemPageKey, string> = {
  home: "Home page",
  collection: "Collection page",
  product: "Product page",
  header: "Header",
  footer: "Footer",
};
