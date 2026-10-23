import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@bs/db";
import { verifyGoogleIdentity, type GoogleIdentityClaims } from "@bs/auth";
import { loadPlatformGoogleRuntimeConfig } from "../platform/auth-providers.ts";

/**
 * Store-owner signup with Google (docs/GOOGLE-SIGNIN-PLAN.md, Tier A).
 * The browser gets a Google ID token for the PLATFORM client, we verify it on the server, and hand back a short-lived
 * signed ticket carrying the verified email. The signup call then accepts that ticket instead of a password, so the
 * email the store is created for is always the one Google verified, never one typed by the client.
 */

const NONCE_TTL_MS = 10 * 60_000;
const TICKET_TTL_MS = 15 * 60_000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A stateless, time-limited nonce the client passes to Google; the ID token must echo it back. */
export function issueGoogleSignupNonce(secret: string, now: number = Date.now()): string {
  const body = `${now}.${randomBytes(16).toString("base64url")}`;
  return `${body}.${sign(secret, `nonce:${body}`)}`;
}

function nonceValid(secret: string, nonce: string, now: number): boolean {
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const [ts, rand, mac] = parts as [string, string, string];
  const issued = Number(ts);
  if (!Number.isFinite(issued) || now - issued > NONCE_TTL_MS || issued > now + 60_000) return false;
  return safeEqual(mac, sign(secret, `nonce:${ts}.${rand}`));
}

export interface GoogleSignupTicketPayload {
  email: string;
  name: string;
  sub: string;
  exp: number;
}

function issueTicket(secret: string, p: GoogleSignupTicketPayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign(secret, `ticket:${body}`)}`;
}

/** Returns the verified identity inside a ticket, or null when it is forged, malformed or expired. */
export function readGoogleSignupTicket(secret: string, ticket: string, now: number = Date.now()): GoogleSignupTicketPayload | null {
  const [body, mac] = ticket.split(".");
  if (!body || !mac || !safeEqual(mac, sign(secret, `ticket:${body}`))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleSignupTicketPayload;
    if (typeof p.email !== "string" || typeof p.sub !== "string" || typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}

export type GoogleIdentityVerifier = (idToken: string, clientId: string) => Promise<GoogleIdentityClaims | null>;

export async function verifyGoogleForSignup(
  db: Db,
  secret: string,
  input: { idToken: string; nonce: string },
  verify: GoogleIdentityVerifier = verifyGoogleIdentity,
  now: number = Date.now(),
): Promise<{ ticket: string; email: string; name: string }> {
  const cfg = await loadPlatformGoogleRuntimeConfig(db);
  if (!cfg || !cfg.staffSignupAllowed) throw new Error("Signing up with Google is not available right now.");
  if (!nonceValid(secret, input.nonce, now)) throw new Error("This sign-in expired. Please try again.");

  const claims = await verify(input.idToken, cfg.clientId);
  if (!claims || claims.nonce !== input.nonce) throw new Error("Google could not be verified. Please try again.");
  if (!claims.emailVerified) throw new Error("Your Google email address is not verified.");

  const name = claims.name || claims.email.split("@")[0] || "";
  return {
    ticket: issueTicket(secret, { email: claims.email, name, sub: claims.sub, exp: now + TICKET_TTL_MS }),
    email: claims.email,
    name,
  };
}
