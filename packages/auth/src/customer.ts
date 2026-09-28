import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type Db } from "@bs/db";
import { CUSTOMER_COOKIE } from "./index.ts";

export interface CustomerAuthOptions {
  baseURL?: string;
  secret?: string;
  advanced?: BetterAuthOptions["advanced"];
}

/**
 * Customer Better Auth instance (PLAN §4, §5.6).
 * Backs per-store customer sessions model.
 * Session cookie: `__Host-cust` (CUSTOMER_COOKIE).
 * We set `useSecureCookies: false` because `__Host-` is already a browser-enforced
 * secure cookie prefix and Better Auth would otherwise prepend `__Secure-`.
 */
export function createCustomerAuth(db: Db, opts: CustomerAuthOptions = {}) {
  return betterAuth({
    baseURL: opts.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.customerSessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
      usePlural: true,
    }),
    session: {
      additionalFields: {
        tenantId: {
          type: "string",
          required: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      useSecureCookies: false,
      cookies: {
        session_token: {
          name: CUSTOMER_COOKIE,
          attributes: {
            secure: true,
            sameSite: "lax",
            path: "/",
            httpOnly: true,
          },
        },
      },
      ...opts.advanced,
    },
  });
}

export type CustomerAuth = ReturnType<typeof createCustomerAuth>;
