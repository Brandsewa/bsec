import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, ORPCError } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { platformContract } from "@bs/contracts";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createLogger, createRuntime, getPlatformSiteChrome, getPlatformSiteId, getPlatformSitePage, getPlatformSitePolicy, getPlatformSitePrivacy, getPlatformSiteStatus, getPublishedPolicy, platformSitePagesSitemap, provisionTenant, savePageDraft, type Runtime } from "@bs/domain";
import { platformRouter, type PlatformContext } from "../src/app.ts";

type Staff = { userId: string; freshSessionAt: Date };

let env: TestDb;
let rt: Runtime;
let rtRw: Runtime;
let admin: Staff;
let support: Staff;
let storeId: string;

const ctx = (who: Staff | null, contentRt: Runtime | undefined = rtRw): PlatformContext => ({
  rt,
  contentRt,
  log: createLogger("marketing-test"),
  session: who ? { user: { id: who.userId }, type: "platform_staff", createdAt: who.freshSessionAt } : null,
  meta: { ip: "203.0.113.7", userAgent: "vitest", requestId: "req-marketing" },
});

type Proc = Parameters<typeof call>[0];
const walk = (node: Record<string, unknown>, path: string[]): Array<{ path: string; proc: Proc }> =>
  Object.entries(node).flatMap(([k, v]) =>
    v && typeof v === "object" && "~orpc" in v ? [{ path: [...path, k].join("."), proc: v as Proc }] : walk(v as Record<string, unknown>, [...path, k]),
  );

const m = platformRouter.marketing as unknown as Record<string, unknown>;
const content = () => walk(Object.fromEntries(Object.entries(m).filter(([k]) => k !== "status" && k !== "enable")), ["marketing"]);
const run = (path: string, input: unknown, context: PlatformContext) => {
  const leaf = walk(m, ["marketing"]).find((l) => l.path === path);
  if (!leaf) throw new Error(`no procedure ${path}`);
  return call(leaf.proc, input as never, { context, path: path.split(".") } as never);
};
const codeOf = async (p: Promise<unknown>) => p.then(() => "OK", (e: unknown) => (e instanceof ORPCError ? e.code : `THROWN: ${String(e)}`));

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtRw = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 2 });
  admin = await seedPlatformStaff(rt._db.db, { email: "marketing-admin@platform.test", role: "platform_admin" });
  support = await seedPlatformStaff(rt._db.db, { email: "marketing-support@platform.test", role: "platform_support" });
  const slug = "marketing-other-store";
  storeId = (await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" })).tenantId;
}, 120_000);

afterAll(async () => {
  await rt?.close();
  await rtRw?.close();
  await env?.stop();
});

describe("Marketing access", () => {
  it("covers the whole content API", () => {
    const paths = content().map((c) => c.path);
    expect(paths).toContain("marketing.blog.posts.create");
    expect(paths).toContain("marketing.menus.update");
    expect(paths).toContain("marketing.media.requestUpload");
    expect(paths.length).toBeGreaterThan(30);
    expect(Object.keys(platformContract.marketing.blog)).toEqual(["categories", "posts", "settings"]);
  });

  it("refuses anonymous callers and support staff on every procedure", async () => {
    // Input is validated before the guard, so a procedure that needs input answers BAD_REQUEST here. No handler can skip
    // the guard: `context.content` only exists after it, so the compiler refuses a handler without one.
    const gated = (code: string, refused: string) => code === refused || code === "BAD_REQUEST";
    for (const { path, proc } of content()) {
      expect(gated(await codeOf(call(proc, undefined as never, { context: ctx(null) } as never)), "UNAUTHORIZED"), path).toBe(true);
      expect(gated(await codeOf(call(proc, undefined as never, { context: ctx(support) } as never)), "FORBIDDEN"), path).toBe(true);
    }
    expect(await codeOf(run("marketing.blog.posts.create", { title: "No", contentHtml: "<p>x</p>" }, ctx(support)))).toBe("FORBIDDEN");
    expect(await codeOf(run("marketing.menus.list", undefined, ctx(null)))).toBe("UNAUTHORIZED");
  });

  it("stays closed without the app_rw connection", async () => {
    const closed = { ...ctx(admin), contentRt: undefined };
    expect(await codeOf(run("marketing.menus.list", undefined, closed))).toBe("SERVICE_UNAVAILABLE");
    expect(await codeOf(run("marketing.enable", undefined, closed))).toBe("SERVICE_UNAVAILABLE");
  });

  it("asks for setup before the record exists", async () => {
    // Another file may have created the record already, so hide it for this check rather than rely on file order.
    const existing = await getPlatformSiteId(rt._db.db);
    if (existing) await rt._db.db.update(schema.tenants).set({ kind: "store" }).where(eq(schema.tenants.id, existing));
    try {
      expect(await codeOf(run("marketing.menus.list", undefined, ctx(admin)))).toBe("PRECONDITION_FAILED");
    } finally {
      if (existing) await rt._db.db.update(schema.tenants).set({ kind: "platform_site" }).where(eq(schema.tenants.id, existing));
    }
  });
});

