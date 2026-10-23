import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { customers, schema, withTenant, type Db } from "@bs/db";
import { verifyGoogleIdentity } from "@bs/auth";
import { createCustomerSession, destroyAllCustomerSessions } from "../session.ts";
import type { CustomerRecord } from "../otp.ts";
import type { CustomerAuthResult } from "../auth.ts";
import { checkCustomerSocialLoginRateLimit } from "../../system/rate-limit.ts";
import type { GoogleIdentityVerifier } from "../../saas/google-signup.ts";

/**
 * Google sign-in for a store's customers (docs/GOOGLE-SIGNIN-PLAN.md, Tier B).
 * Every store uses its OWN Google app (its public Client ID), only on its own verified custom domain. The platform
 * Google client is never involved here, so the platform never sits between a shopper and Google.
 */

export const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

const SIGNIN_NONCE_TTL_MS = 5 * 60_000;
const SETUP_TICKET_TTL_MS = 10 * 60_000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hostnames of the store's custom domains that are live (status active). The platform subdomain never counts. */
export async function listVerifiedCustomHostnames(db: Db, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(and(eq(schema.domains.tenantId, tenantId), eq(schema.domains.type, "custom"), eq(schema.domains.status, "active")))
    .orderBy(asc(schema.domains.createdAt));
  return rows.map((r) => r.hostname.toLowerCase());
}

async function platformAllowsCustomerGoogle(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ allowed: schema.platformAuthProviders.customerSigninAllowed })
    .from(schema.platformAuthProviders)
    .where(eq(schema.platformAuthProviders.provider, "google"))
    .limit(1);
  return Boolean(row?.allowed);
}

type SocialRow = typeof schema.storeSocialAuth.$inferSelect;

export async function readStoreSocialAuth(db: Db, tenantId: string): Promise<SocialRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(schema.storeSocialAuth)
      .where(and(eq(schema.storeSocialAuth.tenantId, tenantId), eq(schema.storeSocialAuth.provider, "google")))
      .limit(1),
  );
  return row ?? null;
}

/**
 * True only when the stored Client ID passed a real test sign-in on a custom domain that is still live. Changing the
 * Client ID, or losing that domain, makes the earlier test void.
 */
export function isSetupVerified(row: SocialRow | null, liveHosts: string[]): boolean {
  return Boolean(
    row?.verifiedAt &&
      row.clientId &&
      row.verifiedClientId === row.clientId &&
      row.verifiedHost &&
      liveHosts.includes(row.verifiedHost.toLowerCase()),
  );
}

export interface StorefrontGoogleConfig {
  enabled: boolean;
  clientId?: string;
  nonce?: string;
  oneTap?: boolean;
}

/**
 * What the customer sign-in page may know. Enabled only when Super Admin allows it, the store switched it on, the
 * setup was verified, and the request came in on one of the store's live custom domains (never the platform subdomain).
 */
export async function getStorefrontGoogleConfig(
  db: Db,
  secret: string,
  tenantId: string,
  host: string,
  now: number = Date.now(),
): Promise<StorefrontGoogleConfig> {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (!(await platformAllowsCustomerGoogle(db))) return { enabled: false };
  const row = await readStoreSocialAuth(db, tenantId);
  if (!row?.enabled || !row.clientId) return { enabled: false };
  const live = await listVerifiedCustomHostnames(db, tenantId);
  if (!live.includes(hostname) || !isSetupVerified(row, live)) return { enabled: false };
  return { enabled: true, clientId: row.clientId, nonce: issueSigninNonce(secret, tenantId, hostname, now), oneTap: row.oneTapEnabled };
}

/** Stateless nonce bound to this store and host; single use is enforced when it is consumed at sign-in. */
export function issueSigninNonce(secret: string, tenantId: string, hostname: string, now: number = Date.now()): string {
  const body = `${now}.${randomBytes(16).toString("base64url")}`;
  return `${body}.${sign(secret, `gnonce:${tenantId}:${hostname}:${body}`)}`;
}

function signinNonceValid(secret: string, tenantId: string, hostname: string, nonce: string, now: number): boolean {
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const [ts, rand, mac] = parts as [string, string, string];
  const issued = Number(ts);
  if (!Number.isFinite(issued) || now - issued > SIGNIN_NONCE_TTL_MS || issued > now + 60_000) return false;
  return safeEqual(mac, sign(secret, `gnonce:${tenantId}:${hostname}:${ts}.${rand}`));
}

