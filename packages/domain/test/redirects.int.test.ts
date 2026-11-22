/**
 * Integration: store redirects (ADR-051) on a real database: the admin service (permissions, loops, reserved paths, import,
 * audit rows), isolation between stores, the storefront lookup, and the automatic redirect when a product, collection or
 * category address changes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client as PgClient } from "pg";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  clearRedirectCache,
  createMenu,
  createRedirect,
  createRuntime,
  deleteRedirect,
  findStoreRedirect,
  getLinkHealth,
  importRedirects,
  listRedirects,
  provisionTenant,
  updateCategory,
  updateCollection,
  updateProduct,
  updateRedirect,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let a: TenantContext;
let b: TenantContext;
let pg: PgClient;

const staff = (tenantId: string, userId: string, permissions: string[] = [...STORE_PERMISSIONS]): TenantContext =>
  ({ tenantId, storeStatus: "live", actor: { type: "staff", userId }, roles: ["store_owner"], permissions, requestId: "req-redirects" }) as TenantContext;

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 8 });
  const ta = await provisionTenant(rtPlatform, { storeName: "Redirect A", slug: "redirect-a", owner: { email: "a@redirect.test", name: "A" }, planCode: "growth", source: "platform_admin" });
  const tb = await provisionTenant(rtPlatform, { storeName: "Redirect B", slug: "redirect-b", owner: { email: "b@redirect.test", name: "B" }, planCode: "growth", source: "platform_admin" });
  a = staff(ta.tenantId, ta.ownerId);
  b = staff(tb.tenantId, tb.ownerId);
  const PG = (await import("pg")).default;
  pg = new PG.Client({ connectionString: env.superUrl });
  await pg.connect();
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

const auditActions = async (tenantId: string) =>
  ((await pg.query(`select action from audit_logs where tenant_id = $1 and target_type = 'redirect' order by created_at`, [tenantId])).rows as { action: string }[]).map((r) => r.action);

describe("creating, changing and deleting a redirect", () => {
  it("saves a normalised redirect, lists it and audits it", async () => {
    const r = await createRedirect(rtWeb, a, { from: "https://shop.example/Old-Tea/?utm=1", to: "/products/new-tea" });
    expect(r).toMatchObject({ fromPath: "/Old-Tea", toPath: "/products/new-tea", statusCode: 308, source: "manual" });
    const list = await listRedirects(rtWeb, a, { search: "old-tea" });
    expect(list.items.map((i) => i.fromPath)).toEqual(["/Old-Tea"]);
    expect(await auditActions(a.tenantId)).toContain("redirect.created");
  });

  it("refuses a duplicate source (case-insensitively), a reserved path, a self redirect and a bad status", async () => {
    await expect(createRedirect(rtWeb, a, { from: "/old-tea", to: "/elsewhere" })).rejects.toThrow(/Conflict.*already redirects/);
    await expect(createRedirect(rtWeb, a, { from: "/cart", to: "/shop" })).rejects.toThrow(/Bad Request.*cannot be redirected/);
    await expect(createRedirect(rtWeb, a, { from: "/", to: "/shop" })).rejects.toThrow(/home page/);
    await expect(createRedirect(rtWeb, a, { from: "/same", to: "/same/" })).rejects.toThrow(/itself/);
    await expect(createRedirect(rtWeb, a, { from: "/odd", to: "/x", status: 200 })).rejects.toThrow(/301, 302, 307 or 308/);
    await expect(createRedirect(rtWeb, a, { from: "/js", to: "javascript:alert(1)" })).rejects.toThrow(/valid destination/);
  });

  it("refuses a redirect that would loop", async () => {
    await createRedirect(rtWeb, a, { from: "/loop-a", to: "/loop-b" });
    await createRedirect(rtWeb, a, { from: "/loop-b", to: "/loop-c" });
    await expect(createRedirect(rtWeb, a, { from: "/loop-c", to: "/loop-a" })).rejects.toThrow(/loop/);
  });

  it("changes and deletes, and clears the storefront lookup at once in this process", async () => {
    const r = await createRedirect(rtWeb, a, { from: "/change-me", to: "/one" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/change-me")).toEqual({ to: "/one", status: 308 });
    await updateRedirect(rtWeb, a, r.id, { to: "/two", status: 301 });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/change-me")).toEqual({ to: "/two", status: 301 });
    await deleteRedirect(rtWeb, a, r.id);
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/change-me")).toBeNull();
    await expect(deleteRedirect(rtWeb, a, r.id)).rejects.toThrow(/Not Found/);
    expect(await auditActions(a.tenantId)).toEqual(expect.arrayContaining(["redirect.updated", "redirect.deleted"]));
  });

  it("needs the content.write permission", async () => {
    const reader = staff(a.tenantId, "00000000-0000-7000-8000-000000000001", ["products.read"]);
    await expect(createRedirect(rtWeb, reader, { from: "/nope", to: "/x" })).rejects.toThrow();
    await expect(listRedirects(rtWeb, reader)).rejects.toThrow();
  });
});

describe("importing redirects", () => {
  it("saves the good rows, reports the bad ones and audits one summary row", async () => {
    const before = (await auditActions(a.tenantId)).filter((x) => x === "redirect.imported").length;
    const res = await importRedirects(rtWeb, a, [
      { from: "/blogs/news/first", to: "/blog/first" },
      { from: "/blogs/news/second", to: "/blog/second", status: "301" },
      { from: "/cart", to: "/x" },
      { from: "/blogs/news/first", to: "/blog/dup" },
      { from: "/bad-status", to: "/x", status: 999 },
    ]);
    expect(res.created).toBe(2);
    expect(res.skipped).toBe(3);
    expect(res.results.filter((r) => !r.ok).map((r) => r.row)).toEqual([3, 4, 5]);
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/blogs/news/second")).toEqual({ to: "/blog/second", status: 301 });
    expect((await auditActions(a.tenantId)).filter((x) => x === "redirect.imported").length).toBe(before + 1);
  });

  it("refuses an empty or oversized import", async () => {
    await expect(importRedirects(rtWeb, a, [])).rejects.toThrow(/no rows/);
    await expect(importRedirects(rtWeb, a, Array.from({ length: 501 }, (_, i) => ({ from: `/m${i}`, to: "/x" })))).rejects.toThrow(/500/);
  });
});

describe("isolation between stores", () => {
  it("never shows or applies another store's redirects", async () => {
    await createRedirect(rtWeb, b, { from: "/only-b", to: "/b-target" });
    expect((await listRedirects(rtWeb, a, { search: "only-b" })).items).toHaveLength(0);
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/only-b")).toBeNull();
    expect(await findStoreRedirect(rtWeb, b.tenantId, "/only-b")).toEqual({ to: "/b-target", status: 308 });
    // The same source path in both stores is fine.
    await createRedirect(rtWeb, a, { from: "/only-b", to: "/a-target" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/only-b")).toEqual({ to: "/a-target", status: 308 });
    expect(await findStoreRedirect(rtWeb, b.tenantId, "/only-b")).toEqual({ to: "/b-target", status: 308 });
  });

  it("matches a trailing slash and any letter case on lookup", async () => {
    await createRedirect(rtWeb, a, { from: "/Case-Test", to: "/lower" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/case-test/")).toEqual({ to: "/lower", status: 308 });
  });
});

describe("automatic redirects when an address changes", () => {
  it("redirects the old product address to the new one, re-points chains and removes a redirect that sat on the new address", async () => {
    const pid = crypto.randomUUID();
    await pg.query(`insert into products (id, tenant_id, title, slug, status) values ($1, $2, 'Auto Tea', 'auto-tea', 'draft')`, [pid, a.tenantId]);
    // An older rename already points at the current address; and a stale redirect sits on the address we are about to use.
    await createRedirect(rtWeb, a, { from: "/products/auto-tea-v0", to: "/products/auto-tea" });
    await createRedirect(rtWeb, a, { from: "/products/auto-tea-v2", to: "/somewhere" });
    await updateProduct(rtWeb, a, { id: pid, slug: "auto-tea-v2" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/products/auto-tea")).toEqual({ to: "/products/auto-tea-v2", status: 308 });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/products/auto-tea-v0")).toEqual({ to: "/products/auto-tea-v2", status: 308 });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/products/auto-tea-v2")).toBeNull();
    const row = (await pg.query(`select source from tenant_redirects where tenant_id = $1 and from_path = '/products/auto-tea'`, [a.tenantId])).rows[0] as { source: string };
    expect(row.source).toBe("auto");
  });

  it("does nothing when the address did not change, and keeps a manual redirect on the old address", async () => {
    const pid = crypto.randomUUID();
    await pg.query(`insert into products (id, tenant_id, title, slug, status) values ($1, $2, 'Keep Tea', 'keep-tea', 'draft')`, [pid, a.tenantId]);
    await createRedirect(rtWeb, a, { from: "/products/keep-tea", to: "/my-own-landing" });
    await updateProduct(rtWeb, a, { id: pid, title: "Keep Tea Renamed" });
    await updateProduct(rtWeb, a, { id: pid, slug: "keep-tea-2" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/products/keep-tea")).toEqual({ to: "/my-own-landing", status: 308 });
  });

  it("covers collections and categories", async () => {
    const colId = crypto.randomUUID();
    await pg.query(`insert into collections (id, tenant_id, title, slug, type, published, indexable) values ($1, $2, 'Old Col', 'old-col', 'manual', true, true)`, [colId, a.tenantId]);
    await updateCollection(rtWeb, a, { id: colId, slug: "new-col" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/collections/old-col")).toEqual({ to: "/collections/new-col", status: 308 });

    const catId = crypto.randomUUID();
    await pg.query(`insert into categories (id, tenant_id, name, slug, type) values ($1, $2, 'Old Cat', 'old-cat', 'manual')`, [catId, a.tenantId]);
    await updateCategory(rtWeb, a, { id: catId, slug: "new-cat" });
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/categories/old-cat")).toEqual({ to: "/categories/new-cat", status: 308 });
  });

  it("still reads the same after the in-process lookup is dropped (it is read from the database again)", async () => {
    clearRedirectCache(a.tenantId);
    expect(await findStoreRedirect(rtWeb, a.tenantId, "/collections/old-col")).toEqual({ to: "/collections/new-col", status: 308 });
  });
});

describe("link health (storefront audit phase 4)", () => {
  it("lists broken links from menus and published pages, and respects redirects and real pages", async () => {
    await pg.query(`insert into products (tenant_id, title, slug, status) values ($1, 'Real Tea', 'real-tea', 'draft')`, [a.tenantId]);
    await pg.query(
      `insert into menus (tenant_id, handle, title, kind, items) values ($1, 'lh-menu', 'Link menu', 'navigation', $2::jsonb)`,
      [a.tenantId, JSON.stringify([{ label: "Real", url: "/products/real-tea" }, { label: "Gone", url: "/products/missing-tea" }, { label: "Old", url: "/old-tea" }, { label: "Out", url: "https://example.com" }])],
    );
    const pageId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    await pg.query(`insert into pages (id, tenant_id, title, slug, type, status) values ($1, $2, 'Link page', 'link-page', 'custom', 'draft')`, [pageId, a.tenantId]);
    await pg.query(`insert into page_versions (id, tenant_id, page_id, document) values ($1, $2, $3, $4::jsonb)`, [
      versionId,
      a.tenantId,
      pageId,
      JSON.stringify({ version: 1, blocks: [{ id: "b1", type: "Hero", version: 1, props: { primaryHref: "/checkouts/cn/abc", secondaryHref: "/pages/link-page" } }] }),
    ]);
    await pg.query(`update pages set status = 'published', published_version_id = $1 where id = $2`, [versionId, pageId]);

    const view = await getLinkHealth(rtWeb, a);
    const found = view.problems.map((p) => `${p.where.type}:${p.kind}:${p.link}`).sort();
    expect(found).toEqual(["menu:broken:/products/missing-tea", "page:shopify_checkout:/checkouts/cn/abc"]);
    expect(view.scanned).toBeGreaterThanOrEqual(6);
    expect(view.truncated).toBe(false);
  });

  it("only reads this store's content", async () => {
    const other = await getLinkHealth(rtWeb, b);
    expect(other.problems.some((p) => p.link.includes("missing-tea"))).toBe(false);
  });

  it("saves a menu link to the store's preview address as a relative path", async () => {
    await createMenu(rtWeb, a, { name: "Tidy", handle: "tidy-menu", items: [{ label: "Tea", type: "url", url: "https://acme.bcom.si/products/real-tea?x=1", children: [{ label: "Sub", type: "url", url: "https://acme.bcom.si" }] }] });
    const row = (await pg.query(`select items from menus where tenant_id = $1 and handle = 'tidy-menu'`, [a.tenantId])).rows[0] as { items: Array<{ url: string; children: Array<{ url: string }> }> };
    expect(row.items[0]?.url).toBe("/products/real-tea?x=1");
    expect(row.items[0]?.children[0]?.url).toBe("/");
  });
});
