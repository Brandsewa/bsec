/**
 * The public origin the shopper used (`https://store.example.com`), from the proxy headers.
 *
 * `req.url` is NOT safe for redirects: behind the reverse proxy the Next server sees its own bind address
 * (`0.0.0.0:3000`), so `new URL(path, req.url)` sent shoppers to `https://0.0.0.0:3000/...` after paying on Stripe.
 */
export function publicOrigin(h: Headers): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost").split(",")[0]?.trim() ?? "";
  const local = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("0.0.0.0") || host.startsWith("[::1]");
  const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0]?.trim() ?? "";
  return `${proto}://${host}`;
}

/** An absolute URL on the shopper-facing origin for a same-site path. */
export function publicUrl(h: Headers, path: string): URL {
  return new URL(path, publicOrigin(h));
}
