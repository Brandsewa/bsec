/**
 * Integration: categories, collections, blog, website pages, menus and redirects through the AI tools on a real Postgres
 * (ADR-050, docs/MCP-CONTENT-MAP.md): create, edit, publish rules, the delete cell (only hidden items, with confirm), the
 * safe-content rules and the audit trail.
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
  createProduct,
  createRuntime,
  exchangeAuthorizationCode,
  getPage,
  listAiChanges,
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
let ctx: TenantContext;

async function sessionFor(): Promise<AgentSession> {
  const db = rtWeb._db.db;
  const client = await registerOAuthClient(db, { client_name: "Claude", redirect_uris: [REDIRECT] });
  const verifier = randomBytes(48).toString("base64url");
  const { requestId } = await createAuthorizationRequest(db, BASE, { responseType: "code", clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256", state: undefined, scope: undefined, resource: undefined });
  const { redirectTo } = await approveAuthorizationRequest(rtWeb, ctx, requestId);
  const tokens = await exchangeAuthorizationCode(db, BASE, { code: new URL(redirectTo).searchParams.get("code")!, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier, resource: undefined });
  return authenticateAgent(rtWeb, tokens.access_token, "req-ct");
}

const ALL = { read: true, write: true, delete: true };
/** Sets the matrix and the publishing switch and returns a fresh session that sees them. */
async function sessionWith(matrix: object, allowPublishing = false): Promise<AgentSession> {
  await updateAiSettings(rtWeb, ctx, { matrix, allowPublishing });
  return sessionFor();
}
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
  const t = await provisionTenant(rtPlatform, { storeName: "CT", slug: `ct-${RUN}`, planCode: "growth", owner: { email: `ct-${RUN}@test.com`, name: "Owner" }, source: "platform_admin" });
  ctx = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-ct" };
  await updateAiSettings(rtWeb, ctx, { enabled: true, acceptConsentVersion: AI_CONSENT_VERSION, readOnlyPreset: true });
  for (const key of ["ai_calls_min_conn", "ai_calls_min_store", "ai_writes_min_store"]) await setQuotaOverrideForTest(rtPlatform, t.tenantId, key, 10_000);
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("permissions of the new rows", () => {
  it("offers none of the content tools until their own row is switched on", async () => {
    const s = await sessionWith({ products: { read: true } });
    expect(fail(await run(s, "list_blog_posts")).code).toBe("forbidden");
    expect(fail(await run(s, "list_pages")).code).toBe("forbidden");
    expect(fail(await run(s, "list_redirects")).code).toBe("forbidden");
    expect(fail(await run(s, "get_category", { id: "00000000-0000-4000-8000-000000000000" })).code).toBe("forbidden");
  });

  it("a read row cannot write, and a write row cannot delete", async () => {
    const s = await sessionWith({ blog: { read: true }, redirects: { read: true, write: true } });
    expect(fail(await run(s, "create_blog_post", { title: "x" })).code).toBe("forbidden");
    ok(await run(s, "create_redirect", { from: `/a-${RUN}`, to: "/b" }));
    const list = ok<{ items: Array<{ id: string }> }>(await run(s, "list_redirects", {}));
    expect(fail(await run(s, "delete_redirect", { id: list.items[0]!.id, confirm: true })).code).toBe("forbidden");
  });
});

