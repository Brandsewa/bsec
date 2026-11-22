/**
 * Integration: the whole product through the AI tools on a real Postgres (ADR-050): create with options and variants, edit every
 * field, variants, options, collections, status, plain-words errors, the delete cell, and the formatted-description guard.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORE_PERMISSIONS } from "@bs/auth";
import { setQuotaOverrideForTest, startTestDb, type TestDb } from "@bs/domain/test-support";
import {
  AI_CONSENT_VERSION,
  approveAuthorizationRequest,
  authenticateAgent,
  createAuthorizationRequest,
  createCategory,
  createCollection,
  createRuntime,
  exchangeAuthorizationCode,
  listAiChanges,
  provisionTenant,
  registerOAuthClient,
  updateAiSettings,
  updateProduct,
  type AgentSession,
  type Runtime,
  type TenantContext,
} from "@bs/domain";
import { runCapability } from "../src/index.ts";

const RUN = randomBytes(3).toString("hex");
const BASE = "https://root.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const NONE = "00000000-0000-4000-8000-000000000000";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;

async function sessionFor(): Promise<AgentSession> {
  const db = rtWeb._db.db;
  const client = await registerOAuthClient(db, { client_name: "Claude", redirect_uris: [REDIRECT] });
  const verifier = randomBytes(48).toString("base64url");
  const { requestId } = await createAuthorizationRequest(db, BASE, { responseType: "code", clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256", state: undefined, scope: undefined, resource: undefined });
  const { redirectTo } = await approveAuthorizationRequest(rtWeb, ctx, requestId);
  const tokens = await exchangeAuthorizationCode(db, BASE, { code: new URL(redirectTo).searchParams.get("code")!, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier, resource: undefined });
  return authenticateAgent(rtWeb, tokens.access_token, "req-pf");
}

const matrix = (m: object, allowPublishing = false) => updateAiSettings(rtWeb, ctx, { matrix: m, allowPublishing });
const run = (s: AgentSession, name: string, input: unknown = {}) => runCapability(rtWeb, s, name, input);

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: { code: string; message: string } };
const ok = <T = Record<string, unknown>>(r: unknown): T => {
  const x = r as Ok<T> | Fail;
  if (!x.ok) throw new Error(`expected ok, got ${x.error.code}: ${x.error.message}`);
  return x.data;
};
const fail = (r: unknown): Fail["error"] => {
  const x = r as Ok<unknown> | Fail;
  if (x.ok) throw new Error("expected a failure");
  return x.error;
};

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rtPlatform, { storeName: "PF", slug: `pf-${RUN}`, planCode: "growth", owner: { email: `pf-${RUN}@test.com`, name: "Owner" }, source: "platform_admin" });
  ctx = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-pf" };
  await updateAiSettings(rtWeb, ctx, { enabled: true, acceptConsentVersion: AI_CONSENT_VERSION, readOnlyPreset: true });
  // These tests run far faster than any chat; lift the per-minute limits so they test the tools, not the limits (limits have their own tests).
  for (const key of ["ai_calls_min_conn", "ai_calls_min_store", "ai_writes_min_store"]) await setQuotaOverrideForTest(rtPlatform, t.tenantId, key, 10_000);
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("the whole product through the tools", () => {
  it("creates a product with options and variants, edits every part, and publishes it", async () => {
    await matrix({ products: { read: true, write: true, delete: true } }, true);
    const s = await sessionFor();
    const category = await createCategory(rtWeb, ctx, { name: `Lamps ${RUN}` });
    const collection = await createCollection(rtWeb, ctx, { title: `Sale ${RUN}`, type: "manual", published: false });

    const created = ok<{ id: string; slug: string; options: Array<{ name: string; values: string[] }>; variantCount: number }>(
      await run(s, "create_product", {
        title: "Desk lamp",
        slug: `desk-lamp-${RUN}`,
        shortDescription: "A lamp",
        description: "Warm light for your desk",
        tags: ["lamp", "home"],
        productType: "Lighting",
        hsn: "9405",
        requiresShipping: true,
        isFeatured: true,
        primaryCategoryId: category.id,
        collectionIds: [collection.id],
        seoTitle: "Desk lamp",
        seoDescription: "Warm light",
        options: [{ name: "Size", values: ["S", "M"] }],
        variants: [
          { sku: `LAMP-S-${RUN}`, price: 150000, optionValues: { Size: "S" } },
          { sku: `LAMP-M-${RUN}`, price: 180000, optionValues: { Size: "M" } },
        ],
      }),
    );
    expect(created.slug).toBe(`desk-lamp-${RUN}`);
    expect(created.variantCount).toBe(2);
    expect(created.options).toEqual([{ name: "Size", values: ["S", "M"] }]);
    const id = created.id;

    // every product-level field edited, including clearing one
    const edited = ok<Record<string, unknown>>(
      await run(s, "update_product", { id, title: "Desk lamp Pro", slug: `desk-lamp-pro-${RUN}`, productType: "Lamps", isFeatured: false, returnable: false, hsn: null, tags: ["lamp"], seoTitle: "Pro lamp", description: "New copy" }),
    );
    expect(edited).toMatchObject({ title: "Desk lamp Pro", slug: `desk-lamp-pro-${RUN}`, productType: "Lamps", isFeatured: false, returnable: false, seoTitle: "Pro lamp", seoDescription: "Warm light", description: "New copy" });
    expect(edited.hsn).toBeUndefined();
    expect(edited.tags).toEqual(["lamp"]);

    // variants: add, edit, list, delete
    const added = ok<{ id: string }>(await run(s, "add_variant", { productId: id, sku: `LAMP-L-${RUN}`, title: "Large", price: 210000, optionValues: { Size: "L" }, barcode: "123", weightGrams: 900, dimensions: { lengthCm: 20, widthCm: 10, heightCm: 40 } }));
    const dup = fail(await run(s, "add_variant", { productId: id, sku: `LAMP-L-${RUN}`, title: "Again", price: 1 }));
    expect(dup.code).toBe("conflict");
    expect(dup.message).toMatch(/SKU/);
    const v = ok<Record<string, unknown>>(await run(s, "update_variant", { id: added.id, price: 199000, compareAtPrice: 250000, barcode: null, weightGrams: 950, trackInventory: false, allowBackorder: true, preorderEnabled: true, preorderShipsOn: "2027-01-15", preorderMessage: "Ships in January" }));
    expect(v).toMatchObject({ price: 199000, compareAtPrice: 250000, weightGrams: 950, trackInventory: false, allowBackorder: true });
    expect(v.barcode).toBeUndefined();
    expect(v).not.toHaveProperty("costPrice"); // cost is finance data: hidden without the finance cell
    const list = ok<{ items: unknown[]; total: number }>(await run(s, "list_variants", { productId: id, limit: 2 }));
    expect(list.total).toBe(3);
    expect(list.items).toHaveLength(2);
    ok(await run(s, "delete_variant", { id: added.id }));
    expect(ok<{ total: number }>(await run(s, "list_variants", { productId: id })).total).toBe(2);

    // options: add a second option; existing variants are kept
    const withColor = ok<{ variantCount: number }>(await run(s, "set_product_options", { productId: id, options: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Black"] }], defaultPrice: 150000 }));
    expect(withColor.variantCount).toBeGreaterThanOrEqual(2);

    // collections: add, remove, replace
    const second = await createCollection(rtWeb, ctx, { title: `New ${RUN}`, type: "manual", published: false });
    expect(ok<{ collectionIds: string[] }>(await run(s, "set_product_collections", { id, add: [second.id] })).collectionIds.sort()).toEqual([collection.id, second.id].sort());
    expect(ok<{ collectionIds: string[] }>(await run(s, "set_product_collections", { id, remove: [collection.id] })).collectionIds).toEqual([second.id]);
    expect(ok<{ collectionIds: string[] }>(await run(s, "set_product_collections", { id, replaceWith: [collection.id] })).collectionIds).toEqual([collection.id]);
    expect(fail(await run(s, "set_product_collections", { id, replaceWith: [], add: [collection.id] })).code).toBe("invalid_input");

    // publish (the switch is on), then archive
    expect(ok<{ status: string }>(await run(s, "publish_product", { id })).status).toBe("active");
    expect(ok<{ status: string }>(await run(s, "archive_product", { id })).status).toBe("archived");

    // the audit trail names each step
    const actions = (await listAiChanges(rtWeb, ctx, 100)).filter((c) => c.targetId === id).map((c) => c.action);
    expect(actions).toEqual(expect.arrayContaining(["product.created", "product.updated", "product.options_set", "product.collections_changed", "product.published", "product.archived"]));
  });

  it("explains a duplicate slug in plain words, and a missing product", async () => {
    await matrix({ products: { read: true, write: true } });
    const s = await sessionFor();
    ok(await run(s, "create_product", { title: "Dup one", slug: `dup-${RUN}`, price: 100 }));
    const clash = fail(await run(s, "create_product", { title: "Dup two", slug: `dup-${RUN}`, price: 100 }));
    expect(clash.code).toBe("conflict");
    expect(clash.message).toMatch(/slug/i);
    const other = ok<{ id: string }>(await run(s, "create_product", { title: "Dup three", price: 100 }));
    expect(fail(await run(s, "update_product", { id: other.id, slug: `dup-${RUN}` })).message).toMatch(/slug/i);
    expect(fail(await run(s, "update_product", { id: NONE, title: "x" })).code).toBe("not_found");
  });

  it("will not silently flatten a description formatted in the admin editor", async () => {
    await matrix({ products: { read: true, write: true } });
    const s = await sessionFor();
    const { id } = ok<{ id: string }>(await run(s, "create_product", { title: "Rich one", price: 100 }));
    await updateProduct(rtWeb, ctx, { id, descriptionJson: { v: 1, blocks: [{ type: "heading", text: "Care" }, { type: "paragraph", children: [{ text: "Wash cold" }] }] } });
    const read = ok<{ descriptionFormat: string; description: string }>(await run(s, "get_product", { id }));
    expect(read.descriptionFormat).toBe("rich");
    expect(read.description).toContain("Wash cold");
    expect(fail(await run(s, "update_product", { id, description: "Plain" })).code).toBe("conflict");
    expect(ok<{ descriptionFormat: string }>(await run(s, "update_product", { id, description: "Plain", confirmReplaceFormatting: true })).descriptionFormat).toBe("plain");
  });

  it("the delete cell controls deleting variants and images, separately from write", async () => {
    await matrix({ products: { read: true, write: true } });
    const s = await sessionFor();
    const made = ok<{ id: string; variants: Array<{ id: string }> }>(await run(s, "create_product", { title: "Del test", price: 100 }));
    const refused = fail(await run(s, "delete_variant", { id: made.variants[0]!.id }));
    expect(refused.code).toBe("forbidden");
    expect(refused.message).toMatch(/archive/);
    expect(fail(await run(s, "remove_product_image", { productId: made.id, productMediaId: NONE })).code).toBe("forbidden");
    await matrix({ products: { read: true, write: true, delete: true } });
    const s2 = await sessionFor();
    expect(fail(await run(s2, "delete_variant", { id: made.variants[0]!.id })).message).toMatch(/at least one variant/); // the store's own rule protects the last variant
  });

  it("checks image ids against the product", async () => {
    await matrix({ products: { read: true, write: true, delete: true } });
    const s = await sessionFor();
    const { id } = ok<{ id: string }>(await run(s, "create_product", { title: "Img test", price: 100 }));
    expect(fail(await run(s, "reorder_product_images", { productId: id, order: ["00000000-0000-4000-8000-000000000001"] })).code).toBe("invalid_input");
    expect(fail(await run(s, "add_product_image", { productId: id, mediaId: "00000000-0000-4000-8000-000000000002" })).code).toMatch(/not_found|invalid_input/);
  });
});
