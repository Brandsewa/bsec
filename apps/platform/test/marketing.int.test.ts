import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, ORPCError } from "@orpc/server";
import { sql } from "drizzle-orm";
import { platformContract } from "@bs/contracts";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createLogger, createRuntime, provisionTenant, type Runtime } from "@bs/domain";
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
  return call(leaf.proc, input as never, { context } as never);
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
    expect(await codeOf(run("marketing.menus.list", undefined, ctx(admin)))).toBe("PRECONDITION_FAILED");
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

  it("navigation saves on the website record", async () => {
    await run("marketing.menus.create", { name: "Header", handle: "site-header", kind: "navigation" }, ctx(admin));
    const menus = (await run("marketing.menus.list", undefined, ctx(admin))) as Array<{ handle: string }>;
    expect(menus.some((x) => x.handle === "site-header")).toBe(true);
    const store = await withTenant(rtRw._db.db, storeId, (tx) => tx.select().from(schema.menus));
    expect(store.some((x) => x.handle === "site-header")).toBe(false);
  });
});
