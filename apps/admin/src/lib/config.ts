/**
 * Where the API lives. The admin is a static SPA on admin.<root>; the API is served by the web app on
 * <root>. Derived from the page host so the root domain can change without a rebuild; VITE_API_URL
 * overrides it (local dev, unusual setups).
 */
export function apiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://localhost:3000";
  const { protocol, hostname, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return `${protocol}//${hostname}:3000`;
  return `${protocol}//${hostname.replace(/^admin\./, "")}${port ? `:${port}` : ""}`;
}
