import { createStaffAuth, STAFF_COOKIE_PREFIX, type StaffAuth } from "@bs/auth";
import { server } from "./runtime.ts";
import type { ApiContext } from "./api.ts";

/**
 * Staff (admin) authentication wiring. Lazy on purpose: the site must keep serving when the auth
 * env vars are not set yet, and admin sign-in then answers 503 with a clear message instead of
 * crashing the process.
 *
 * Required in production: BETTER_AUTH_SECRET (32+ chars), BETTER_AUTH_URL (public API origin,
 * e.g. https://gobs.cloud). Optional: ADMIN_ORIGINS (comma list, default https://admin.<host>),
 * COOKIE_DOMAIN (default .<host> for https origins).
 */
export interface AuthSettings {
  baseURL: string;
  secret: string;
  adminOrigins: string[];
  cookieDomain: string | undefined;
}

const g = globalThis as unknown as { __bsStaffAuth?: { auth: StaffAuth; settings: AuthSettings } };

export function readAuthSettings(env: NodeJS.ProcessEnv = process.env): AuthSettings | null {
  const baseURL = env.BETTER_AUTH_URL?.trim();
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!baseURL || !secret || secret.length < 32) return null;

  const url = new URL(baseURL);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const derivedAdmin = isLocal ? "http://localhost:5173" : `${url.protocol}//admin.${url.hostname}`;
  const adminOrigins = (env.ADMIN_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [derivedAdmin]).map(
    (o) => new URL(o).origin,
  );
  const cookieDomain =
    env.COOKIE_DOMAIN?.trim() || (isLocal || url.protocol !== "https:" ? undefined : `.${url.hostname}`);
  return { baseURL: url.origin, secret, adminOrigins, cookieDomain };
}

export function authConfigured(): boolean {
  return readAuthSettings() !== null;
}

export function getStaffAuth(): { auth: StaffAuth; settings: AuthSettings } | null {
  if (g.__bsStaffAuth) return g.__bsStaffAuth;
  const settings = readAuthSettings();
  if (!settings) return null;
  const auth = createStaffAuth(server().rt._db.db, {
    baseURL: settings.baseURL,
    secret: settings.secret,
    trustedOrigins: [settings.baseURL, ...settings.adminOrigins],
    ...(settings.cookieDomain ? { cookieDomain: settings.cookieDomain } : {}),
  });
  g.__bsStaffAuth = { auth, settings };
  return g.__bsStaffAuth;
}

/** Origins allowed to make credentialed cross-origin calls to the API (the admin SPA). */
export function allowedApiOrigins(): string[] {
  const settings = readAuthSettings();
  return settings ? [settings.baseURL, ...settings.adminOrigins] : [];
}

function hasStaffCookie(headers: Headers): boolean {
  return (headers.get("cookie") ?? "").includes(STAFF_COOKIE_PREFIX);
}

/** Resolves the staff session from cookies. Returns null when there is none or auth is unconfigured. */
export async function resolveStaffSession(headers: Headers): Promise<ApiContext["session"]> {
  if (!hasStaffCookie(headers)) return null;
  const cfg = getStaffAuth();
  if (!cfg) return null;
  const result = await cfg.auth.api.getSession({ headers });
  if (!result) return null;
  return {
    user: { id: result.user.id, email: result.user.email },
    session: { ...result.session, id: result.session.id, userId: result.session.userId },
    type: "staff",
  };
}