export interface GoogleSignInInput {
  idToken: string;
  nonce: string;
  host: string;
}

export interface GoogleSignInDeps {
  secret: string;
  verify?: GoogleIdentityVerifier | undefined;
  now?: number | undefined;
}

/**
 * Signs a customer in with a Google ID token from the store's own Google app.
 *
 * Linking rules (where social sign-in usually gets taken over):
 *  1. The identity is the Google `sub`. A known (store, sub) signs in directly.
 *  2. Otherwise a customer with the same email is linked ONLY because Google says the email is verified.
 *  3. If that row had a password but its email was never verified, the password is cleared and its sessions are
 *     revoked, so a password set by whoever pre-registered the address cannot survive the link.
 *  4. Never across stores; blocked or deleted customers cannot sign in; no password and no phone are created.
 */
export async function signInWithGoogle(
  db: Db,
  tenantId: string,
  input: GoogleSignInInput,
  deps: GoogleSignInDeps,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<CustomerAuthResult> {
  const now = deps.now ?? Date.now();
  const hostname = input.host.split(":")[0]?.toLowerCase() ?? "";
  const unavailable = new Error("Google sign-in is not available for this store.");

  await checkCustomerSocialLoginRateLimit(db, { tenantId, ip: meta.ip ?? "127.0.0.1" });

  if (!(await platformAllowsCustomerGoogle(db))) throw unavailable;
  const row = await readStoreSocialAuth(db, tenantId);
  const live = await listVerifiedCustomHostnames(db, tenantId);
  if (!row?.enabled || !row.clientId || !live.includes(hostname) || !isSetupVerified(row, live)) throw unavailable;

  if (!signinNonceValid(deps.secret, tenantId, hostname, input.nonce, now)) throw new Error("This sign-in expired. Please try again.");

  const claims = await (deps.verify ?? verifyGoogleIdentity)(input.idToken, row.clientId);
  // The token must have been minted for THIS store's Google app and for this very nonce.
  if (!claims || claims.nonce !== input.nonce) throw new Error("Google could not be verified. Please try again.");
  if (!claims.emailVerified) throw new Error("Your Google email address is not verified.");

  const result = await withTenant(db, tenantId, async (tx): Promise<CustomerAuthResult> => {
    // Single use: a replayed nonce hits the unique (tenant, token hash) index.
    const consumed = await tx
      .insert(schema.actionTokens)
      .values({
        tenantId,
        purpose: "google_nonce",
        targetId: hostname,
        tokenHash: sha256(input.nonce),
        expiresAt: new Date(now + SIGNIN_NONCE_TTL_MS),
        usedAt: new Date(now),
      })
      .onConflictDoNothing()
      .returning({ id: schema.actionTokens.id });
    if (consumed.length === 0) throw new Error("This sign-in was already used. Please try again.");

    let customerId: string;
    const [identity] = await tx
      .select({ id: schema.customerIdentities.id, customerId: schema.customerIdentities.customerId })
      .from(schema.customerIdentities)
      .where(
        and(
          eq(schema.customerIdentities.tenantId, tenantId),
          eq(schema.customerIdentities.provider, "google"),
          eq(schema.customerIdentities.subject, claims.sub),
        ),
      )
      .limit(1);

    let customer: typeof customers.$inferSelect | undefined;
    if (identity) {
      customerId = identity.customerId;
      [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
        .limit(1);
      await tx
        .update(schema.customerIdentities)
        .set({ lastLoginAt: new Date(now) })
        .where(and(eq(schema.customerIdentities.tenantId, tenantId), eq(schema.customerIdentities.id, identity.id)));
    } else {
      [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.email, claims.email)))
        .limit(1);

      if (customer) {
        if (customer.passwordHash && !customer.emailVerified) {
          await tx
            .update(customers)
            .set({ passwordHash: null })
            .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customer.id)));
          await destroyAllCustomerSessions(tx as unknown as Db, tenantId, customer.id);
        }
        // Google verified the address, so the guest row becomes a real account (ADR-019: adopt once email is verified).
        await tx
          .update(customers)
          .set({ emailVerified: true, isGuest: false, updatedAt: new Date(now) })
          .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customer.id)));
      } else {
        [customer] = await tx
          .insert(customers)
          .values({ tenantId, email: claims.email, name: claims.name, passwordHash: null, emailVerified: true, phoneVerified: false })
          .returning();
      }
      if (!customer) throw new Error("Could not create your account.");
      customerId = customer.id;
      await tx.insert(schema.customerIdentities).values({
        tenantId,
        customerId,
        provider: "google",
        subject: claims.sub,
        email: claims.email,
        lastLoginAt: new Date(now),
      });
    }

    if (!customer || customer.status !== "active" || customer.deletedAt) throw unavailable;

    const { token } = await createCustomerSession(tx, tenantId, customerId, meta);
    const record: CustomerRecord = {
      id: customer.id,
      phone: customer.phone,
      email: customer.email,
      name: customer.name,
      phoneVerified: customer.phoneVerified,
      emailVerified: true,
    };
    return { customer: record, token };
  });

  return result;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Setup verification: the store owner proves the pasted Client ID works on the store's own custom domain.
 * The admin app (a different origin) cannot run Google's prompt for the store's client, so the owner is sent to the
 * store's domain with a short-lived signed ticket; the page there runs a real sign-in and reports back.
 * ---------------------------------------------------------------------------------------------------------------- */

