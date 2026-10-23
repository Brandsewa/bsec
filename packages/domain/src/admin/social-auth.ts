import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { assertPermission } from "../context.ts";
import {
  GOOGLE_CLIENT_ID_RE,
  isSetupVerified,
  issueGoogleSetupTicket,
  listVerifiedCustomHostnames,
  readStoreSocialAuth,
} from "../customers/social/google.ts";

/**
 * A store's own Google sign-in for its customers (docs/GOOGLE-SIGNIN-PLAN.md, Tier B).
 * Needs Super Admin's customer switch AND a live custom domain; both are enforced here, not only in the UI.
 */

export interface StoreGoogleSigninView {
  /** Super Admin allows stores to offer Google to their customers. */
  platformAllowed: boolean;
  /** The store has at least one live custom domain. */
  hasVerifiedDomain: boolean;
  /** Origins to paste into Google as Authorized JavaScript origins (live custom domains only). */
  origins: string[];
  clientId: string | null;
  enabled: boolean;
  oneTapEnabled: boolean;
  /** The Client ID passed a real test sign-in on a domain that is still live. */
  verified: boolean;
  verifiedAt: string | null;
  verifiedHost: string | null;
  /** A Client ID is saved but its test is missing or void (changed Client ID, or the domain is gone). */
  needsVerification: boolean;
}

async function platformAllows(rt: Runtime): Promise<boolean> {
  const [row] = await rt._db.db
    .select({ allowed: schema.platformAuthProviders.customerSigninAllowed })
    .from(schema.platformAuthProviders)
    .where(eq(schema.platformAuthProviders.provider, "google"))
    .limit(1);
  return Boolean(row?.allowed);
}

/** Throws unless Super Admin allows it and the store has a live custom domain. */
async function assertAvailable(rt: Runtime, tenantId: string): Promise<string[]> {
  if (!(await platformAllows(rt))) throw new Error("Bad Request: Google sign-in for customers is not available yet.");
  const hosts = await listVerifiedCustomHostnames(rt._db.db, tenantId);
  if (hosts.length === 0) {
    throw new Error("Bad Request: connect and verify your own domain first. Google sign-in for customers runs on your domain.");
  }
  return hosts;
}

async function audit(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContext,
  action: string,
  targetId: string,
  diff: Record<string, unknown>,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "store_social_auth",
    targetId,
    diff,
  });
}

export async function getStoreGoogleSignin(rt: Runtime, ctx: TenantContext): Promise<StoreGoogleSigninView> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;
  const [platformAllowed, hosts, row] = await Promise.all([
    platformAllows(rt),
    listVerifiedCustomHostnames(db, ctx.tenantId),
    readStoreSocialAuth(db, ctx.tenantId),
  ]);
  const verified = isSetupVerified(row, hosts);
  return {
    platformAllowed,
    hasVerifiedDomain: hosts.length > 0,
    origins: hosts.map((h) => `https://${h}`),
    clientId: row?.clientId ?? null,
    enabled: Boolean(row?.enabled),
    oneTapEnabled: row?.oneTapEnabled ?? true,
    verified,
    verifiedAt: verified && row?.verifiedAt ? row.verifiedAt.toISOString() : null,
    verifiedHost: verified ? (row?.verifiedHost ?? null) : null,
    needsVerification: Boolean(row?.clientId) && !verified,
  };
}

