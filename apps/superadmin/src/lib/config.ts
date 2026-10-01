/**
 * Platform API URL resolution for the Super Admin SPA (PLAN §6).
 * - VITE_PLATFORM_API_URL wins when set (build-time).
 * - Local development: the API on port 4000 of the same host.
 * - Production: the SPA lives on superadmin.<domain> and the platform API on platform.<domain>.
 */
export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_PLATFORM_API_URL ?? import.meta.env.VITE_API_URL) as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://localhost:4000";
  const { protocol, hostname, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:4000`;
  }
  if (hostname.startsWith("superadmin.")) {
    return `${protocol}//platform.${hostname.slice("superadmin.".length)}`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

/** The store admin (for opening a store in a support session). */
export function storeAdminBase(): string {
  const fromEnv = import.meta.env.VITE_STORE_ADMIN_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://localhost:5173";
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return `${protocol}//${hostname}:5173`;
  if (hostname.startsWith("superadmin.")) return `${protocol}//admin.${hostname.slice("superadmin.".length)}`;
  return `${protocol}//admin.${hostname}`;
}
