/**
 * OAuth 2.1 authorization server for AI apps (ADR-050; Claude's connector requirements are in docs/MCP-PLAN.md section 14).
 * Public clients only (PKCE S256, no client secret). Clients arrive by dynamic registration (RFC 7591) or by a client
 * metadata document fetched from an allowlisted host. Every redirect URI is checked against an allowlist: Claude's
 * hosted callback, plus loopback addresses (any port) for local apps such as Claude Code. Nothing else is ever redirected to.
 *
 * Flow: /authorize stores a request -> the merchant approves on the admin authorize screen (a signed-in staff user with
 * `ai.manage`) -> a single-use code (60 s) -> /token exchanges it for an access and a refresh token bound to a connection.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { AI_CONSENT_VERSION } from "./consent.ts";
import { OAuthError, issueTokenPair, newToken, revokeConnectionAsCompromised, hashAiToken, type TokenPair } from "./tokens.ts";
import { aiAccessEntitled, aiFlagEnabled } from "./access.ts";

/**
 * Hosted callbacks and client metadata hosts of the AI apps we support (ADR-050). Claude (claude.ai, claude.com) and
 * Google Antigravity (antigravity.google: CIMD client https://antigravity.google/oauth/client-metadata.json, hosted callback
 * where the App shows the code to paste). Loopback addresses are always allowed for local apps.
 */
const DEFAULT_REDIRECT_URIS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "https://antigravity.google/oauth-callback"];
const DEFAULT_CIMD_HOSTS = ["claude.ai", "claude.com", "antigravity.google"];
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

function listFromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.split(",").map((s) => s.trim()).filter(Boolean);
  return raw && raw.length > 0 ? raw : fallback;
}

export const mcpResourceUrl = (base: string): string => `${base}/api/mcp`;

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** A redirect URI may be registered only if it is on the allowlist or is a loopback address. */
export function isAllowedRedirectUri(uri: string): boolean {
  if (uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
  } catch {
    return false;
  }
  return listFromEnv("AI_OAUTH_REDIRECT_URIS", DEFAULT_REDIRECT_URIS).includes(uri) || isLoopbackRedirect(uri);
}

/** Exact match, except loopback URIs ignore the port (RFC 8252: local apps pick a free port at run time). */
function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopbackRedirect(requested)) return false;
  const r = new URL(requested);
  return registered.some((reg) => {
    if (!isLoopbackRedirect(reg)) return false;
    const g = new URL(reg);
    return g.hostname === r.hostname && g.pathname === r.pathname;
  });
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: mcpResourceUrl(base),
    authorization_servers: [base],
    scopes_supported: ["offline_access"],
    bearer_methods_supported: ["header"],
    resource_name: "Brand Sewa store AI access",
  };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["offline_access"],
    client_id_metadata_document_supported: true,
  };
}

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  source: "dcr" | "cimd";
}

function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? [...raw].filter((ch) => ch.charCodeAt(0) >= 32 && ch !== "<" && ch !== ">").join("").trim() : "";
  return (s || "AI app").slice(0, 80);
}

