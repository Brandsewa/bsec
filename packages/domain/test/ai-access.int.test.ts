/**
 * Integration: AI access on a real Postgres (ADR-050): plan gate, consent, OAuth (PKCE, single-use codes, refresh rotation with
 * reuse detection), tokens resolving to one store, revoke, lifecycle, limits, RLS on the new tenant tables and the narrow grants on
 * the platform-scoped token tables.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  AI_CONSENT_VERSION,
  AgentAccessError,
  AgentRateLimitError,
  approveAuthorizationRequest,
  authenticateAgent,
  createAuthorizationRequest,
  createRuntime,
  enforceAgentLimits,
  exchangeAuthorizationCode,
  getAiSettings,
  listAiConnections,
  provisionTenant,
  registerOAuthClient,
  revokeAiConnection,
  rotateRefreshToken,
  updateAiSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

// A shared local test database keeps its rows between runs, so every run uses its own store names.
const RUN = randomBytes(3).toString("hex");
const BASE = "https://root.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let a: { tenantId: string; ownerId: string };
let b: { tenantId: string; ownerId: string };
let c: { tenantId: string; ownerId: string };
let ctxA: TenantContext;
let ctxB: TenantContext;
let ctxC: TenantContext;

function ctxFor(t: { tenantId: string; ownerId: string }, label: string): TenantContext {
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-ai-${label}` };
}

const pkce = () => {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Runs the whole connect flow for a store and returns the tokens plus the client id. */
async function connect(ctx: TenantContext, clientName = "Claude") {
  const db = rtWeb._db.db;
  const client = await registerOAuthClient(db, { client_name: clientName, redirect_uris: [REDIRECT] });
  const { verifier, challenge } = pkce();
  const { requestId } = await createAuthorizationRequest(db, BASE, {
    responseType: "code",
    clientId: client.client_id,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state: "s1",
    scope: undefined,
    resource: `${BASE}/api/mcp`,
  });
  const { redirectTo } = await approveAuthorizationRequest(rtWeb, ctx, requestId);
  const code = new URL(redirectTo).searchParams.get("code")!;
  const tokens = await exchangeAuthorizationCode(db, BASE, { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier, resource: undefined });
  return { client, tokens, code, verifier, requestId };
}