describe("categories", () => {
  it("creates inactive, edits, needs the publishing switch to show, and deletes only a hidden empty category", async () => {
    const s = await sessionWith({ categories: ALL, products: { read: true, write: true } });
    const parent = ok<{ id: string; isActive: boolean }>(await run(s, "create_category", { name: `Lighting ${RUN}`, description: "All lamps", seoTitle: "Lamps" }));
    expect(parent.isActive).toBe(false);
    const child = ok<{ id: string; parentId: string }>(await run(s, "create_category", { name: `Desk ${RUN}`, parentId: parent.id }));
    expect(child.parentId).toBe(parent.id);

    expect(fail(await run(s, "update_category", { id: child.id, isActive: true })).code).toBe("forbidden");
    const edited = ok<{ name: string; seoTitle: string; description: string }>(await run(s, "update_category", { id: parent.id, name: `Lights ${RUN}`, description: "" }));
    expect(edited.name).toBe(`Lights ${RUN}`);
    expect(edited.seoTitle).toBe("Lamps");
    expect(edited.description).toBeUndefined();

    expect(fail(await run(s, "delete_category", { id: child.id })).code).toBe("invalid_input"); // no confirm
    expect(fail(await run(s, "delete_category", { id: parent.id, confirm: true })).message).toMatch(/subcategor/i);
    ok(await run(s, "delete_category", { id: child.id, confirm: true }));
    ok(await run(s, "delete_category", { id: parent.id, confirm: true }));
    expect(fail(await run(s, "get_category", { id: parent.id })).code).toBe("not_found");
  });

  it("shows a category with the publishing switch on, then refuses to delete it while it is visible", async () => {
    const s = await sessionWith({ categories: ALL }, true);
    const c = ok<{ id: string }>(await run(s, "create_category", { name: `Live ${RUN}` }));
    expect(ok<{ isActive: boolean }>(await run(s, "update_category", { id: c.id, isActive: true })).isActive).toBe(true);
    expect(fail(await run(s, "delete_category", { id: c.id, confirm: true })).message).toMatch(/hide it first/i);
    ok(await run(s, "update_category", { id: c.id, isActive: false }));
    ok(await run(s, "delete_category", { id: c.id, confirm: true }));
  });
});

describe("collections", () => {
  it("edits every field, changes products by add, remove and replace, and deletes only an unpublished collection", async () => {
    const s = await sessionWith({ collections: ALL, products: { read: true } }, true);
    const p1 = await createProduct(rtWeb, ctx, { title: `CP1 ${RUN}`, slug: `cp1-${RUN}`, status: "draft", variants: [{ title: "Default", price: 1000, sku: `CP1-${RUN}` }] } as never);
    const p2 = await createProduct(rtWeb, ctx, { title: `CP2 ${RUN}`, slug: `cp2-${RUN}`, status: "draft", variants: [{ title: "Default", price: 2000, sku: `CP2-${RUN}` }] } as never);
    const id1 = (p1 as { id: string }).id;
    const id2 = (p2 as { id: string }).id;

    const col = ok<{ id: string; published: boolean }>(await run(s, "create_collection", { title: `Gifts ${RUN}`, description: "Nice things", sortOrder: "price_asc", indexable: false, productIds: [id1] }));
    expect(col.published).toBe(false);
    expect(ok<{ productCount: number }>(await run(s, "set_collection_products", { id: col.id, mode: "add", productIds: [id2] })).productCount).toBe(2);
    expect(ok<{ productCount: number }>(await run(s, "set_collection_products", { id: col.id, mode: "remove", productIds: [id1] })).productCount).toBe(1);
    expect(ok<{ productCount: number }>(await run(s, "set_collection_products", { id: col.id, mode: "replace", productIds: [id1, id2] })).productCount).toBe(2);

    const upd = ok<{ sortOrder: string; indexable: boolean; slug: string }>(await run(s, "update_collection", { id: col.id, slug: `gifts-${RUN}`, sortOrder: "title_asc", published: true }));
    expect(upd).toMatchObject({ sortOrder: "title_asc", slug: `gifts-${RUN}` });
    expect(upd.indexable).toBe(false);
    expect(fail(await run(s, "delete_collection", { id: col.id, confirm: true })).message).toMatch(/unpublish it first/i);
    ok(await run(s, "update_collection", { id: col.id, published: false }));
    ok(await run(s, "delete_collection", { id: col.id, confirm: true }));
    expect(fail(await run(s, "get_collection", { id: col.id })).code).toBe("not_found");
  });

  it("will not change the products of an automated collection by hand", async () => {
    const s = await sessionWith({ collections: ALL });
    const col = ok<{ id: string; type: string }>(await run(s, "create_collection", { title: `Auto ${RUN}`, type: "automated", match: "any", rules: [{ field: "tag", operator: "equals", value: "sale" }] }));
    expect(col.type).toBe("automated");
    expect(fail(await run(s, "set_collection_products", { id: col.id, mode: "add", productIds: ["00000000-0000-4000-8000-000000000001"] })).message).toMatch(/rules/i);
  });
});

