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
      },
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
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
