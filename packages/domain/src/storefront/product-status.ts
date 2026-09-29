/**
 * Product statuses a shopper can see and buy. The admin API saves a live product as "active"
 * (draft | active | archived); "published" is the value older data and fixtures used, so it stays accepted.
 */
export const STOREFRONT_PRODUCT_STATUSES = ["active", "published"] as const;
