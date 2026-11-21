import "server-only";
import {
  AgentAccessError,
  OAuthError,
  authenticateAgent,
  authorizationServerMetadata,
  checkRateLimit,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getClientIp,
  mcpResourceUrl,
  protectedResourceMetadata,
  revokeToken,
  rotateRefreshToken,
  registerOAuthClient,
} from "@bs/domain";
import { extractBearer, handleMcpRequest, isOriginAllowed, unauthorizedResponse } from "@bs/mcp";
import { readAuthSettings } from "./auth.ts";
import { server } from "./runtime.ts";

/**
 * HTTP layer for AI access (ADR-050, docs/MCP-PLAN.md sections 8 and 14): OAuth endpoints, discovery metadata and the MCP endpoint.
 * All of it answers only on the platform root host (404 elsewhere, so a merchant's storefront domain never serves it), ignores
 * cookies completely (bearer tokens only), and never caches.
 */

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...NO_STORE, ...extra } });
}

/** The platform root origin (BETTER_AUTH_URL), which is the issuer and the base of the MCP address. Null when auth is not configured. */
export function aiBase(): string | null {
  return readAuthSettings()?.baseURL ?? null;
}

function onRootHost(req: Request, base: string): boolean {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host).split(",")[0]?.trim().toLowerCase();
  return host === new URL(base).host.toLowerCase();
}

/** Common guard: configured, and on the root host. Returns the base, or a response to send instead. */
function guard(req: Request): { base: string } | { response: Response } {
  const base = aiBase();
  if (!base) return { response: json({ error: "not_configured", error_description: "Sign-in is not configured on this server." }, 503) };
  if (!onRootHost(req, base)) return { response: new Response("Not Found", { status: 404 }) };
  return { base };
}

function oauthFail(err: unknown): Response {
  if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
  server().log.error({ err }, "oauth endpoint failed");
  return json({ error: "server_error", error_description: "Something went wrong. Try again." }, 500);
}

async function limit(req: Request, key: string, max: number, windowSeconds: number): Promise<Response | null> {
  try {
    const ip = getClientIp(req.headers);
    const r = await checkRateLimit(server().rt._db.db, { key: `oauth:${key}:${ip}`, limit: max, windowSeconds });
    if (!r.allowed) return json({ error: "slow_down", error_description: "Too many requests. Try again later." }, 429, { "retry-after": String(r.retryAfter) });
  } catch {
    // counters unavailable: do not block sign-in discovery
  }
  return null;
}

/** Form bodies are the norm for /token; JSON is accepted too. */
async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (text.length > 20_000) throw new OAuthError("invalid_request", "The request is too large.");
  if (type.includes("application/json")) {
    const body = JSON.parse(text || "{}") as Record<string, unknown>;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") p.set(k, v);
    return p;
  }
  return new URLSearchParams(text);
}

export function protectedResourceResponse(req: Request): Response {
  const g = guard(req);
  if ("response" in g) return g.response;
  return json(protectedResourceMetadata(g.base), 200, { "cache-control": "public, max-age=300" });
}

export function authorizationServerResponse(req: Request): Response {
  const g = guard(req);
  if ("response" in g) return g.response;
  return json(authorizationServerMetadata(g.base), 200, { "cache-control": "public, max-age=300" });
}

function adminOrigin(): string | null {
  const configured = process.env.AI_ADMIN_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  return readAuthSettings()?.adminOrigins[0] ?? null;
}

function errorPage(message: string): Response {
  const safe = message.replace(/[<>&]/g, "");
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Could not connect</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">Could not connect</h1><p>${safe}</p><p>Go back to the AI app and try connecting again.</p>`, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE },
  });
}

/** GET /api/oauth/authorize: validates the request, stores it, and sends the browser to the admin authorize screen. */
export async function handleAuthorize(req: Request): Promise<Response> {
  const g = guard(req);
  if ("response" in g) return g.response;
  const admin = adminOrigin();
  if (!admin) return errorPage("Sign-in is not configured on this server.");
  const q = new URL(req.url).searchParams;
  try {
    const { requestId } = await createAuthorizationRequest(server().rt._db.db, g.base, {
      responseType: q.get("response_type") ?? undefined,
      clientId: q.get("client_id") ?? undefined,
      redirectUri: q.get("redirect_uri") ?? undefined,
      codeChallenge: q.get("code_challenge") ?? undefined,
      codeChallengeMethod: q.get("code_challenge_method") ?? undefined,
      state: q.get("state") ?? undefined,
      scope: q.get("scope") ?? undefined,
      resource: q.get("resource") ?? undefined,
    });
    return new Response(null, { status: 302, headers: { location: `${admin}/oauth/authorize?request=${requestId}`, ...NO_STORE } });
  } catch (err) {
    // A bad client or redirect address must never redirect back to that address: show a page instead.
    return errorPage(err instanceof OAuthError ? err.message : "The connection request was not valid.");
  }
}

