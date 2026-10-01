import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { schema, type Db } from "@bs/db";
import { PLATFORM_COOKIE_PREFIX } from "./index.ts";

export interface PlatformAuthOptions {
  baseURL?: string | undefined;
  secret?: string | undefined;
  trustedOrigins?: string[] | undefined;
  cookieDomain?: string | undefined;
  secureCookies?: boolean | undefined;
  superadminUrl?: string | undefined;
  onSendResetPassword?: ((data: { user: { id: string; email: string; name?: string }; url: string; token: string }) => Promise<void> | void) | undefined;
  onPasswordReset?: ((data: { user: { id: string; email: string; name?: string } }) => Promise<void> | void) | undefined;
  advanced?: BetterAuthOptions["advanced"] | undefined;
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
      resetPasswordTokenExpiresIn: 3600, // 1 hour (PLAN §4.1)
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        let superadminUrl = opts.superadminUrl;
        if (!superadminUrl) {
          if (baseURL) {
            try {
              const u = new URL(baseURL);
              const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
              superadminUrl = isLocal ? "http://localhost:5174" : "https://superadmin.gobs.cloud";
            } catch {
              superadminUrl = "https://superadmin.gobs.cloud";
            }
          } else {
            superadminUrl = "https://superadmin.gobs.cloud";
          }
        }
        const resetUrl = `${superadminUrl}/reset-password?token=${token}`;
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
    // Brute-force protection for the highest-value login in the system: 5 attempts per 5 minutes per IP for the password
    // and for every second-factor endpoint. (In-memory: the platform runs as a single instance.)
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 300, max: 5 },
        "/request-password-reset": { window: 900, max: 3 },
        "/reset-password": { window: 900, max: 5 },
        "/two-factor/enable": { window: 300, max: 5 },
        "/two-factor/verify-totp": { window: 300, max: 5 },
        "/two-factor/verify-backup-code": { window: 300, max: 5 },
      },
    },
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
