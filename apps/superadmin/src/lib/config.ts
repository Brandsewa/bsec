/**
 * Platform API URL resolution for Super Admin SPA (PLAN §6).
 * Defaults to port 4000 in local development, or relative /api in production.
 */
export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_PLATFORM_API_URL ?? import.meta.env.VITE_API_URL) as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://localhost:4000";
  const { protocol, hostname, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:4000`;
  }
  // In production / staging, calls go to platform API origin or current host
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}