/** POST /api/oauth/register: dynamic client registration (RFC 7591). */
export async function handleRegister(req: Request): Promise<Response> {
  const g = guard(req);
  if ("response" in g) return g.response;
  const limited = await limit(req, "register", 10, 3600);
  if (limited) return limited;
  try {
    const body = JSON.parse((await req.text()) || "{}") as unknown;
    return json(await registerOAuthClient(server().rt._db.db, body), 201);
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: "invalid_request", error_description: "Send a JSON body." }, 400);
    return oauthFail(err);
  }
}

/** POST /api/oauth/token: authorization_code and refresh_token grants. */
export async function handleToken(req: Request): Promise<Response> {
  const g = guard(req);
  if ("response" in g) return g.response;
  const limited = await limit(req, "token", 60, 60);
  if (limited) return limited;
  try {
    const p = await readParams(req);
    const db = server().rt._db.db;
    const grant = p.get("grant_type");
    if (grant === "authorization_code") {
      return json(
        await exchangeAuthorizationCode(db, g.base, {
          code: p.get("code") ?? undefined,
          clientId: p.get("client_id") ?? undefined,
          redirectUri: p.get("redirect_uri") ?? undefined,
          codeVerifier: p.get("code_verifier") ?? undefined,
          resource: p.get("resource") ?? undefined,
        }),
      );
    }
    if (grant === "refresh_token") {
      const refresh = p.get("refresh_token");
      const clientId = p.get("client_id");
      if (!refresh || !clientId) throw new OAuthError("invalid_request", "refresh_token and client_id are required.");
      const pair = await rotateRefreshToken(db, refresh, clientId);
      return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: pair.expiresIn, refresh_token: pair.refreshToken });
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (err) {
    return oauthFail(err);
  }
}

/** POST /api/oauth/revoke (RFC 7009): always answers 200. */
export async function handleRevoke(req: Request): Promise<Response> {
  const g = guard(req);
  if ("response" in g) return g.response;
  try {
    const token = (await readParams(req)).get("token");
    if (token) await revokeToken(server().rt._db.db, token);
  } catch {
    // RFC 7009: never reveal whether a token existed
  }
  return json({});
}

function rpcError(status: number, message: string): Response {
  return json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, status);
}

/** The MCP endpoint. Bearer token only; cookies are never read. */
export async function handleMcp(req: Request): Promise<Response> {
  const g = guard(req);
  if ("response" in g) return g.response;
  if (!isOriginAllowed(req.headers.get("origin"))) return rpcError(403, "This origin is not allowed.");
  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return unauthorizedResponse(g.base);
  const { rt } = server();
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const session = await authenticateAgent(rt, token, requestId);
    return await handleMcpRequest(rt, session, req);
  } catch (err) {
    if (err instanceof AgentAccessError) {
      return err.reason === "invalid_token" ? unauthorizedResponse(g.base, err.message) : rpcError(err.status, err.message);
    }
    server().log.error({ err, requestId }, "mcp request failed");
    return rpcError(500, "Something went wrong on our side. Try again in a moment.");
  }
}

export interface SetupCheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The "Check my setup" self-test: the things Claude needs from us, checked in-process (no outbound request).
 * It catches the usual connection failures before a merchant does.
 */
export async function runSetupCheck(): Promise<{ ok: boolean; checks: SetupCheckItem[] }> {
  const base = aiBase();
  const checks: SetupCheckItem[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  if (!base) {
    add("configured", "Sign-in is configured", false, "BETTER_AUTH_URL is not set on this server.");
    return { ok: false, checks };
  }
  add("https", "The address uses https", base.startsWith("https://") || /^http:\/\/localhost(:\d+)?$/.test(base), base.startsWith("https://") ? "https is used." : "Claude needs https on a public address. This is fine only for local testing.");
  const resource = protectedResourceMetadata(base);
  const meta = authorizationServerMetadata(base);
  add("resource", "The connector address is published", resource.resource === mcpResourceUrl(base), `Resource: ${resource.resource}`);
  add("issuer", "The sign-in server matches", meta.issuer === base && resource.authorization_servers[0] === meta.issuer, `Issuer: ${meta.issuer}`);
  add("pkce", "Secure sign-in (PKCE S256) is required", meta.code_challenge_methods_supported.join() === "S256", "S256 only.");
  add("registration", "Apps can register themselves", Boolean(meta.registration_endpoint) && meta.client_id_metadata_document_supported === true, "Dynamic registration and client metadata documents are on.");
  const challenge = unauthorizedResponse(base);
  const header = challenge.headers.get("www-authenticate") ?? "";
  add("challenge", "Unsigned requests get a clear 401", challenge.status === 401 && /resource_metadata="https?:\/\//.test(header), "The 401 carries an absolute metadata address.");
  return { ok: checks.every((c) => c.ok), checks };
}