/** Dynamic client registration (RFC 7591). Only public clients with allowed redirect URIs are accepted. */
export async function registerOAuthClient(db: Db, body: unknown): Promise<{ client_id: string; client_name: string; redirect_uris: string[]; grant_types: string[]; response_types: string[]; token_endpoint_auth_method: "none" }> {
  if (!body || typeof body !== "object") throw new OAuthError("invalid_request", "Send a JSON object.");
  const b = body as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? (b.redirect_uris as unknown[]) : [];
  if (uris.length < 1 || uris.length > 5 || !uris.every((u): u is string => typeof u === "string")) {
    throw new OAuthError("invalid_request", "redirect_uris must list one to five addresses.");
  }
  const bad = uris.find((u) => !isAllowedRedirectUri(u));
  if (bad) throw new OAuthError("invalid_request", "That redirect address is not allowed for AI access connections.");
  const method = b.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") throw new OAuthError("invalid_request", "Only public clients (token_endpoint_auth_method none) are supported.");
  const name = cleanName(b.client_name);
  const id = `bsc_${randomBytes(18).toString("base64url")}`;
  await db.insert(schema.oauthClients).values({ id, name, redirectUris: uris, source: "dcr" });
  return { client_id: id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

async function fetchClientMetadataDocument(url: string): Promise<{ name: string; redirectUris: string[] }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !listFromEnv("AI_OAUTH_CIMD_HOSTS", DEFAULT_CIMD_HOSTS).includes(u.hostname)) {
    throw new OAuthError("invalid_client", "Client metadata documents are only accepted from approved hosts.", 401);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "error", headers: { accept: "application/json" } });
    if (!res.ok) throw new OAuthError("invalid_client", "The client metadata document could not be read.", 401);
    const text = await res.text();
    if (text.length > 64 * 1024) throw new OAuthError("invalid_client", "The client metadata document is too large.", 401);
    const doc = JSON.parse(text) as Record<string, unknown>;
    if (doc.client_id !== url) throw new OAuthError("invalid_client", "The client metadata document does not match its address.", 401);
    const uris = Array.isArray(doc.redirect_uris) ? (doc.redirect_uris as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const allowed = uris.filter(isAllowedRedirectUri);
    if (allowed.length === 0) throw new OAuthError("invalid_client", "The client metadata document has no allowed redirect address.", 401);
    return { name: cleanName(doc.client_name), redirectUris: allowed };
  } catch (err) {
    if (err instanceof OAuthError) throw err;
    throw new OAuthError("invalid_client", "The client metadata document could not be read.", 401);
  } finally {
    clearTimeout(timer);
  }
}

/** Finds a registered client, or fetches and stores a CIMD client (the client_id is an https URL on an approved host). */
export async function resolveOAuthClient(db: Db, clientId: string): Promise<OAuthClient> {
  if (!clientId || clientId.length > 300) throw new OAuthError("invalid_client", "Unknown client.", 401);
  if (clientId.startsWith("https://")) {
    const doc = await fetchClientMetadataDocument(clientId);
    await db
      .insert(schema.oauthClients)
      .values({ id: clientId, name: doc.name, redirectUris: doc.redirectUris, source: "cimd" })
      .onConflictDoUpdate({ target: schema.oauthClients.id, set: { name: doc.name, redirectUris: doc.redirectUris, lastUsedAt: new Date() } });
    return { id: clientId, name: doc.name, redirectUris: doc.redirectUris, source: "cimd" };
  }
  const [row] = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, clientId)).limit(1);
  if (!row) throw new OAuthError("invalid_client", "Unknown client.", 401);
  return { id: row.id, name: row.name, redirectUris: row.redirectUris as string[], source: row.source as "dcr" | "cimd" };
}

export interface AuthorizeParams {
  responseType: string | undefined;
  clientId: string | undefined;
  redirectUri: string | undefined;
  codeChallenge: string | undefined;
  codeChallengeMethod: string | undefined;
  state: string | undefined;
  scope: string | undefined;
  resource: string | undefined;
}