export interface GoogleSetupTicket {
  tenantId: string;
  clientId: string;
  exp: number;
}

export function issueGoogleSetupTicket(secret: string, tenantId: string, clientId: string, now: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ tenantId, clientId, exp: now + SETUP_TICKET_TTL_MS } satisfies GoogleSetupTicket)).toString("base64url");
  return `${body}.${sign(secret, `gsetup:${body}`)}`;
}

export function readGoogleSetupTicket(secret: string, ticket: string, now: number = Date.now()): GoogleSetupTicket | null {
  const [body, mac] = ticket.split(".");
  if (!body || !mac || !safeEqual(mac, sign(secret, `gsetup:${body}`))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleSetupTicket;
    if (typeof t.tenantId !== "string" || typeof t.clientId !== "string" || typeof t.exp !== "number" || t.exp < now) return null;
    return t;
  } catch {
    return null;
  }
}

/** Nonce for the setup test, bound to the ticket's store and host. */
export function issueSetupNonce(secret: string, tenantId: string, hostname: string, now: number = Date.now()): string {
  return issueSigninNonce(secret, tenantId, hostname, now);
}

/**
 * Completes the setup test. The ID token must come from the pasted Client ID, carry the nonce, and be requested on a
 * live custom domain of this very store. On success the store's setup is marked verified for that Client ID and host.
 */
export async function completeGoogleSetupVerification(
  db: Db,
  input: { ticket: string; idToken: string; nonce: string; host: string },
  deps: GoogleSignInDeps,
): Promise<{ tenantId: string; host: string }> {
  const now = deps.now ?? Date.now();
  const ticket = readGoogleSetupTicket(deps.secret, input.ticket, now);
  if (!ticket) throw new Error("This test link expired. Start the test again from Store Admin.");
  const hostname = input.host.split(":")[0]?.toLowerCase() ?? "";

  const live = await listVerifiedCustomHostnames(db, ticket.tenantId);
  if (!live.includes(hostname)) throw new Error("Run this test on your own custom domain.");
  if (!signinNonceValid(deps.secret, ticket.tenantId, hostname, input.nonce, now)) throw new Error("This test expired. Please try again.");

  const row = await readStoreSocialAuth(db, ticket.tenantId);
  if (!row?.clientId || row.clientId !== ticket.clientId) throw new Error("The Client ID changed. Start the test again from Store Admin.");

  const claims = await (deps.verify ?? verifyGoogleIdentity)(input.idToken, row.clientId);
  if (!claims || claims.nonce !== input.nonce) throw new Error("Google could not be verified. Check that the Client ID and the origin are correct.");

  await withTenant(db, ticket.tenantId, async (tx) => {
    await tx
      .update(schema.storeSocialAuth)
      .set({ verifiedAt: new Date(now), verifiedClientId: row.clientId, verifiedHost: hostname, updatedAt: new Date(now) })
      .where(and(eq(schema.storeSocialAuth.tenantId, ticket.tenantId), eq(schema.storeSocialAuth.provider, "google")));
    await tx.insert(schema.auditLogs).values({
      tenantId: ticket.tenantId,
      actorType: "system",
      actorId: null,
      action: "social_auth.google.verified",
      targetType: "store_social_auth",
      targetId: row.id,
      diff: { host: hostname },
    });
  });
  return { tenantId: ticket.tenantId, host: hostname };
}