describe("blog", () => {
  it("writes a draft, strips unsafe HTML, needs the switch to publish, schedules, unpublishes, copies and deletes only drafts", async () => {
    let s = await sessionWith({ blog: ALL });
    const cat = ok<{ id: string }>(await run(s, "create_blog_category", { name: `News ${RUN}` }));
    const post = ok<{ id: string; status: string; contentHtml: string }>(
      await run(s, "create_blog_post", { title: `Hello ${RUN}`, categoryId: cat.id, excerpt: "Short", contentHtml: '<h2>Welcome</h2><p>Text <strong>bold</strong></p><script>alert(1)</script><img src="x" onerror="alert(2)">' }),
    );
    expect(post.status).toBe("draft");
    expect(post.contentHtml).toContain("Welcome");
    expect(post.contentHtml).not.toMatch(/<script|onerror/i);

    expect(fail(await run(s, "publish_blog_post", { id: post.id })).code).toBe("forbidden");
    s = await sessionWith({ blog: ALL }, true);
    expect(ok<{ status: string }>(await run(s, "publish_blog_post", { id: post.id })).status).toBe("published");
    expect(fail(await run(s, "delete_blog_post", { id: post.id, confirm: true })).message).toMatch(/unpublish it first/i);

    const edited = ok<{ title: string; status: string; excerpt: string }>(await run(s, "update_blog_post", { id: post.id, title: `Hello again ${RUN}`, excerpt: "Shorter" }));
    expect(edited).toMatchObject({ title: `Hello again ${RUN}`, status: "published", excerpt: "Shorter" });

    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(ok<{ status: string }>(await run(s, "publish_blog_post", { id: post.id, publishAt: future })).status).toBe("scheduled");
    expect(ok<{ status: string }>(await run(s, "unpublish_blog_post", { id: post.id })).status).toBe("draft");

    const copy = ok<{ id: string; status: string }>(await run(s, "duplicate_blog_post", { id: post.id }));
    expect(copy.status).toBe("draft");
    const listed = ok<{ items: Array<{ id: string }> }>(await run(s, "list_blog_posts", { status: "draft" }));
    expect(listed.items.map((p) => p.id)).toEqual(expect.arrayContaining([post.id, copy.id]));

    ok(await run(s, "delete_blog_post", { id: copy.id, confirm: true }));
    ok(await run(s, "delete_blog_post", { id: post.id, confirm: true }));
    expect(fail(await run(s, "get_blog_post", { id: post.id })).code).toBe("not_found");

    ok(await run(s, "update_blog_category", { id: cat.id, name: `Updates ${RUN}` }));
    const tree = ok<Array<{ id: string; name: string }>>(await run(s, "list_blog_categories"));
    expect(tree.find((c) => c.id === cat.id)?.name).toBe(`Updates ${RUN}`);
    ok(await run(s, "delete_blog_category", { id: cat.id, confirm: true }));
  });
});