/** Validates an /authorize request and stores it for the merchant to approve. Returns the request id for the admin screen. */
export async function createAuthorizationRequest(db: Db, base: string, p: AuthorizeParams): Promise<{ requestId: string }> {
  if (p.responseType !== "code") throw new OAuthError("invalid_request", "response_type must be code.");
  if (!p.clientId) throw new OAuthError("invalid_request", "client_id is required.");
  const client = await resolveOAuthClient(db, p.clientId);
  if (!p.redirectUri || !redirectMatches(client.redirectUris, p.redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri does not match the registered address.");
  }
  if (p.codeChallengeMethod !== "S256" || !p.codeChallenge || !/^[A-Za-z0-9_-]{43,128}$/.test(p.codeChallenge)) {
    throw new OAuthError("invalid_request", "PKCE with code_challenge_method S256 is required.");
  }
  if (p.resource && p.resource !== mcpResourceUrl(base)) throw new OAuthError("invalid_target", "The resource is not this server.");
  if ((p.state?.length ?? 0) > 512 || (p.scope?.length ?? 0) > 200) throw new OAuthError("invalid_request", "A parameter is too long.");
  const [row] = await db
    .insert(schema.oauthAuthorizationRequests)
    .values({
      clientId: client.id,
      redirectUri: p.redirectUri,
      state: p.state ?? null,
      codeChallenge: p.codeChallenge,
      scope: p.scope ?? null,
      resource: p.resource ?? null,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    })
    .returning({ id: schema.oauthAuthorizationRequests.id });
  if (!row) throw new Error("Could not store the authorization request");
  return { requestId: row.id };
}

export interface AuthorizationRequestView {
  clientName: string;
  /** Host the browser will return to, shown so a look-alike app is visible. */
  redirectHost: string;
  /** A local app on this computer (for example Claude Code): its name is self-declared. */
  loopback: boolean;
  expiresAt: string;
}

type RequestRow = typeof schema.oauthAuthorizationRequests.$inferSelect;

async function loadPendingRequest(db: Db, requestId: string): Promise<{ row: RequestRow; clientName: string }> {
  const [row] = await db.select().from(schema.oauthAuthorizationRequests).where(eq(schema.oauthAuthorizationRequests.id, requestId)).limit(1);
  if (!row || row.usedAt || row.codeHash || row.expiresAt.getTime() <= Date.now()) {
    throw new Error("Not Found: This link expired. Go back to the AI app and press Connect again.");
  }
  const [client] = await db.select({ name: schema.oauthClients.name }).from(schema.oauthClients).where(eq(schema.oauthClients.id, row.clientId)).limit(1);
  return { row, clientName: client?.name ?? "AI app" };
}

export async function getAuthorizationRequestView(rt: Runtime, requestId: string): Promise<AuthorizationRequestView> {
  const { row, clientName } = await loadPendingRequest(rt._db.db, requestId);
  return { clientName, redirectHost: new URL(row.redirectUri).host, loopback: isLoopbackRedirect(row.redirectUri), expiresAt: row.expiresAt.toISOString() };
}

function withParams(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * The merchant approves: creates (or reuses) the connection for this store, user and app, and returns the redirect back to the
 * app carrying a single-use code. Only a signed-in staff user with `ai.manage` can approve, and only when the store is entitled,
 * AI access is on and the current consent is accepted.
 */
export async function approveAuthorizationRequest(rt: Runtime, ctx: TenantContext, requestId: string): Promise<{ redirectTo: string }> {
  assertPermission(ctx, "ai.manage");
  if (ctx.actor.type !== "staff") throw new Error("Forbidden: only a signed-in store user can approve an AI app");
  const userId = ctx.actor.userId;
  const db = rt._db.db;
  if (!(await aiAccessEntitled(db, ctx.tenantId))) throw new Error("Forbidden: AI access is available on the Growth plan and above");
  if (!(await aiFlagEnabled(db, ctx.tenantId))) throw new Error("Forbidden: AI access is turned off for your store by Brand Sewa");
  const { row, clientName } = await loadPendingRequest(db, requestId);

  const connectionId = await withTenant(db, ctx.tenantId, async (tx) => {
    const [settings] = await tx.select().from(schema.storeAiSettings).where(eq(schema.storeAiSettings.tenantId, ctx.tenantId)).limit(1);
    if (!settings?.enabled) throw new Error("Conflict: Turn on AI access in Settings before connecting an app");
    if (settings.consentVersion !== AI_CONSENT_VERSION) throw new Error("Conflict: Accept the AI access terms in Settings before connecting an app");
    const [existing] = await tx
      .select({ id: schema.agentConnections.id })
      .from(schema.agentConnections)
      .where(
        and(
          eq(schema.agentConnections.tenantId, ctx.tenantId),
          eq(schema.agentConnections.userId, userId),
          eq(schema.agentConnections.clientId, row.clientId),
          eq(schema.agentConnections.status, "active"),
        ),
      )
      .limit(1);
    let id = existing?.id;
    if (!id) {
      const [created] = await tx
        .insert(schema.agentConnections)
        .values({ tenantId: ctx.tenantId, userId, clientId: row.clientId, clientName })
        .returning({ id: schema.agentConnections.id });
      if (!created) throw new Error("Could not create the connection");
      id = created.id;
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: userId,
        action: "ai.connection.created",
        targetType: "ai_connection",
        targetId: id,
        diff: { clientName, via: "mcp" },
      });
    }
    return id;
  });

  const code = newToken("bsac_");
  const claimed = await db
    .update(schema.oauthAuthorizationRequests)
    .set({ tenantId: ctx.tenantId, userId, connectionId, codeHash: hashAiToken(code), codeExpiresAt: new Date(Date.now() + CODE_TTL_MS) })
    .where(and(eq(schema.oauthAuthorizationRequests.id, requestId), isNull(schema.oauthAuthorizationRequests.codeHash), isNull(schema.oauthAuthorizationRequests.usedAt)))
    .returning({ id: schema.oauthAuthorizationRequests.id });
  if (claimed.length === 0) throw new Error("Not Found: This link expired. Go back to the AI app and press Connect again.");
  return { redirectTo: withParams(row.redirectUri, { code, state: row.state ?? undefined }) };
}

