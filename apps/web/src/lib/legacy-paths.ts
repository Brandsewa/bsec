/**
 * Addresses that other platforms (mostly Shopify) and our own old breadcrumbs used, mapped to where the page lives here.
 * Returns the new path (without a market prefix) or null when the path is not a legacy one. Kept pure so middleware can use it
 * before any page renders and it can be tested without a server.
 */
export function legacyStorefrontPath(path: string): string | null {
  const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  // `/products` has no page of its own: the all-products listing is what a shopper or a search engine means by it.
  if (clean === "/products") return "/products/all";
  // Shopify's "all" pages: `/collections/all` is the list of collections here, and `/categories/all` the list of categories.
  if (clean === "/collections/all") return "/collections";
  if (clean === "/categories/all") return "/categories";
  // Shopify: /blogs/<blog handle>/<article handle> is /blog/<article handle>; /blogs/<blog handle> is the blog home.
  const article = /^\/blogs\/[^/]+\/([^/]+)$/.exec(clean);
  if (article?.[1]) return `/blog/${article[1]}`;
  if (/^\/blogs\/[^/]+$/.test(clean) || clean === "/blogs") return "/blog";
  return null;
}