describe("website pages", () => {
  it("edits text and links as a draft, keeps the live page unchanged, publishes with the switch, and deletes only an unpublished page", async () => {
    let s = await sessionWith({ pages: ALL });
    const types = ok<Array<{ type: string; container: boolean }>>(await run(s, "list_block_types"));
    expect(types.map((t) => t.type)).toEqual(expect.arrayContaining(["Heading", "Text", "Button", "Section"]));
    expect(types.some((t) => t.type.startsWith("Mk"))).toBe(false);
    expect(JSON.stringify(ok(await run(s, "describe_block_type", { type: "Heading" })))).toContain("text");
    expect(fail(await run(s, "describe_block_type", { type: "MkHero" })).code).toBe("not_found");

    const page = ok<{ id: string; status: string }>(await run(s, "create_page", { title: `About ${RUN}`, slug: `about-${RUN}`, seoTitle: "About us" }));
    expect(page.status).toBe("draft");

    const section = ok<{ blockId: string }>(await run(s, "add_page_block", { pageId: page.id, type: "Section" }));
    const heading = ok<{ blockId: string }>(await run(s, "add_page_block", { pageId: page.id, type: "Heading", parentBlockId: section.blockId, props: { text: "Our story", level: "h1" } }));
    const text = ok<{ blockId: string }>(await run(s, "add_page_block", { pageId: page.id, type: "Text", parentBlockId: section.blockId, props: { text: "We make lamps." } }));
    const button = ok<{ blockId: string }>(await run(s, "add_page_block", { pageId: page.id, type: "Button", parentBlockId: section.blockId, props: { label: "Shop", href: "/collections/all" } }));

    ok(await run(s, "set_page_block_props", { pageId: page.id, blockId: text.blockId, props: { text: "We make warm lamps in Kolkata." } }));
    ok(await run(s, "set_page_block_props", { pageId: page.id, blockId: button.blockId, props: { label: "Shop lamps", href: "https://example.com/lamps", newTab: true } }));
    // Unsafe link: the block validation (the same one the page builder uses) refuses it.
    expect(fail(await run(s, "set_page_block_props", { pageId: page.id, blockId: button.blockId, props: { href: "javascript:alert(1)" } })).code).toBe("invalid_input");
    expect(fail(await run(s, "set_page_block_props", { pageId: page.id, blockId: section.blockId, props: { content: [] } })).message).toMatch(/nested blocks/i);
    expect(fail(await run(s, "add_page_block", { pageId: page.id, type: "MkHero" })).code).toBe("invalid_input");
    expect(fail(await run(s, "add_page_block", { pageId: page.id, type: "Text", parentBlockId: heading.blockId })).message).toMatch(/cannot hold/i);

    ok(await run(s, "move_page_block", { pageId: page.id, blockId: button.blockId, parentBlockId: section.blockId, position: 0 }));
    ok(await run(s, "set_page_block_hidden", { pageId: page.id, blockId: heading.blockId, hidden: true }));

    const outline = ok<{ blocks: Array<{ children: Array<{ id: string; type: string; hidden?: boolean; text?: string }> }> }>(await run(s, "get_page", { id: page.id }));
    expect(outline.blocks[0]!.children.map((c) => c.type)).toEqual(["Button", "Heading", "Text"]);
    expect(outline.blocks[0]!.children[1]).toMatchObject({ hidden: true, text: "Our story" });
    const full = ok<{ props: Record<string, unknown> }>(await run(s, "get_page_block", { pageId: page.id, blockId: button.blockId }));
    expect(full.props).toMatchObject({ label: "Shop lamps", href: "https://example.com/lamps" });

    // Nothing is live yet.
    expect(fail(await run(s, "publish_page", { id: page.id })).code).toBe("forbidden");
    s = await sessionWith({ pages: ALL }, true);
    expect((await getPage(rtWeb, ctx, { id: page.id })).publishedVersionId).toBeNull();
    expect(ok<{ status: string }>(await run(s, "publish_page", { id: page.id })).status).toBe("published");
    expect((await getPage(rtWeb, ctx, { id: page.id })).publishedVersionId).not.toBeNull();

    // Edit after publish: the draft moves on, the live page stays.
    ok(await run(s, "set_page_block_props", { pageId: page.id, blockId: text.blockId, props: { text: "Edited text" } }));
    const live = (await getPage(rtWeb, ctx, { id: page.id })).blocks as Array<{ props: { content: Array<{ id: string; props: { text?: string } }> } }>;
    expect(JSON.stringify(live)).toContain("warm lamps");
    expect(JSON.stringify(live)).not.toContain("Edited text");

    ok(await run(s, "remove_page_block", { pageId: page.id, blockId: heading.blockId, confirm: true }));
    expect(fail(await run(s, "remove_page_block", { pageId: page.id, blockId: heading.blockId, confirm: true })).message).toMatch(/not found/i);

    expect(fail(await run(s, "delete_page", { id: page.id, confirm: true })).message).toMatch(/unpublish it first/i);
    ok(await run(s, "unpublish_page", { id: page.id }));
    ok(await run(s, "delete_page", { id: page.id, confirm: true }));
    expect(fail(await run(s, "get_page", { id: page.id })).code).toBe("not_found");
  });

  it("publishing a page also needs the person who connected the app to hold theme.publish", async () => {
    const s = await sessionWith({ pages: ALL }, true);
    const page = ok<{ id: string }>(await run(s, "create_page", { title: `Perm ${RUN}`, slug: `perm-${RUN}` }));
    const limited: AgentSession = { ...s, ctx: { ...s.ctx, permissions: s.ctx.permissions.filter((p) => p !== "theme.publish") } };
    expect(fail(await run(limited, "publish_page", { id: page.id })).message).toMatch(/permission to publish website pages/i);
  });
});

