/**
 * Pure rules for the link health check (docs/STOREFRONT-AUDIT-FIXES-PLAN.md phase 4): which links inside a store's own content point
 * at nothing. No database here; the service gathers what exists and these functions judge each link.
 */
import { legacyPathTarget } from "./legacy-targets.ts";

export type LinkProblemKind = "broken" | "platform_host" | "shopify_checkout" | "www_host";

export interface KnownTargets {
  products: ReadonlySet<string>;
  collections: ReadonlySet<string>;
  categories: ReadonlySet<string>;
  /** Canonical paths of the store's published pages ("/pages/about"). */
  pages: ReadonlySet<string>;
  blogPosts: ReadonlySet<string>;
  /** Lower-cased source paths of the store's redirects. */
  redirects: ReadonlySet<string>;
  /** The store's own connected hostnames (lower-case), to spot absolute links to itself. */
  ownHosts: ReadonlySet<string>;
}

export interface LinkProblem {
  kind: LinkProblemKind;
  link: string;
  /** A plain sentence the merchant can act on. */
  hint: string;
}

/** Fixed addresses every store serves. A trailing part after the prefix is checked separately where the prefix has pages. */
const STATIC_PATHS = new Set([
  "/", "/search", "/cart", "/checkout", "/track", "/contact", "/about", "/blog", "/products/all", "/collections", "/categories",
  "/account", "/account/login", "/account/register", "/account/orders", "/account/profile", "/account/addresses", "/privacy", "/terms",
]);
const PREFIX_OK = ["/account/", "/policies/", "/orders/", "/o/", "/api/", "/_next/", "/blog/category/", "/blog/page/", "/cod/", "/address/"];

const stripQueryAndHash = (p: string): string => p.replace(/[?#].*$/, "");
const lastSegment = (p: string, prefix: string): string => decodeURIComponent(p.slice(prefix.length)).toLowerCase();

/**
 * Judges one link found in a store's content. Returns null when it is fine or is not something this check can judge (mailto:, tel:,
 * #anchors, outside websites). `link` is the value as the merchant saved it.
 */
export function classifyLink(link: string, known: KnownTargets): LinkProblem | null {
  const value = link.trim();
  if (!value || value.startsWith("#") || /^(mailto:|tel:)/i.test(value)) return null;

  let path = value;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (/\.bcom\.si$/.test(host) && !/^(www|admin|superadmin|platform|media|api|app|status|docs)\./.test(host)) {
      return { kind: "platform_host", link: value, hint: "This points at the store's preview address. Use a path such as /products/your-product instead, so shoppers stay on your own domain." };
    }
    if (host.startsWith("www.") && !known.ownHosts.has(host) && known.ownHosts.has(host.slice(4))) {
      return { kind: "www_host", link: value, hint: `${host} is not connected to this store. Link to ${host.slice(4)} or connect the www address in Settings > Domains.` };
    }
    if (!known.ownHosts.has(host)) return null; // another website: not ours to judge
    path = `${url.pathname}${url.search}`;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return null;

  const clean = stripQueryAndHash(path);
  const normal = clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
  const lower = normal.toLowerCase();

  if (/^\/checkouts\//i.test(normal)) {
    return { kind: "shopify_checkout", link: value, hint: "This is an old checkout link from another platform and no longer works. Link to the product page instead." };
  }
  if (STATIC_PATHS.has(lower) || PREFIX_OK.some((p) => lower.startsWith(p))) return null;
  if (known.redirects.has(lower)) return null;

  const hit = (prefix: string, set: ReadonlySet<string>): boolean | null => (lower.startsWith(prefix) ? set.has(lastSegment(normal, prefix)) : null);
  const results = [hit("/products/", known.products), hit("/collections/", known.collections), hit("/categories/", known.categories), hit("/blog/", known.blogPosts)];
  const decided = results.find((r) => r !== null);
  if (decided === true) return null;
  if (lower.startsWith("/pages/") && known.pages.has(lower)) return null;
  // `/collections/all` and `/categories/all` are the lists of collections and categories (the storefront redirects them).
  if (lower === "/collections/all" || lower === "/categories/all") return null;

  const legacy = legacyPathTarget(normal);
  return {
    kind: "broken",
    link: value,
    hint: legacy ? `This address does not exist on the store. Did you mean ${legacy}?` : "Nothing on the store has this address, so shoppers will see \"page not found\". Fix the link or add a redirect in Settings > Redirects.",
  };
}
