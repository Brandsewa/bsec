/**
 * Integration: the capability layer on a real Postgres (ADR-050): store isolation, the permission matrix, draft-only writes with an
 * audit trail that names the AI app, usage limits and the call log.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORE_PERMISSIONS } from "@bs/auth";
import { startTestDb, type TestDb } from "@bs/domain/test-support";
import {
  AI_CONSENT_VERSION,
  approveAuthorizationRequest,
  authenticateAgent,
  createAuthorizationRequest,
  createProduct,
  createRuntime,
  getProduct,
  listAiActivity,
  listAiChanges,
  exchangeAuthorizationCode,
  provisionTenant,
  registerOAuthClient,
  updateAiSettings,
  type AgentSession,
  type Runtime,
  type TenantContext,
} from "@bs/domain";
import { runCapability } from "../src/index.ts";

const RUN = randomBytes(3).toString("hex");
const BASE = "https://root.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let a: { tenantId: string; ownerId: string };
let b: { tenantId: string; ownerId: string };
let ctxA: TenantContext;
let ctxB: TenantContext;
let productA: string;
let productB: string;

const ctxFor = (t: { tenantId: string; ownerId: string }): TenantContext => ({ tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-cap" });

async function sessionFor(ctx: TenantContext): Promise<AgentSession> {
  const db = rtWeb._db.db;
  const client = await registerOAuthClient(db, { client_name: "Claude", redirect_uris: [REDIRECT] });
  const verifier = randomBytes(48).toString("base64url");
  const { requestId } = await createAuthorizationRequest(db, BASE, { responseType: "code", clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256", state: undefined, scope: undefined, resource: undefined });
  const { redirectTo } = await approveAuthorizationRequest(rtWeb, ctx, requestId);
  const tokens = await exchangeAuthorizationCode(db, BASE, { code: new URL(redirectTo).searchParams.get("code")!, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier, resource: undefined });
  return authenticateAgent(rtWeb, tokens.access_token, "req-cap");
}

const matrix = (m: object, allowPublishing = false) => updateAiSettings(rtWeb, ctxA, { matrix: m, allowPublishing });
const run = (s: AgentSession, name: string, input: unknown = {}) => runCapability(rtWeb, s, name, input);

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  a = await provisionTenant(rtPlatform, { storeName: "Cap A", slug: `cap-a-${RUN}`, planCode: "growth", owner: { email: `cap-a-${RUN}@test.com`, name: "A" }, source: "platform_admin" });
  b = await provisionTenant(rtPlatform, { storeName: "Cap B", slug: `cap-b-${RUN}`, planCode: "growth", owner: { email: `cap-b-${RUN}@test.com`, name: "B" }, source: "platform_admin" });
  ctxA = ctxFor(a);
  ctxB = ctxFor(b);
  await updateAiSettings(rtWeb, ctxA, { enabled: true, acceptConsentVersion: AI_CONSENT_VERSION, readOnlyPreset: true });
  productA = (await createProduct(rtWeb, ctxA, { title: "Alpha lamp", variants: [{ sku: `A-${RUN}`, title: "Default", price: 120000 }] })).id;
  productB = (await createProduct(rtWeb, ctxB, { title: "Beta lamp", variants: [{ sku: `B-${RUN}`, title: "Default", price: 130000 }] })).id;
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("read capabilities", () => {
  it("show only the connected store's data", async () => {
    await matrix({ products: { read: true } });
    const s = await sessionFor(ctxA);
    const list = await run(s, "list_products");
    expect(list.ok).toBe(true);
    const items = (list as { ok: true; data: { items: Array<{ id: string; title: string }> } }).data.items;
    expect(items.map((i) => i.id)).toContain(productA);
    expect(items.map((i) => i.id)).not.toContain(productB);
    const other = await run(s, "get_product", { id: productB }); // another store's product id
    expect(other.ok).toBe(false);
    expect((other as { ok: false; error: { code: string } }).error.code).toBe("not_found");
  });

  it("are refused when the matrix does not allow them, and the call is logged as denied", async () => {
    await matrix({ products: { read: true } });
    const s = await sessionFor(ctxA);
    const r = await run(s, "list_orders");
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string; message: string } }).error.message).toMatch(/has not allowed AI apps to read orders/);
    const log = await listAiActivity(rtWeb, ctxA, 50);
    expect(log.find((e) => e.tool === "list_orders")?.status).toBe("denied");
  });

  it("the overview lists only what is allowed", async () => {
    await matrix({ products: { read: true }, finance: { read: true } });
    const s = await sessionFor(ctxA);
    const r = (await run(s, "get_store_overview")) as { ok: true; data: { allowed: Record<string, string[]>; canPublish: boolean; counts: Record<string, unknown> } };
    expect(r.data.allowed).toEqual({ products: ["read"], finance: ["read"] });
    expect(r.data.canPublish).toBe(false);
    expect(Object.keys(r.data.counts)).toEqual(["products"]);
  });
});

describe("write capabilities", () => {
  it("create drafts, record who did it with before and after, and cannot publish without the extra switch", async () => {
    await matrix({ products: { read: true, write: true, delete: true } });
    const s = await sessionFor(ctxA);
    const created = (await run(s, "create_product", { title: "AI lamp", price: 99900, seoTitle: "AI lamp" })) as { ok: true; data: { id: string; status: string } };
    expect(created.ok).toBe(true);
    expect(created.data.status).toBe("draft");
    const id = created.data.id;

    const edited = (await run(s, "update_product", { id, seoDescription: "A lamp made by the AI test", tags: ["ai"] })) as { ok: true; data: { seoDescription: string } };
    expect(edited.data.seoDescription).toBe("A lamp made by the AI test");

    const rows = (await listAiChanges(rtWeb, ctxA, 50)).filter((c) => c.targetId === id).reverse();
    expect(rows.map((r) => r.action)).toEqual(["product.created", "product.updated"]);
    expect(rows[1]!.before).not.toBeNull();
    expect((rows[1]!.after as { seoDescription?: string }).seoDescription).toBe("A lamp made by the AI test");
    expect(rows[1]!.client).toBe("Claude");

    const refused = await run(s, "publish_product", { id });
    expect(refused.ok).toBe(false);
    expect((refused as { ok: false; error: { message: string } }).error.message).toMatch(/publish/);

    await matrix({ products: { read: true, write: true, delete: true } }, true);
    const s2 = await sessionFor(ctxA);
    const noCategory = await run(s2, "publish_product", { id });
    expect(noCategory.ok).toBe(false); // the store's own rule still applies: a primary category is required
    expect((noCategory as { ok: false; error: { message: string } }).error.message).toMatch(/category/i);

    const archived = (await run(s2, "archive_product", { id })) as { ok: true; data: { status: string } };
    expect(archived.data.status).toBe("archived"); // archived, never deleted
    expect((await getProduct(rtWeb, ctxA, { id })).status).toBe("archived"); // the row is still there
  });

  it("refuse writes when only read is on", async () => {
    await matrix({ products: { read: true } });
    const s = await sessionFor(ctxA);
    const r = await run(s, "create_product", { title: "Nope", price: 100 });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe("forbidden");
  });

  it("validate input and refuse HTML in text", async () => {
    await matrix({ products: { read: true, write: true } });
    const s = await sessionFor(ctxA);
    expect(((await run(s, "create_product", { title: "", price: -5 })) as { ok: false }).ok).toBe(false);
    const html = await run(s, "create_product", { title: "Lamp", price: 100, description: "<script>alert(1)</script>" });
    expect(html.ok).toBe(false);
    expect((html as { ok: false; error: { message: string } }).error.message).toMatch(/plain text/);
  });
});