describe("menus", () => {
  it("creates a menu, replaces its items with ids kept, and refuses to delete a menu that is used", async () => {
    let s = await sessionWith({ pages: ALL });
    const menu = ok<{ id: string; handle: string }>(await run(s, "create_menu", { name: `Promo ${RUN}`, handle: `promo-${RUN}`, items: [{ title: "Sale", url: "/collections/sale" }, { title: "Info", url: "", children: [{ title: "About", url: "/pages/about" }] }] }));
    const got = ok<{ items: Array<{ id: string; title: string; type: string; children?: unknown[] }> }>(await run(s, "get_menu", { handle: menu.handle }));
    expect(got.items.map((i) => i.title)).toEqual(["Sale", "Info"]);
    expect(got.items[0]!.id).toBeTruthy();
    expect(got.items[1]!.children).toHaveLength(1);

    // Editing a menu changes the live site at once, so it needs the publishing switch.
    expect(fail(await run(s, "update_menu", { id: menu.id, name: "Renamed" })).code).toBe("forbidden");
    s = await sessionWith({ pages: ALL }, true);
    const upd = ok<{ itemCount: number }>(await run(s, "update_menu", { id: menu.id, items: [{ ...got.items[0], title: "Sale now" }] }));
    expect(upd.itemCount).toBe(1);
    expect(fail(await run(s, "update_menu", { id: menu.id, items: [{ title: "Bad", url: "javascript:alert(1)" }] })).code).toBe("invalid_input");

    expect(ok<Array<{ handle: string }>>(await run(s, "list_menus")).map((m) => m.handle)).toContain(menu.handle);
    ok(await run(s, "delete_menu", { id: menu.id, confirm: true }));
  });
});

describe("redirects", () => {
  it("adds, edits and deletes a redirect, refusing loops, reserved paths and other sites", async () => {
    const s = await sessionWith({ redirects: ALL });
    const r = ok<{ id: string; status: number }>(await run(s, "create_redirect", { from: `/old-${RUN}`, to: `/new-${RUN}` }));
    expect(r.status).toBe(308);
    expect(fail(await run(s, "create_redirect", { from: `/old-${RUN}`, to: "/elsewhere" })).code).toBe("conflict");
    expect(fail(await run(s, "create_redirect", { from: `/new-${RUN}`, to: `/old-${RUN}` })).message).toMatch(/loop/i);
    expect(fail(await run(s, "create_redirect", { from: `/x-${RUN}`, to: "https://evil.example/" })).code).toBe("invalid_input");
    expect(fail(await run(s, "create_redirect", { from: `/y-${RUN}`, to: "//evil.example/" })).code).toBe("invalid_input");
    expect(fail(await run(s, "create_redirect", { from: "/cart", to: "/shop" })).code).toBe("invalid_input");

    const upd = ok<{ to: string; status: number }>(await run(s, "update_redirect", { id: r.id, to: `/newer-${RUN}`, status: 301 }));
    expect(upd).toMatchObject({ to: `/newer-${RUN}`, status: 301 });
    const list = ok<{ items: Array<{ id: string; from: string }> }>(await run(s, "list_redirects", { search: `old-${RUN}` }));
    expect(list.items.map((i) => i.id)).toContain(r.id);
    expect(fail(await run(s, "delete_redirect", { id: r.id })).code).toBe("invalid_input");
    ok(await run(s, "delete_redirect", { id: r.id, confirm: true }));
    expect(fail(await run(s, "delete_redirect", { id: r.id, confirm: true })).code).toBe("not_found");
  });
});

describe("audit", () => {
  it("records every change as made by the AI app", async () => {
    const changes = await listAiChanges(rtWeb, ctx, 200);
    const actions = new Set(changes.map((c) => c.action));
    for (const a of ["category.created", "collection.created", "blog.post.created", "page.created", "page.block.added", "page.published", "menu.created", "redirect.created", "redirect.deleted"]) expect(actions.has(a), a).toBe(true);
  });
});
