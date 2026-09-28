import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type Db } from "@bs/db";
import { STAFF_COOKIE_PREFIX } from "./index.ts";

export interface StaffAuthOptions {
  baseURL?: string;
  secret?: string;
  advanced?: BetterAuthOptions["advanced"];
}

/**
 * Staff Better Auth instance (PLAN §4, §5.3).
 * Backs global users + memberships model.
 * Cookie prefix: `bs-staff` (STAFF_COOKIE_PREFIX).
 */
export function createStaffAuth(db: Db, opts: StaffAuthOptions = {}) {
  return betterAuth({
    baseURL: opts.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET,
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
    },
    advanced: {
      cookiePrefix: STAFF_COOKIE_PREFIX,
      ...opts.advanced,
    },
  });
}

export type StaffAuth = ReturnType<typeof createStaffAuth>;