async function enable(ctx: TenantContext) {
  return updateAiSettings(rtWeb, ctx, { enabled: true, acceptConsentVersion: AI_CONSENT_VERSION, readOnlyPreset: true });
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  a = await provisionTenant(rtPlatform, { storeName: "AI A", slug: `ai-store-a-${RUN}`, planCode: "growth", owner: { email: `ai-a-${RUN}@test.com`, name: "A" }, source: "platform_admin" });
  b = await provisionTenant(rtPlatform, { storeName: "AI B", slug: `ai-store-b-${RUN}`, planCode: "growth", owner: { email: `ai-b-${RUN}@test.com`, name: "B" }, source: "platform_admin" });
  c = await provisionTenant(rtPlatform, { storeName: "AI C", slug: `ai-store-c-${RUN}`, planCode: "starter", owner: { email: `ai-c-${RUN}@test.com`, name: "C" }, source: "platform_admin" });
  ctxA = ctxFor(a, "a");
  ctxB = ctxFor(b, "b");
  ctxC = ctxFor(c, "c");
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("plan gate and consent", () => {
  it("refuses a store whose plan does not include AI access, and says so in the settings view", async () => {
    await expect(updateAiSettings(rtWeb, ctxC, { enabled: true, acceptConsentVersion: AI_CONSENT_VERSION })).rejects.toThrow(/Growth plan/);
    expect((await getAiSettings(rtWeb, ctxC)).entitled).toBe(false);
  });

  it("starts off, and switching on needs the current terms to be accepted", async () => {
    const before = await getAiSettings(rtWeb, ctxA);
    expect(before.enabled).toBe(false);
    expect(before.entitled).toBe(true);
    await expect(updateAiSettings(rtWeb, ctxA, { enabled: true })).rejects.toThrow(/Accept the AI access terms/);
    await expect(updateAiSettings(rtWeb, ctxA, { enabled: true, acceptConsentVersion: 99 })).rejects.toThrow(/terms changed/);
    const on = await enable(ctxA);
    expect(on.enabled).toBe(true);
    expect(on.consent.accepted).toBe(true);
    expect(on.matrix.finance).toEqual({ read: true });
  });

  it("records the consent and the change in the audit log, and turning off forgets the consent", async () => {
    const rows = await rtPlatform._db.db.execute<{ action: string }>(sql`SELECT action FROM audit_logs WHERE tenant_id = ${a.tenantId} AND action LIKE 'ai.%'`);
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toContain("ai.consent.accepted");
    expect(actions).toContain("ai.enabled");
    const off = await updateAiSettings(rtWeb, ctxA, { enabled: false });
    expect(off.enabled).toBe(false);
    expect(off.consent.accepted).toBe(false);
    await enable(ctxA); // asks again, accepted again
  });

  it("only a user with ai.manage can change it", async () => {
    const limited = { ...ctxA, permissions: ["products.read"] };
    await expect(getAiSettings(rtWeb, limited)).rejects.toThrow(/ai\.manage/);
    await expect(updateAiSettings(rtWeb, limited, { enabled: false })).rejects.toThrow(/ai\.manage/);
  });

  it("a platform support session can never change AI access", async () => {
    const support = { ...ctxA, actor: { type: "platform_support" as const, userId: a.ownerId, supportSessionId: "s" } };
    await expect(updateAiSettings(rtWeb, support, { enabled: false })).rejects.toThrow(/Forbidden/);
  });
});

describe("OAuth connect flow", () => {
  it("connects through PKCE and resolves the token to exactly one store, as the approving user", async () => {
    const { tokens } = await connect(ctxA);
    expect(tokens.access_token.startsWith("bsat_")).toBe(true);
    expect(tokens.refresh_token.startsWith("bsrt_")).toBe(true);
    const s = await authenticateAgent(rtWeb, tokens.access_token, "r1");
    expect(s.ctx.tenantId).toBe(a.tenantId);
    expect(s.ctx.actor).toMatchObject({ type: "agent", userId: a.ownerId });
    expect(s.settings.matrix.products).toEqual({ read: true });
    expect(s.ctx.permissions).toContain("products.read");
  });

  it("refuses approval when the store has not turned AI access on, or when the request is unknown", async () => {
    const db = rtWeb._db.db;
    const client = await registerOAuthClient(db, { client_name: "X", redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    const { requestId } = await createAuthorizationRequest(db, BASE, { responseType: "code", clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256", state: undefined, scope: undefined, resource: undefined });
    await expect(approveAuthorizationRequest(rtWeb, ctxB, requestId)).rejects.toThrow(/Turn on AI access/); // store B never enabled it
    await expect(approveAuthorizationRequest(rtWeb, ctxA, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/Not Found/);
  });

  it("validates the request: PKCE S256 only, registered redirect only, matching resource only", async () => {
    const db = rtWeb._db.db;
    const client = await registerOAuthClient(db, { client_name: "X", redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    const base = { responseType: "code", clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256", state: undefined, scope: undefined, resource: undefined };
    await expect(createAuthorizationRequest(db, BASE, { ...base, codeChallengeMethod: "plain" })).rejects.toThrow(/PKCE/);
    await expect(createAuthorizationRequest(db, BASE, { ...base, redirectUri: "https://evil.example/cb" })).rejects.toThrow(/redirect_uri/);
    await expect(createAuthorizationRequest(db, BASE, { ...base, resource: "https://other.example/mcp" })).rejects.toThrow(/resource/);
    await expect(createAuthorizationRequest(db, BASE, { ...base, responseType: "token" })).rejects.toThrow(/response_type/);
    await expect(registerOAuthClient(db, { client_name: "Evil", redirect_uris: ["https://evil.example/cb"] })).rejects.toThrow(/not allowed/);
  });

  it("checks the code verifier, and a code works once; replaying it revokes the connection", async () => {
    const db = rtWeb._db.db;
    const client = await registerOAuthClient(db, { client_name: "Claude", redirect_uris: [REDIRECT] });
    const { verifier, challenge } = pkce();
    const { requestId } = await createAuthorizationRequest(db, BASE, { responseType: "code", clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256", state: undefined, scope: undefined, resource: undefined });
    const { redirectTo } = await approveAuthorizationRequest(rtWeb, ctxA, requestId);
    const code = new URL(redirectTo).searchParams.get("code")!;
    const p = { code, clientId: client.client_id, redirectUri: REDIRECT, resource: undefined };
    await expect(exchangeAuthorizationCode(db, BASE, { ...p, codeVerifier: "x".repeat(60) })).rejects.toThrow(/verifier/);
    const tokens = await exchangeAuthorizationCode(db, BASE, { ...p, codeVerifier: verifier });
    await expect(exchangeAuthorizationCode(db, BASE, { ...p, codeVerifier: verifier })).rejects.toThrow(/already used/);
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toBeInstanceOf(AgentAccessError);
  });

  it("rotates refresh tokens, and reusing an old one revokes the connection", async () => {
    const db = rtWeb._db.db;
    const { tokens, client } = await connect(ctxA);
    const next = await rotateRefreshToken(db, tokens.refresh_token, client.client_id);
    expect(next.refreshToken).not.toBe(tokens.refresh_token);
    await authenticateAgent(rtWeb, next.accessToken, "r"); // the new access token works
    await expect(rotateRefreshToken(db, tokens.refresh_token, client.client_id)).rejects.toThrow(/not valid/);
    await expect(authenticateAgent(rtWeb, next.accessToken, "r")).rejects.toBeInstanceOf(AgentAccessError); // the whole chain is dead
    const list = await listAiConnections(rtWeb, ctxA);
    expect(list.find((x) => x.id && x.clientName === "Claude" && x.status === "active")).toBeDefined(); // other connections are untouched
  });

  it("a refresh token cannot be used by a different app", async () => {
    const { tokens } = await connect(ctxA);
    await expect(rotateRefreshToken(rtWeb._db.db, tokens.refresh_token, "bsc_someone_else")).rejects.toThrow(/different app/);
  });
});

describe("connections, revoke and lifecycle", () => {
  it("lists only this store's connections, and revoke stops the token at once", async () => {
    const { tokens } = await connect(ctxA, "Revoke me");
    const mine = (await listAiConnections(rtWeb, ctxA)).find((x) => x.clientName === "Revoke me")!;
    expect((await listAiConnections(rtWeb, ctxB)).find((x) => x.id === mine.id)).toBeUndefined();
    await authenticateAgent(rtWeb, tokens.access_token, "r");
    await expect(revokeAiConnection(rtWeb, ctxB, mine.id)).rejects.toThrow(/Not Found/); // another store cannot revoke it
    await revokeAiConnection(rtWeb, ctxA, mine.id);
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("turning AI access off, or a new consent version, blocks calls until accepted", async () => {
    const { tokens } = await connect(ctxA);
    await authenticateAgent(rtWeb, tokens.access_token, "r");
    await updateAiSettings(rtWeb, ctxA, { enabled: false });
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toMatchObject({ reason: "ai_disabled" });
    await enable(ctxA);
    await authenticateAgent(rtWeb, tokens.access_token, "r"); // the connection resumes
    await withTenant(rtPlatform._db.db, a.tenantId, (tx) => tx.update(schema.storeAiSettings).set({ consentVersion: AI_CONSENT_VERSION - 1 }));
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toMatchObject({ reason: "consent_required" });
    await updateAiSettings(rtWeb, ctxA, { acceptConsentVersion: AI_CONSENT_VERSION });
    await authenticateAgent(rtWeb, tokens.access_token, "r");
  });

  it("a changed matrix applies on the very next call", async () => {
    const { tokens } = await connect(ctxA);
    await updateAiSettings(rtWeb, ctxA, { matrix: { products: { read: true, write: true } }, allowPublishing: true });
    const s = await authenticateAgent(rtWeb, tokens.access_token, "r");
    expect(s.settings.matrix).toEqual({ products: { read: true, write: true } });
    expect(s.settings.allowPublishing).toBe(true);
    await updateAiSettings(rtWeb, ctxA, { readOnlyPreset: true, allowPublishing: false });
  });

  it("the global kill switch blocks every store", async () => {
    const { tokens } = await connect(ctxA);
    await rtPlatform._db.db.execute(sql`UPDATE feature_flags SET kill_switch = true WHERE key = 'ai_access'`);
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toMatchObject({ reason: "kill_switch" });
    await rtPlatform._db.db.execute(sql`UPDATE feature_flags SET kill_switch = false WHERE key = 'ai_access'`);
    await authenticateAgent(rtWeb, tokens.access_token, "r");
  });

  it("a plan downgrade pauses access, and an upgrade brings it back", async () => {
    const { tokens } = await connect(ctxB.tenantId === b.tenantId ? await enableAndReturn(ctxB) : ctxB);
    await authenticateAgent(rtWeb, tokens.access_token, "r");
    await rtPlatform._db.db.execute(sql`UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE tenant_id = ${b.tenantId}`);
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toMatchObject({ reason: "plan_not_included" });
    await rtPlatform._db.db.execute(sql`UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'growth') WHERE tenant_id = ${b.tenantId}`);
    await authenticateAgent(rtWeb, tokens.access_token, "r");
  });

  it("a person who left the store takes their connections with them", async () => {
    const { tokens } = await connect(ctxA);
    await authenticateAgent(rtWeb, tokens.access_token, "r");
    await rtPlatform._db.db.execute(sql`UPDATE memberships SET status = 'suspended' WHERE tenant_id = ${a.tenantId} AND user_id = ${a.ownerId}`);
    await expect(authenticateAgent(rtWeb, tokens.access_token, "r")).rejects.toMatchObject({ reason: "user_removed" });
    await rtPlatform._db.db.execute(sql`UPDATE memberships SET status = 'active' WHERE tenant_id = ${a.tenantId} AND user_id = ${a.ownerId}`);
  });
});

async function enableAndReturn(ctx: TenantContext): Promise<TenantContext> {
  await enable(ctx);
  return ctx;
}

describe("usage limits", () => {
  it("answers with a plain wait time once the per-minute limit is used up", async () => {
    const { tokens } = await connect(ctxA);
    const s = await authenticateAgent(rtWeb, tokens.access_token, "r");
    await rtPlatform._db.db.execute(sql`INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES (${a.tenantId}, 'ai_calls_min_conn', 2) ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 2`);
    await enforceAgentLimits(rtWeb._db.db, s, "read");
    await enforceAgentLimits(rtWeb._db.db, s, "read");
    const err = await enforceAgentLimits(rtWeb._db.db, s, "read").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentRateLimitError);
    expect((err as AgentRateLimitError).retryAfter).toBeGreaterThan(0);
    expect((err as AgentRateLimitError).message).toMatch(/too fast|resets in/);
    await rtPlatform._db.db.execute(sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${a.tenantId} AND quota_key = 'ai_calls_min_conn'`);
  });

  it("a quota of zero blocks the call outright (not entitled)", async () => {
    const { tokens } = await connect(ctxA);
    const s = await authenticateAgent(rtWeb, tokens.access_token, "r");
    await rtPlatform._db.db.execute(sql`INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES (${a.tenantId}, 'ai_calls_day_store', 0) ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 0`);
    await expect(enforceAgentLimits(rtWeb._db.db, s, "read")).rejects.toBeInstanceOf(AgentRateLimitError);
    await rtPlatform._db.db.execute(sql`DELETE FROM tenant_quota_overrides WHERE tenant_id = ${a.tenantId} AND quota_key = 'ai_calls_day_store'`);
  });
});

describe("database isolation and grants", () => {
  it("the new tenant tables are isolated by row level security", async () => {
    const db = rtWeb._db.db;
    const none = await db.execute(sql`SELECT count(*)::int AS n FROM agent_connections`); // no tenant context set
    expect((none.rows[0] as { n: number }).n).toBe(0);
    const aRows = await withTenant(db, a.tenantId, (tx) => tx.select().from(schema.agentConnections));
    const bRows = await withTenant(db, b.tenantId, (tx) => tx.select().from(schema.agentConnections));
    expect(aRows.length).toBeGreaterThan(0);
    expect(aRows.every((r) => r.tenantId === a.tenantId)).toBe(true);
    expect(bRows.every((r) => r.tenantId === b.tenantId)).toBe(true);
    const settingsRows = await withTenant(db, a.tenantId, (tx) => tx.select().from(schema.storeAiSettings));
    expect(settingsRows).toHaveLength(1);
    await expect(withTenant(db, b.tenantId, (tx) => tx.insert(schema.storeAiSettings).values({ tenantId: a.tenantId }))).rejects.toThrow(); // cannot write another store's row
  });

  it("the runtime role can use the token tables but cannot rewrite what a token is", async () => {
    const db = rtWeb._db.db;
    /** drizzle wraps driver errors; the Postgres message is on `cause`. */
    const denied = async (q: ReturnType<typeof sql>) => {
      const err = (await db.execute(q).then(() => null, (e: unknown) => e)) as { message?: string; cause?: { message?: string } } | null;
      expect(`${err?.cause?.message ?? ""} ${err?.message ?? ""}`).toMatch(/permission denied/);
    };
    await denied(sql`UPDATE agent_tokens SET token_hash = 'x'`);
    await denied(sql`UPDATE agent_tokens SET tenant_id = tenant_id`);
    await denied(sql`UPDATE oauth_clients SET id = id`);
    await denied(sql`UPDATE oauth_authorization_requests SET client_id = client_id`);
    await expect(db.execute(sql`UPDATE agent_tokens SET revoked_at = now() WHERE false`)).resolves.toBeDefined(); // allowed: revoke
  });

  it("tokens are stored only as hashes", async () => {
    const { tokens } = await connect(ctxA);
    const found = await rtPlatform._db.db.execute(sql`SELECT count(*)::int AS n FROM agent_tokens WHERE token_hash = ${tokens.access_token} OR token_hash = ${tokens.refresh_token}`);
    expect((found.rows[0] as { n: number }).n).toBe(0);
  });
});
