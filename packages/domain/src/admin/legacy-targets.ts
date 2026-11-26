/**
 * Where an address that other platforms used lives here, for the "did you mean" hint of the link check. The storefront has its own
 * copy of the same rules for redirecting (`apps/web/src/lib/legacy-paths.ts`); this one only suggests.
 */
export function legacyPathTarget(path: string): string | null {
  const article = /^\/blogs\/[^/]+\/([^/]+)$/.exec(path);
  if (article?.[1]) return `/blog/${article[1]}`;
  if (/^\/blogs(\/[^/]+)?$/.test(path)) return "/blog";
  if (path === "/products") return "/products/all";
  return null;
}
