import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type Db } from "@bs/db";
import { STAFF_COOKIE_PREFIX } from "./index.ts";

export interface StaffAuthOptions {
  baseURL?: string;
  secret?: string;
  /** Origins allowed to call the auth endpoints (the admin SPA). */
  trustedOrigins?: string[];
  /** Cookie domain shared between API and admin hosts, e.g. ".example.com". Omit on localhost. */
  cookieDomain?: string;
  /** Force the Secure cookie flag. Defaults to true when baseURL is https. */
  secureCookies?: boolean;
  /** URL of the Admin SPA, e.g. "https://admin.bcom.si" or "http://localhost:5173" */
  adminUrl?: string;
  /** Callback to send password reset email */
  onSendResetPassword?: (data: { user: { id: string; email: string; name?: string }; url: string; token: string }) => Promise<void> | void;
  /** Callback invoked after password reset completes */
  onPasswordReset?: (data: { user: { id: string; email: string; name?: string } }) => Promise<void> | void;
  advanced?: BetterAuthOptions["advanced"];
}

/**
 * Staff Better Auth instance (PLAN §4, §5.3).
 * Backs global users + memberships model. Cookie prefix: `bs-staff` (STAFF_COOKIE_PREFIX).
 * Public sign-up is disabled: staff accounts are created by the create-owner operator script
 * or by accepting a staff invitation, never through an open endpoint.
 */
export function createStaffAuth(db: Db, opts: StaffAuthOptions = {}) {
  const baseURL = opts.baseURL ?? process.env.BETTER_AUTH_URL;
  const secure = opts.secureCookies ?? Boolean(baseURL?.startsWith("https://"));
  return betterAuth({
    ...(baseURL ? { baseURL } : {}),
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    ...(opts.trustedOrigins ? { trustedOrigins: opts.trustedOrigins } : {}),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        twoFactors: schema.twoFactors,
      },
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600, // 1 hour (PLAN §4.1)
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        let adminUrl = opts.adminUrl;
        if (!adminUrl) {
          if (baseURL) {
            try {
              const u = new URL(baseURL);
              const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
              adminUrl = isLocal ? "http://localhost:5173" : `${u.protocol}//admin.${u.hostname}`;
            } catch {
              adminUrl = "https://admin.bcom.si";
            }
          } else {
            adminUrl = "https://admin.bcom.si";
          }
        }
        const resetUrl = `${adminUrl}/reset-password?token=${token}`;
        if (opts.onSendResetPassword) {
          await opts.onSendResetPassword({ user, url: resetUrl, token });
        }
      },
      onPasswordReset: async ({ user }) => {
        if (opts.onPasswordReset) {
          await opts.onPasswordReset({ user });
        }
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Our own Postgres-backed limiter (checkAdminLoginLimit) guards sign-in; Better Auth's in-memory
    // limiter would not be shared across containers.
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: STAFF_COOKIE_PREFIX,
      useSecureCookies: secure,
      ...(opts.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain } }
        : {}),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
      ...opts.advanced,
    },
  });
}

export type StaffAuth = ReturnType<typeof createStaffAuth>;