export async function denyAuthorizationRequest(rt: Runtime, ctx: TenantContext, requestId: string): Promise<{ redirectTo: string }> {
  assertPermission(ctx, "ai.manage");
  const { row } = await loadPendingRequest(rt._db.db, requestId);
  await rt._db.db.delete(schema.oauthAuthorizationRequests).where(eq(schema.oauthAuthorizationRequests.id, requestId));
  return { redirectTo: withParams(row.redirectUri, { error: "access_denied", state: row.state ?? undefined }) };
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}

function toResponse(pair: TokenPair): TokenResponse {
  return { access_token: pair.accessToken, token_type: "Bearer", expires_in: pair.expiresIn, refresh_token: pair.refreshToken };
}

/** authorization_code grant. The code works once; a replayed code revokes what it created. */
export async function exchangeAuthorizationCode(
  db: Db,
  base: string,
  p: { code: string | undefined; clientId: string | undefined; redirectUri: string | undefined; codeVerifier: string | undefined; resource: string | undefined },
): Promise<TokenResponse> {
  if (!p.code || !p.clientId || !p.codeVerifier) throw new OAuthError("invalid_request", "code, client_id and code_verifier are required.");
  if (p.codeVerifier.length < 43 || p.codeVerifier.length > 128) throw new OAuthError("invalid_grant", "The code verifier is not valid.");
  if (p.resource && p.resource !== mcpResourceUrl(base)) throw new OAuthError("invalid_target", "The resource is not this server.");
  const [row] = await db.select().from(schema.oauthAuthorizationRequests).where(eq(schema.oauthAuthorizationRequests.codeHash, hashAiToken(p.code))).limit(1);
  if (!row || row.clientId !== p.clientId) throw new OAuthError("invalid_grant", "The authorization code is not valid.");
  if (row.usedAt) {
    if (row.tenantId && row.connectionId) await revokeConnectionAsCompromised(db, row.tenantId, row.connectionId);
    throw new OAuthError("invalid_grant", "The authorization code was already used.");
  }
  if (!row.codeExpiresAt || row.codeExpiresAt.getTime() <= Date.now() || !row.tenantId || !row.connectionId) {
    throw new OAuthError("invalid_grant", "The authorization code has expired.");
  }
  if (p.redirectUri && p.redirectUri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match.");
  if (!pkceMatches(p.codeVerifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "The code verifier does not match.");
  const claimed = await db
    .update(schema.oauthAuthorizationRequests)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.oauthAuthorizationRequests.id, row.id), isNull(schema.oauthAuthorizationRequests.usedAt)))
    .returning({ id: schema.oauthAuthorizationRequests.id });
  if (claimed.length === 0) throw new OAuthError("invalid_grant", "The authorization code was already used.");

  const tenantId = row.tenantId;
  const connectionId = row.connectionId;
  const ok = await withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select({ status: schema.agentConnections.status })
      .from(schema.agentConnections)
      .where(and(eq(schema.agentConnections.tenantId, tenantId), eq(schema.agentConnections.id, connectionId)))
      .limit(1);
    return c?.status === "active";
  });
  if (!ok) throw new OAuthError("invalid_grant", "The connection is not active.");
  await db.update(schema.oauthClients).set({ lastUsedAt: new Date() }).where(eq(schema.oauthClients.id, row.clientId));
  return toResponse(await issueTokenPair(db, { tenantId, connectionId }));
}

/** Housekeeping for the maintenance job: expired requests and clients nobody used for 180 days. */
export async function pruneOAuthData(db: Db): Promise<void> {
  await db.delete(schema.oauthAuthorizationRequests).where(sql`${schema.oauthAuthorizationRequests.expiresAt} < now() - interval '1 day'`);
  await db.delete(schema.oauthClients).where(sql`coalesce(${schema.oauthClients.lastUsedAt}, ${schema.oauthClients.createdAt}) < now() - interval '180 days'`);
  await db.delete(schema.agentTokens).where(sql`${schema.agentTokens.expiresAt} < now() - interval '7 days'`);
}