/** Saves the public Client ID. Any change voids an earlier test and switches the feature off until it is tested again. */
export async function setStoreGoogleClientId(rt: Runtime, ctx: TenantContext, input: { clientId: string }): Promise<{ ok: true }> {
  assertPermission(ctx, "settings.write");
  await assertAvailable(rt, ctx.tenantId);
  const clientId = input.clientId.trim();
  if (!GOOGLE_CLIENT_ID_RE.test(clientId)) {
    throw new Error("Bad Request: the Client ID should look like 123456-abc.apps.googleusercontent.com");
  }

  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.storeSocialAuth)
      .where(and(eq(schema.storeSocialAuth.tenantId, ctx.tenantId), eq(schema.storeSocialAuth.provider, "google")))
      .limit(1);
    const values = {
      clientId,
      enabled: false,
      verifiedAt: null,
      verifiedClientId: null,
      verifiedHost: null,
      updatedAt: new Date(),
    };
    const [saved] = before
      ? await tx.update(schema.storeSocialAuth).set(values).where(eq(schema.storeSocialAuth.id, before.id)).returning({ id: schema.storeSocialAuth.id })
      : await tx.insert(schema.storeSocialAuth).values({ tenantId: ctx.tenantId, provider: "google", ...values }).returning({ id: schema.storeSocialAuth.id });
    await audit(tx, ctx, "social_auth.google.client_id_set", saved?.id ?? "google", { changed: before?.clientId !== clientId });
  });
  return { ok: true };
}

/** Turns Google sign-in on or off for the store's customers. Turning it on needs a verified setup. */
export async function updateStoreGoogleSignin(
  rt: Runtime,
  ctx: TenantContext,
  input: { enabled?: boolean | undefined; oneTapEnabled?: boolean | undefined },
): Promise<{ ok: true }> {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;
  const row = await readStoreSocialAuth(db, ctx.tenantId);
  if (!row?.clientId) throw new Error("Bad Request: add your Google Client ID first");

  if (input.enabled === true) {
    const hosts = await assertAvailable(rt, ctx.tenantId);
    if (!isSetupVerified(row, hosts)) throw new Error("Bad Request: run the test sign-in successfully before turning Google sign-in on");
  }

  await withTenant(db, ctx.tenantId, async (tx) => {
    const next = { enabled: input.enabled ?? row.enabled, oneTapEnabled: input.oneTapEnabled ?? row.oneTapEnabled };
    await tx
      .update(schema.storeSocialAuth)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(schema.storeSocialAuth.id, row.id));
    await audit(tx, ctx, next.enabled !== row.enabled ? (next.enabled ? "social_auth.google.enabled" : "social_auth.google.disabled") : "social_auth.google.updated", row.id, {
      before: { enabled: row.enabled, oneTapEnabled: row.oneTapEnabled },
      after: next,
    });
  });
  return { ok: true };
}

/**
 * Starts the test sign-in. The owner is sent to the store's own custom domain, because Google only runs the prompt on
 * an origin registered on the owner's Google app. The link carries a short-lived signed ticket.
 */
export async function startStoreGoogleVerification(rt: Runtime, ctx: TenantContext, secret: string): Promise<{ url: string }> {
  assertPermission(ctx, "settings.write");
  const hosts = await assertAvailable(rt, ctx.tenantId);
  const row = await readStoreSocialAuth(rt._db.db, ctx.tenantId);
  if (!row?.clientId) throw new Error("Bad Request: add your Google Client ID first");
  const host = hosts[0];
  if (!host) throw new Error("Bad Request: connect and verify your own domain first");
  const ticket = issueGoogleSetupTicket(secret, ctx.tenantId, row.clientId);
  return { url: `https://${host}/account/google-verify?t=${encodeURIComponent(ticket)}` };
}

/** Removes the store's Google setup. Customers already linked keep their accounts and can still use email. */
export async function disconnectStoreGoogle(rt: Runtime, ctx: TenantContext): Promise<{ ok: true }> {
  assertPermission(ctx, "settings.write");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .update(schema.storeSocialAuth)
      .set({ enabled: false, clientId: null, verifiedAt: null, verifiedClientId: null, verifiedHost: null, updatedAt: new Date() })
      .where(and(eq(schema.storeSocialAuth.tenantId, ctx.tenantId), eq(schema.storeSocialAuth.provider, "google")))
      .returning({ id: schema.storeSocialAuth.id });
    if (row) await audit(tx, ctx, "social_auth.google.disconnected", row.id, {});
  });
  return { ok: true };
}
