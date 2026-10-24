import { and, eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { verifyGoogleIdToken } from "better-auth/social-providers";
import { schema, type Db } from "@bs/db";

/**
 * Google sign-in for the platform's own users (docs/GOOGLE-SIGNIN-PLAN.md, Tier A): Super Admin, platform staff and
 * store owners/staff. Never used for a store's customers.
 */
export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Loads the platform Google client from the database. Null means Google sign-in is off. */
export type GoogleConfigLoader = () => Promise<GoogleAuthConfig | null>;

/**
 * Better Auth resolves a function-valued provider when its context is built, so apps rebuild the auth instance when
 * this fingerprint changes (see getStaffAuth / getPlatformAuth).
 */
export function googleConfigFingerprint(cfg: GoogleAuthConfig | null): string {
  return cfg ? `${cfg.clientId}:${cfg.clientSecret.length}:${cfg.clientSecret.slice(-4)}` : "off";
}

/**
 * socialProviders.google for Better Auth. Implicit sign-up is always off: a sign-in only works for an account that
 * already exists. Store-owner sign-up runs through our own signup flow, never through an open social endpoint.
 */
export function googleSocialProvider(load: GoogleConfigLoader) {
  return async () => {
    const cfg = await load();
    // `enabled: false` makes Better Auth drop the provider, so sign-in answers "provider not found".
    if (!cfg) return { clientId: "", clientSecret: "", enabled: false };
    return {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      disableImplicitSignUp: true,
      prompt: "select_account" as const,
    };
  };
}

function isGoogleSignInPath(path: string | undefined): boolean {
  return Boolean(path && (path.startsWith("/callback/google") || path.startsWith("/callback/:id") || path.startsWith("/one-tap")));
}

/**
 * Guards session creation for sign-ins that came through Google. Better Auth's two-factor hook only covers the
 * email, username and phone sign-ins, so a Google sign-in would skip the second factor; here it is refused instead.
 *  - requirePlatformStaff: the user must be an active platform_staff member (Super Admin).
 *  - A user with two-factor enabled can never use Google; they keep password + authenticator.
 */
export function googleSessionGuard(db: Db, opts: { requirePlatformStaff: boolean }) {
  return async (session: { userId: string }, ctx: { path?: string } | null): Promise<void> => {
    if (!isGoogleSignInPath(ctx?.path)) return;
    const [user] = await db
      .select({ twoFactorEnabled: schema.users.twoFactorEnabled })
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);
    if (!user) throw new APIError("FORBIDDEN", { message: "Sign-in with Google is not available for this account." });
    if (user.twoFactorEnabled) {
      throw new APIError("FORBIDDEN", {
        message: "This account uses a second factor. Sign in with your email, password and authenticator code.",
      });
    }
    if (opts.requirePlatformStaff) {
      const [staff] = await db
        .select({ isActive: schema.platformStaff.isActive })
        .from(schema.platformStaff)
        .where(eq(schema.platformStaff.userId, session.userId))
        .limit(1);
      if (!staff?.isActive) {
        throw new APIError("FORBIDDEN", { message: "Sign-in with Google is not available for this account." });
      }
    }
  };
}

/**
 * Runs just before a Google account is linked to an existing user during a Google sign-in.
 *
 * Google confirmed the mailbox, so a user whose own email was never verified (every owner who signed up with email and
 * password) can be linked automatically. The classic takeover is someone pre-registering a victim's address with a
 * password they chose and waiting for the victim to sign in with Google. So at link time, if the local email was NOT
 * verified, the password login and every existing session for that user are removed and the email is marked verified.
 * The real owner can set a new password with "Forgot password". A user whose email was already verified is untouched.
 */
export function googleAccountLinkGuard(db: Db) {
  return async (account: { userId: string; providerId: string }, ctx: { path?: string } | null): Promise<void> => {
    if (account.providerId !== "google" || !isGoogleSignInPath(ctx?.path)) return;
    await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ emailVerified: schema.users.emailVerified })
        .from(schema.users)
        .where(eq(schema.users.id, account.userId))
        .limit(1);
      if (!user || user.emailVerified) return;
      await tx.delete(schema.accounts).where(and(eq(schema.accounts.userId, account.userId), eq(schema.accounts.providerId, "credential")));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, account.userId));
      await tx.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, account.userId));
    });
  };
}

export interface GoogleIdentityClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  nonce?: string | undefined;
}

/**
 * Verifies a Google ID token (signature, issuer, audience, expiry) with Better Auth's verifier and returns the
 * claims we use. Used by the store-owner signup flow.
 */
export async function verifyGoogleIdentity(idToken: string, clientId: string): Promise<GoogleIdentityClaims | null> {
  const payload = await verifyGoogleIdToken({ token: idToken, audience: clientId });
  if (!payload || typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true || (payload.email_verified as unknown) === "true",
    name: typeof payload.name === "string" ? payload.name : "",
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
  };
}
