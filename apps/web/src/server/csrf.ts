/**
 * CSRF defence in depth for the staff API: a state-changing request that carries the staff cookie must come from an
 * allowed origin.
 *
 * The public storefront API (`/api/storefront/...`) is exempt. Those routes never act with staff authority, and the
 * staff cookie is scoped to the parent domain, so a store owner browsing their own shop while signed in to the admin
 * sends it to the storefront too. Guarding those routes refused every public form (quote requests, ...) for exactly
 * the person testing their own store, with "Origin not allowed".
 */
export function isForbiddenStaffOrigin(input: {
  method: string;
  path: string;
  cookie: string | undefined;
  origin: string | undefined;
  allowedOrigins: readonly string[];
}): boolean {
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (input.path.startsWith("/api/storefront/")) return false;
  if (!(input.cookie ?? "").includes("bs-staff")) return false;
  return Boolean(input.origin) && !input.allowedOrigins.includes(input.origin as string);
}