describe("Marketing content", () => {
  let siteId: string;

  beforeAll(async () => {
    siteId = ((await run("marketing.enable", undefined, ctx(admin))) as { siteId: string }).siteId;
    await withTenant(rtRw._db.db, storeId, async (tx) => {
      await tx.insert(schema.blogPosts).values({ tenantId: storeId, title: "Store post", slug: "store-post", contentHtml: "<p>x</p>", contentText: "x", status: "draft" });
      await tx.insert(schema.pages).values({ tenantId: storeId, title: "Store page", slug: "store-page" } as never);
    });
  });

  it("a post lands on the website record, with both audit trails", async () => {
    const created = (await run("marketing.blog.posts.create", { title: "First post", contentHtml: "<p>Hello</p>" }, ctx(admin))) as { id: string };
    const site = await withTenant(rtRw._db.db, siteId, (tx) => tx.select().from(schema.blogPosts));
    expect(site.map((p) => p.id)).toContain(created.id);
    const tenantAudit = await rt._db.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = ${siteId} AND actor_id = ${admin.userId}`);
    expect(tenantAudit.rows[0]?.n).toBeGreaterThan(0);
    const staffAudit = await rt._db.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM platform_audit_logs WHERE action LIKE 'marketing.%' AND actor_user_id = ${admin.userId}`);
    expect(staffAudit.rows[0]?.n).toBe(1);
  });

  it("reads never include a store's rows", async () => {
    const posts = (await run("marketing.blog.posts.list", {}, ctx(admin))) as { items: Array<{ title: string }> };
    expect(posts.items.some((p) => p.title === "Store post")).toBe(false);
    expect(posts.items.some((p) => p.title === "First post")).toBe(true);
    const pages = (await run("marketing.pages.list", undefined, ctx(admin))) as Array<{ slug: string }>;
    expect(pages.some((p) => p.slug === "store-page")).toBe(false);
  });

  it("a request cannot choose the tenant", async () => {
    const created = (await run("marketing.blog.posts.create", { title: "Sneaky", contentHtml: "<p>x</p>", tenantId: storeId }, ctx(admin))) as { id: string };
    const store = await withTenant(rtRw._db.db, storeId, (tx) => tx.select().from(schema.blogPosts));
    expect(store.some((p) => p.id === created.id)).toBe(false);
  });

  it("a new About page starts from the built-in version, and goes live and back through publish", async () => {
    const page = (await run("marketing.pages.create", { title: "About us", slug: "about" }, ctx(admin))) as { id: string };
    const draft = (await run("marketing.pages.get", { id: page.id, draft: true }, ctx(admin))) as { blocks: Array<{ type: string }> };
    expect(draft.blocks[0]?.type).toBe("MkDocHeader");
    expect(await getPlatformSitePage(rtRw, ["about"])).toBeNull();

    await run("marketing.pages.publish", { id: page.id }, ctx(admin));
    expect((await getPlatformSitePage(rtRw, ["about"]))?.page.title).toBe("About us");

    await run("marketing.pages.unpublish", { id: page.id }, ctx(admin));
    expect(await getPlatformSitePage(rtRw, ["about"])).toBeNull();
    const audit = await rt._db.db.execute<{ action: string }>(sql`SELECT action FROM platform_audit_logs WHERE action LIKE 'marketing.pages.%' AND actor_user_id = ${admin.userId}`);
    expect(audit.rows.map((r) => r.action).sort()).toEqual(["marketing.pages.create", "marketing.pages.publish", "marketing.pages.unpublish"]);
  });

  it("a published page is in the sitemap, except About, which has its own URL", async () => {
    const page = (await run("marketing.pages.create", { title: "For brands", slug: "for-brands" }, ctx(admin))) as { id: string };
    const blocks = [{ id: "h", type: "MkDocHeader", version: 1, props: { title: "For brands" } }];
    await run("marketing.pages.saveDraft", { id: page.id, blocks }, ctx(admin));
    await run("marketing.pages.publish", { id: page.id }, ctx(admin));
    const urls = (await platformSitePagesSitemap(rtRw._db.db, "https://x.test")).map((u) => u.loc);
    expect(urls).toContain("https://x.test/pages/for-brands");
    expect(urls.some((u) => u.endsWith("/about"))).toBe(false);
  });

  it("the website takes only website sections, and a store cannot use them", async () => {
    const page = (await run("marketing.pages.create", { title: "Mixed", slug: "mixed" }, ctx(admin))) as { id: string };
    const store = [{ id: "s", type: "ProductShowcase", version: 1, props: {} }];
    expect(String(await codeOf(run("marketing.pages.saveDraft", { id: page.id, blocks: store }, ctx(admin))))).not.toBe("OK");

    const [storePage] = await withTenant(rtRw._db.db, storeId, (tx) => tx.select().from(schema.pages));
    const storeCtx = { tenantId: storeId, storeStatus: "live", actor: { type: "system" as const }, roles: [], permissions: ["content.write"], requestId: "t" };
    await expect(savePageDraft(rtRw, storeCtx as never, { id: storePage!.id, blocks: [{ id: "m", type: "MkDocHeader", version: 1, props: { title: "Sneaky" } }] })).rejects.toThrow(/platform's website/);
  });

  it("takes the generic widgets, and the header and footer pages hold only their own blocks", async () => {
    const page = (await run("marketing.pages.create", { title: "Widgets", slug: "widgets" }, ctx(admin))) as { id: string };
    const ok = [{ id: "h", type: "Heading", version: 1, props: { text: "Hello" } }];
    await run("marketing.pages.saveDraft", { id: page.id, blocks: ok }, ctx(admin));

    const header = (await run("marketing.pages.ensureChrome", { key: "header" }, ctx(admin))) as { id: string; created: boolean };
    expect(header.created).toBe(true);
    expect(((await run("marketing.pages.ensureChrome", { key: "header" }, ctx(admin))) as { id: string; created: boolean })).toEqual({ id: header.id, created: false });
    const draft = (await run("marketing.pages.get", { id: header.id, draft: true }, ctx(admin))) as { blocks: Array<{ type: string }> };
    expect(draft.blocks.map((b) => b.type)).toEqual(["MkHeader"]);
    expect(await getPlatformSiteChrome(rtRw._db.db)).toMatchObject({ header: null });
    await run("marketing.pages.publish", { id: header.id }, ctx(admin));
    expect((await getPlatformSiteChrome(rtRw._db.db)).header?.brand).toBe("BCOM");

    const footer = (await run("marketing.pages.ensureChrome", { key: "footer" }, ctx(admin))) as { id: string };
    await run("marketing.pages.publish", { id: footer.id }, ctx(admin));
    expect((await getPlatformSiteChrome(rtRw._db.db)).footer?.columns.length).toBe(3);
    expect(String(await codeOf(run("marketing.pages.saveDraft", { id: footer.id, blocks: ok }, ctx(admin))))).not.toBe("OK");
  });

  it("says why a page cannot be created instead of a generic failure", async () => {
    const reason = async (slug: string) => {
      try {
        await run("marketing.pages.create", { title: "Probe", slug }, ctx(admin));
        return "OK";
      } catch (e) {
        return e instanceof ORPCError ? `${e.code}: ${e.message}` : `THROWN: ${String(e)}`;
      }
    };
    expect(await reason("home")).toMatch(/^BAD_REQUEST: .*reserved/);
    expect(await reason("not a slug")).toMatch(/^BAD_REQUEST: .*lowercase/);
    await run("marketing.pages.create", { title: "Twice", slug: "twice" }, ctx(admin));
    expect(await reason("twice")).toMatch(/^BAD_REQUEST: .*already exists/);
  });

  it("the website reads as live, and its visibility, search setting, policy and privacy contact save on the record", async () => {
    // No status row means "coming soon" for a store; the website must read as live (and the public reader says live too).
    expect(((await getPlatformSiteStatus(rtRw._db.db))).mode).toBe("live");
    const first = (await run("marketing.storefront.getStatus", undefined, ctx(admin))) as { mode: string; hideFromSearchEngines?: boolean };
    expect(first.mode).toBe("live");

    await run("marketing.storefront.updateStatus", { mode: "coming_soon", headline: "Back soon", hideFromSearchEngines: true }, ctx(admin));
    const changed = await getPlatformSiteStatus(rtRw._db.db);
    expect(changed).toMatchObject({ mode: "coming_soon", headline: "Back soon", hideFromSearchEngines: true });

    // the maintenance window is allowed for the website (owner-only for stores)
    await run("marketing.storefront.updateStatus", { mode: "maintenance" }, ctx(admin));
    expect((await getPlatformSiteStatus(rtRw._db.db)).mode).toBe("maintenance");

    await run("marketing.storefront.updateStatus", { mode: "live", hideFromSearchEngines: false }, ctx(admin));
    expect(await getPlatformSiteStatus(rtRw._db.db)).toMatchObject({ mode: "live", hideFromSearchEngines: false });

    const content = { v: 1, blocks: [{ type: "heading", level: 2, text: "Terms" }, { type: "paragraph", text: "These are the terms." }] };
    await run("marketing.policies.saveDraft", { handle: "terms", content }, ctx(admin));
    await run("marketing.policies.publish", { handle: "terms" }, ctx(admin));
    const published = await getPlatformSitePolicy(rtRw._db.db, "terms");
    expect(published?.version).toBe(1);
    expect(await getPlatformSitePolicy(rtRw._db.db, "refund")).toBeNull();
    const storePolicy = await getPublishedPolicy(rtRw._db.db, storeId, "terms");
    expect(storePolicy).toBeNull();

    await run("marketing.customerPrivacy.updateSettings", { privacyContactEmail: "privacy@bcom.test", grievanceOfficerName: "A Person" }, ctx(admin));
    const privacy = (await run("marketing.customerPrivacy.getSettings", undefined, ctx(admin))) as { privacyContactEmail: string | null };
    expect(privacy.privacyContactEmail).toBe("privacy@bcom.test");
    expect(await getPlatformSitePrivacy(rtRw)).toMatchObject({ email: "privacy@bcom.test", officerName: "A Person" });
  });

  it("a request cannot reach a store's page by id", async () => {
    const [storePage] = await withTenant(rtRw._db.db, storeId, (tx) => tx.select().from(schema.pages));
    expect(await codeOf(run("marketing.pages.get", { id: storePage!.id }, ctx(admin)))).not.toBe("OK");
    expect(await codeOf(run("marketing.pages.delete", { id: storePage!.id }, ctx(admin)))).not.toBe("OK");
    const still = await withTenant(rtRw._db.db, storeId, (tx) => tx.select().from(schema.pages));
    expect(still.some((p) => p.id === storePage!.id)).toBe(true);
  });

  it("navigation saves on the website record", async () => {
    await run("marketing.menus.create", { name: "Header", handle: "site-header", kind: "navigation" }, ctx(admin));
    const menus = (await run("marketing.menus.list", undefined, ctx(admin))) as Array<{ handle: string }>;
    expect(menus.some((x) => x.handle === "site-header")).toBe(true);
    const store = await withTenant(rtRw._db.db, storeId, (tx) => tx.select().from(schema.menus));
    expect(store.some((x) => x.handle === "site-header")).toBe(false);
  });
});
