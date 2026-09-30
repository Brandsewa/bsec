import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { schema, type Db } from "@bs/db";
import { PLATFORM_COOKIE_PREFIX } from "./index.ts";

export interface PlatformAuthOptions {
  baseURL?: string;
  secret?: string;
  trustedOrigins?: string[];
  cookieDomain?: string;
  secureCookies?: boolean;
  advanced?: BetterAuthOptions["advanced"];
}

/**
 * Platform (Super Admin) Better Auth instance (PLAN §4, §6).
 * Backs platform_staff users with two-factor authentication (TOTP + backup codes).
 * Cookie prefix: `bs-platform` (PLATFORM_COOKIE_PREFIX).
 * Public sign-up is disabled; platform accounts are provisioned via operator CLI
 * or invited by a platform owner.
 */
export function createPlatformAuth(db: Db, opts: PlatformAuthOptions = {}) {
  const baseURL = opts.baseURL ?? process.env.PLATFORM_AUTH_URL ?? process.env.BETTER_AUTH_URL;
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
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: false },
    plugins: [
      twoFactor({
        issuer: "BsCommerce Platform",
      }),
    ],
    advanced: {
      cookiePrefix: PLATFORM_COOKIE_PREFIX,
      useSecureCookies: secure,
      ...(opts.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain } }
        : {}),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
      ...opts.advanced,
    },
  });
}

export type PlatformAuth = ReturnType<typeof createPlatformAuth>;
