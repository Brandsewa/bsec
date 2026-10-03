/**
 * Direct product statuses: reachable by direct link (/products/[slug]) and can be bought (added to cart).
 * Includes "unlisted" which is hidden from all lists, search, collections, and sitemaps.
 */
export const DIRECT_PRODUCT_STATUSES = ["active", "published", "unlisted"] as const;

/**
 * Listed product statuses: visible in product listings, category pages, collection pages, search,
 * related products, and sitemaps.
 */
export const LISTED_PRODUCT_STATUSES = ["active", "published"] as const;

/**
 * Product statuses a shopper can see in listings.
 * @deprecated Use DIRECT_PRODUCT_STATUSES for direct product page & cart, or LISTED_PRODUCT_STATUSES for listings/search/sitemap.
 */
export const STOREFRONT_PRODUCT_STATUSES = LISTED_PRODUCT_STATUSES;

