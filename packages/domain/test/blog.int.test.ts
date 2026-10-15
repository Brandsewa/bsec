import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Client as PgClient } from "pg";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createBlogCategory,
  createBlogPost,
  createRuntime,
  deleteBlogCategory,
  deleteBlogPost,
  getPublicBlogPost,
  getRecentBlogPosts,
  listBlogForSitemap,
  listPublicBlogCategories,
  listPublicBlogPosts,
  publishBlogPost,
  resolveBlockData,
  blogMenuTargetsTx,
  createBlogPreviewLink,
  signBlogPreviewToken,
  verifyBlogPreviewToken,
  seedThemeDemoBlog,
  publishDueBlogPosts,
  resolveBlogStatus,
  scheduleBlogPost,
  unpublishBlogPost,
  updateBlogCategory,
  updateBlogPost,
  updateBlogSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { withTenant } from "@bs/db";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;
let rtStore: Runtime;
let pg: PgClient;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const org = "0199a0a3-0000-7000-8000-0000000000c0";
const A = "0199a0a3-0000-7000-8000-0000000000c1";
const B = "0199a0a3-0000-7000-8000-0000000000c2";
const ctxOf = (tenantId: string, permissions: string[] = ["content.write"]): TenantContext =>
  ({ tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["store_owner"], permissions, requestId: "req_blog" }) as TenantContext;
const anon = (tenantId: string): TenantContext =>
  ({ tenantId, storeStatus: "live", actor: { type: "anonymous" }, roles: [], permissions: [], requestId: "req_blog_anon" }) as TenantContext;
const ownerA = ctxOf(A);
const ownerB = ctxOf(B);

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query(sql, params)).rows as T[];
}

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 5 });
  rt = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });
  // Storefront reads run as app_rw so row level security is really in force.
  rtStore = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });
  pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${org}', 'Blog Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${A}', '${org}', 'blog-test-a', 'Blog A') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${B}', '${org}', 'blog-test-b', 'Blog B') ON CONFLICT DO NOTHING;
    INSERT INTO store_settings (tenant_id, store_name) VALUES ('${A}', 'Blog A') ON CONFLICT DO NOTHING;
  `);
}, 240_000);

afterAll(async () => {
  await pg?.query(`DELETE FROM blog_slug_redirects WHERE tenant_id IN ('${A}','${B}'); DELETE FROM blog_posts WHERE tenant_id IN ('${A}','${B}'); DELETE FROM blog_categories WHERE tenant_id IN ('${A}','${B}');`).catch(() => {});
  await pg?.end();
  await rwDb?.close();
  await rt?.close();
  await rtStore?.close();
  await container?.stop();
});

const future = () => new Date(Date.now() + 86_400_000);

describe("blog status rules", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  it("publish now is published; a clearly future date becomes scheduled; scheduling needs the future", () => {
    expect(resolveBlogStatus("published", null, null, now).status).toBe("published");
    expect(resolveBlogStatus("published", new Date("2026-10-20T00:00:00Z"), null, now).status).toBe("scheduled");
    expect(resolveBlogStatus("published", new Date("2026-10-15T10:00:30Z"), null, now).status).toBe("published");
    expect(() => resolveBlogStatus("scheduled", new Date("2026-10-14T00:00:00Z"), null, now)).toThrow(/future/);
    expect(resolveBlogStatus("draft", null, new Date("2026-10-01T00:00:00Z"), now).status).toBe("draft");
  });
});

describe("blog categories", () => {
  it("nests one level, refuses a third, and a delete moves posts and promotes children", async () => {
    const parent = await createBlogCategory(rt, ownerA, { name: "Guides" });
    const child = await createBlogCategory(rt, ownerA, { name: "Beginner", parentId: parent.id });
    await expect(createBlogCategory(rt, ownerA, { name: "Too deep", parentId: child.id })).rejects.toThrow(/one level/);
    await expect(updateBlogCategory(rt, ownerA, parent.id, { parentId: child.id })).rejects.toThrow(/one level|subcategories/);
    const dup = await createBlogCategory(rt, ownerA, { name: "Guides" });
    expect(dup.slug).toBe("guides-2");
    await expect(createBlogCategory(rt, ownerA, { name: "x", description: "<b>no</b>" })).rejects.toThrow(/plain text/);

    const post = await createBlogPost(rt, ownerA, { title: "Move me", categoryId: child.id, status: "published" });
    const other = await createBlogCategory(rt, ownerA, { name: "News" });
    await deleteBlogCategory(rt, ownerA, parent.id, other.id);
    const [row] = await q<{ parent_id: string | null }>(`select parent_id from blog_categories where id = $1`, [child.id]);
    expect(row?.parent_id).toBeNull();
    await deleteBlogCategory(rt, ownerA, child.id, other.id);
    const [moved] = await q<{ category_id: string }>(`select category_id from blog_posts where id = $1`, [post.id]);
    expect(moved?.category_id).toBe(other.id);
    expect((await q(`select 1 from audit_logs where tenant_id = $1 and action = 'blog.category.deleted'`, [A])).length).toBe(2);
  });

  it("a category from another store can never be used (composite key and service check)", async () => {
    const foreign = await createBlogCategory(rt, ownerB, { name: "Foreign" });
    await expect(createBlogPost(rt, ownerA, { title: "Cross", categoryId: foreign.id })).rejects.toThrow(/does not exist/);
    await expect(
      pg.query(`insert into blog_posts (tenant_id, title, slug, category_id) values ($1, 'x', 'cross-direct', $2)`, [A, foreign.id]),
    ).rejects.toThrow(/foreign key|violates/);
  });

  it("needs content.write", async () => {
    await expect(createBlogCategory(rt, ctxOf(A, ["products.read"]), { name: "Nope" })).rejects.toThrow();
  });
});

describe("blog posts and visibility", () => {
  it("creates drafts, refuses reserved and taken slugs, and suffixes generated ones", async () => {
    const a = await createBlogPost(rt, ownerA, { title: "Hello World" });
    expect(a.slug).toBe("hello-world");
    const b = await createBlogPost(rt, ownerA, { title: "Hello World" });
    expect(b.slug).toBe("hello-world-2");
    await expect(createBlogPost(rt, ownerA, { title: "x", slug: "page" })).rejects.toThrow(/reserved/);
    await expect(createBlogPost(rt, ownerA, { title: "y", slug: "hello-world" })).rejects.toThrow(/already uses/);
    await expect(createBlogPost(rt, ownerA, { title: "z", excerpt: "<script>" })).rejects.toThrow(/plain text/);
    await expect(createBlogPost(rt, ownerA, { title: "w", excerpt: "a".repeat(301) })).rejects.toThrow(/300/);
    expect((await q(`select 1 from audit_logs where tenant_id = $1 and action = 'blog.post.created'`, [A])).length).toBeGreaterThanOrEqual(2);
  });

  it("only published posts with a passed date are visible; draft, future, unpublished, other store and disabled blog are not", async () => {
    const pub = await createBlogPost(rt, ownerA, { title: "Visible one", status: "published" });
    const draft = await createBlogPost(rt, ownerA, { title: "Hidden draft" });
    const sched = await createBlogPost(rt, ownerA, { title: "Hidden future", status: "scheduled", publishedAt: future() });
    const slugs = async () => (await listPublicBlogPosts(rtStore, anon(A), { perPage: 48 })).posts.map((p) => p.slug);
    let s = await slugs();
    expect(s).toContain(pub.slug);
    expect(s).not.toContain(draft.slug);
    expect(s).not.toContain(sched.slug);
    expect((await getPublicBlogPost(rtStore, anon(A), draft.slug)).kind).toBe("missing");
    expect((await getPublicBlogPost(rtStore, anon(A), sched.slug)).kind).toBe("missing");
    expect((await listPublicBlogPosts(rtStore, anon(B), { perPage: 48 })).posts).toHaveLength(0);
    expect((await getPublicBlogPost(rtStore, anon(B), pub.slug)).kind).toBe("missing");

    // Scheduled post goes live at its minute even though no job ran: the read-time rule.
    await q(`update blog_posts set published_at = now() - interval '1 minute' where id = $1`, [sched.id]);
    s = await slugs();
    expect(s).toContain(sched.slug);

    await unpublishBlogPost(rt, ownerA, pub.id);
    expect(await slugs()).not.toContain(pub.slug);
    await publishBlogPost(rt, ownerA, pub.id);
    expect(await slugs()).toContain(pub.slug);

    await updateBlogSettings(rt, ownerA, { enabled: false });
    expect((await listPublicBlogPosts(rtStore, anon(A))).enabled).toBe(false);
    expect((await getRecentBlogPosts(rtStore, anon(A), { limit: 3 })).posts).toHaveLength(0);
    await updateBlogSettings(rt, ownerA, { enabled: true });
  });

  it("a post in an inactive category (or whose parent is inactive) is hidden everywhere", async () => {
    const parent = await createBlogCategory(rt, ownerA, { name: "Hide parent" });
    const child = await createBlogCategory(rt, ownerA, { name: "Hide child", parentId: parent.id });
    const p = await createBlogPost(rt, ownerA, { title: "In hidden child", categoryId: child.id, status: "published" });
    const visible = async () => (await listPublicBlogPosts(rtStore, anon(A), { perPage: 48 })).posts.map((x) => x.slug);
    expect(await visible()).toContain(p.slug);
    // A parent lists its subcategory's posts.
    const viaParent = await listPublicBlogPosts(rtStore, anon(A), { categoryPath: parent.slug === "hide-parent" ? "hide-parent" : parent.slug });
    expect(viaParent.posts.map((x) => x.slug)).toContain(p.slug);
    await updateBlogCategory(rt, ownerA, parent.id, { isActive: false });
    expect(await visible()).not.toContain(p.slug);
    expect((await listPublicBlogPosts(rtStore, anon(A), { categoryPath: "hide-parent/hide-child" })).categoryMissing).toBe(true);
    const sm = await withTenant(rtStore._db.db, A, (tx) => listBlogForSitemap(tx, A));
    expect(sm.posts.map((x) => x.slug)).not.toContain(p.slug);
    await updateBlogCategory(rt, ownerA, parent.id, { isActive: true });
    const tree = await listPublicBlogCategories(rtStore, anon(A));
    const top = tree.find((c) => c.slug === "hide-parent");
    expect(top?.postCount).toBe(1);
    expect(top?.children[0]?.path).toBe("hide-parent/hide-child");
  });

  it("the sitemap lists visible indexable posts only", async () => {
    const idx = await createBlogPost(rt, ownerA, { title: "Indexed", status: "published" });
    const noidx = await createBlogPost(rt, ownerA, { title: "Not indexed", status: "published", seo: { noindex: true } });
    const draft = await createBlogPost(rt, ownerA, { title: "Draft not in map" });
    const sm = await withTenant(rtStore._db.db, A, (tx) => listBlogForSitemap(tx, A));
    const slugs = sm.posts.map((p) => p.slug);
    expect(slugs).toContain(idx.slug);
    expect(slugs).not.toContain(noidx.slug);
    expect(slugs).not.toContain(draft.slug);
    const other = await withTenant(rtStore._db.db, B, (tx) => listBlogForSitemap(tx, B));
    expect(other.posts).toHaveLength(0);
  });

  it("the due job flips scheduled posts, audits them and leaves future ones alone", async () => {
    const due = await createBlogPost(rt, ownerA, { title: "Due soon", status: "scheduled", publishedAt: future() });
    const later = await createBlogPost(rt, ownerA, { title: "Much later", status: "scheduled", publishedAt: future() });
    await q(`update blog_posts set published_at = now() - interval '2 minutes' where id = $1`, [due.id]);
    const res = await publishDueBlogPosts(rwDb.db);
    expect(res.published).toBeGreaterThanOrEqual(1);
    const rows = await q<{ id: string; status: string }>(`select id, status from blog_posts where id in ($1, $2)`, [due.id, later.id]);
    expect(rows.find((r) => r.id === due.id)?.status).toBe("published");
    expect(rows.find((r) => r.id === later.id)?.status).toBe("scheduled");
    expect((await q(`select 1 from audit_logs where tenant_id = $1 and action = 'blog.post.auto_published' and target_id = $2`, [A, due.id])).length).toBe(1);
  });
});

describe("blog slugs and redirects", () => {
  it("a changed slug of a public post keeps the old address (one hop, even after two changes)", async () => {
    const p = await createBlogPost(rt, ownerA, { title: "Old name", status: "published" });
    await updateBlogPost(rt, ownerA, p.id, { slug: "second-name" });
    await updateBlogPost(rt, ownerA, p.id, { slug: "third-name" });
    const first = await getPublicBlogPost(rtStore, anon(A), p.slug);
    expect(first).toEqual({ kind: "redirect", slug: "third-name" });
    expect(await getPublicBlogPost(rtStore, anon(A), "second-name")).toEqual({ kind: "redirect", slug: "third-name" });
    expect((await getPublicBlogPost(rtStore, anon(A), "third-name")).kind).toBe("post");
    // Another store never resolves it.
    expect((await getPublicBlogPost(rtStore, anon(B), p.slug)).kind).toBe("missing");
    // A new post may take an old address back; the redirect row goes away.
    const reuse = await createBlogPost(rt, ownerA, { title: "Reuse", slug: p.slug, status: "published" });
    expect(reuse.slug).toBe(p.slug);
    expect((await getPublicBlogPost(rtStore, anon(A), p.slug)).kind).toBe("post");
  });

  it("a draft's slug change writes no redirect", async () => {
    const d = await createBlogPost(rt, ownerA, { title: "Draft name" });
    await updateBlogPost(rt, ownerA, d.id, { slug: "draft-renamed" });
    expect((await q(`select 1 from blog_slug_redirects where tenant_id = $1 and from_slug = $2`, [A, d.slug])).length).toBe(0);
  });
});

describe("blog body security and media", () => {
  it("strips scripts, handlers, iframes, javascript links, inline styles and outside images; heading ids and reading time are derived", async () => {
    const dirty =
      `<h1>Pasted title</h1><p onclick="x()" style="color:red">Hi <script>alert(1)</script><b>there</b></p>` +
      `<iframe src="https://evil.example/x"></iframe><a href="javascript:alert(1)">bad</a><a href="https://ext.example/p">ext</a>` +
      `<img src="https://evil.example/pixel.gif" alt="x"><h2>Second heading</h2><h2>Second heading</h2>`;
    const p = await createBlogPost(rt, ownerA, { title: "Sanitise me", contentHtml: dirty });
    const [row] = await q<{ content_html: string; content_text: string; reading_minutes: number }>(`select content_html, content_text, reading_minutes from blog_posts where id = $1`, [p.id]);
    const html = row!.content_html;
    expect(html).not.toMatch(/<script|onclick|style=|<iframe|javascript:|evil\.example|<img/i);
    expect(html).toContain('rel="noopener nofollow"');
    expect(html).toContain('<h2 id="pasted-title">Pasted title</h2>');
    expect(html).toContain('<h2 id="second-heading">');
    expect(html).toContain('<h2 id="second-heading-2">');
    expect(row!.content_text).not.toMatch(/<|alert/);
    expect(row!.reading_minutes).toBe(1);
    await expect(createBlogPost(rt, ownerA, { title: "Huge", contentHtml: "a".repeat(200_001) })).rejects.toThrow(/too long/);
  });

  it("inline and featured images must be this store's media; usages are recorded and released", async () => {
    const [mine] = await q<{ id: string }>(
      `insert into media (tenant_id, storage_key, mime, bytes, width, height, kind) values ($1, 'tenants/a/blog-img.jpg', 'image/jpeg', 100, 800, 600, 'image') returning id`,
      [A],
    );
    const [theirs] = await q<{ id: string }>(
      `insert into media (tenant_id, storage_key, mime, bytes, kind) values ($1, 'tenants/b/other.jpg', 'image/jpeg', 100, 'image') returning id`,
      [B],
    );
    process.env["MEDIA_PUBLIC_URL"] = "https://media.example.test";
    const body = `<p>text</p><img data-media-id="${mine!.id}" src="https://evil.example/a.png" alt="mine"><img data-media-id="${theirs!.id}" src="https://evil.example/b.png" alt="theirs">`;
    const p = await createBlogPost(rt, ownerA, { title: "With pictures", contentHtml: body, featuredImageMediaId: mine!.id });
    const [row] = await q<{ content_html: string }>(`select content_html from blog_posts where id = $1`, [p.id]);
    expect(row!.content_html).toContain(`src="https://media.example.test/tenants/a/blog-img.jpg"`);
    expect(row!.content_html).toContain(`width="800"`);
    expect(row!.content_html).not.toContain("evil.example");
    expect(row!.content_html).not.toContain(theirs!.id);
    const fields = (await q<{ field: string }>(`select field from media_usages where tenant_id = $1 and owner_type = 'blog_post' and owner_id = $2 order by field`, [A, p.id])).map((r) => r.field);
    expect(fields).toEqual(["body", "featured"]);
    await expect(createBlogPost(rt, ownerA, { title: "Foreign hero", featuredImageMediaId: theirs!.id })).rejects.toThrow();
    await deleteBlogPost(rt, ownerA, p.id);
    expect((await q(`select 1 from media_usages where tenant_id = $1 and owner_type = 'blog_post' and owner_id = $2`, [A, p.id])).length).toBe(0);
  });
});

describe("blog widget query and audit", () => {
  it("returns the newest visible posts, bounded, filtered by category, one store only", async () => {
    const cat = await createBlogCategory(rt, ownerA, { name: "Widget cat" });
    for (let i = 0; i < 4; i++) {
      await createBlogPost(rt, ownerA, { title: `Widget post ${i}`, categoryId: cat.id, status: "published", publishedAt: new Date(Date.now() - (i + 1) * 60_000), isFeatured: i === 0 });
    }
    const latest = await getRecentBlogPosts(rtStore, anon(A), { limit: 2 });
    expect(latest.posts).toHaveLength(2);
    expect(new Date(latest.posts[0]!.publishedAt).getTime()).toBeGreaterThanOrEqual(new Date(latest.posts[1]!.publishedAt).getTime());
    const byCat = await getRecentBlogPosts(rtStore, anon(A), { limit: 12, categorySlug: cat.slug });
    expect(byCat.posts).toHaveLength(4);
    expect(byCat.posts.every((p) => p.category?.slug === cat.slug)).toBe(true);
    expect((await getRecentBlogPosts(rtStore, anon(A), { limit: 12, categorySlug: cat.slug, featuredOnly: true })).posts).toHaveLength(1);
    expect((await getRecentBlogPosts(rtStore, anon(B), { limit: 12 })).posts).toHaveLength(0);
    expect((await getRecentBlogPosts(rtStore, anon(A), { limit: 999 })).posts.length).toBeLessThanOrEqual(12);
  });

  it("every mutation writes an audit row and needs content.write", async () => {
    const p = await createBlogPost(rt, ownerA, { title: "Audit me" });
    await scheduleBlogPost(rt, ownerA, p.id, future());
    await unpublishBlogPost(rt, ownerA, p.id);
    await publishBlogPost(rt, ownerA, p.id);
    await deleteBlogPost(rt, ownerA, p.id);
    const actions = (await q<{ action: string }>(`select action from audit_logs where tenant_id = $1 and target_id = $2 order by created_at`, [A, p.id])).map((r) => r.action);
    expect(actions).toEqual(["blog.post.created", "blog.post.scheduled", "blog.post.unpublished", "blog.post.published", "blog.post.deleted"]);
    await expect(createBlogPost(rt, ctxOf(A, []), { title: "no" })).rejects.toThrow();
    await expect(updateBlogPost(rt, ctxOf(A, []), p.id, { title: "no" })).rejects.toThrow();
    await expect(deleteBlogPost(rt, ctxOf(A, []), p.id)).rejects.toThrow();
    // Another store cannot change this store's post.
    const mine = await createBlogPost(rt, ownerA, { title: "Mine only" });
    await expect(updateBlogPost(rt, ownerB, mine.id, { title: "stolen" })).rejects.toThrow(/not found/i);
    await expect(deleteBlogPost(rt, ownerB, mine.id)).rejects.toThrow(/not found/i);
  });
});

describe("Recent Posts widget data (block render data)", () => {
  const widget = (id: string, props: Record<string, unknown>) => ({ id, type: "BlogPosts" as const, version: 1, props });

  it("resolves newest first, bounded by count, by source and category, for one store only", async () => {
    const cat = await createBlogCategory(rt, ownerA, { name: "Widget data cat" });
    const featured = await createBlogPost(rt, ownerA, { title: "Widget featured", categoryId: cat.id, status: "published", publishedAt: new Date(), isFeatured: true });
    for (let i = 0; i < 3; i++) await createBlogPost(rt, ownerA, { title: `Widget data ${i}`, status: "published", publishedAt: new Date(Date.now() - (i + 2) * 3_600_000) });
    const blocks = [
      widget("latest", { count: 2 }),
      widget("featured", { count: 5, source: "featured" }),
      widget("cat", { count: 5, source: "category", categorySlug: cat.slug }),
      widget("nocat", { count: 5, source: "category", categorySlug: "does-not-exist" }),
    ];
    const data = await resolveBlockData(rtStore, anon(A), blocks as never);
    const posts = (id: string) => (data[id]?.kind === "blog-posts" ? data[id].posts : null);
    expect(posts("latest")).toHaveLength(2);
    expect(posts("latest")?.[0]?.slug).toBe(featured.slug);
    expect(posts("featured")?.[0]?.slug).toBe(featured.slug);
    expect(posts("cat")?.map((p) => p.slug)).toEqual([featured.slug]);
    expect(posts("cat")?.[0]).toMatchObject({ categoryName: "Widget data cat", categoryPath: cat.slug });
    expect(posts("nocat")).toEqual([]);
    const href = (id: string) => (data[id]?.kind === "blog-posts" ? data[id].viewAllHref : "");
    expect(href("cat")).toBe(`/blog/category/${cat.slug}`);
    expect(href("latest")).toBe("/blog");

    const other = await resolveBlockData(rtStore, anon(B), blocks as never);
    expect((other["latest"]?.kind === "blog-posts" ? other["latest"].posts : null)).toEqual([]);
  });

  it("is empty when the blog is switched off and a new post shows up as soon as it is published", async () => {
    const blocks = [widget("w", { count: 12 })];
    const count = async () => {
      const d = await resolveBlockData(rtStore, anon(A), blocks as never);
      return d["w"]?.kind === "blog-posts" ? d["w"].posts : [];
    };
    const before = (await count()).length;
    const p = await createBlogPost(rt, ownerA, { title: "Fresh widget post", status: "published" });
    expect((await count()).map((x) => x.slug)).toContain(p.slug);
    expect((await count()).length).toBe(Math.min(before + 1, 12));
    await updateBlogSettings(rt, ownerA, { enabled: false });
    expect(await count()).toEqual([]);
    await updateBlogSettings(rt, ownerA, { enabled: true });
  });

  it("the demo blog seed covers every state, runs once and stays hidden where it should", async () => {
    await createBlogCategory(rt, ownerB, { name: "Placeholder so B has a row" });
    const first = await seedThemeDemoBlog(rt, ownerB);
    expect(first.seeded).toBe(true);
    expect((await seedThemeDemoBlog(rt, ownerB)).seeded).toBe(false);
    const states = await q<{ status: string; n: number }>(`select status, count(*)::int n from blog_posts where tenant_id = $1 group by status`, [B]);
    const by = Object.fromEntries(states.map((r) => [r.status, r.n]));
    expect(by["published"]).toBeGreaterThanOrEqual(5);
    expect(by["scheduled"]).toBe(1);
    expect(by["draft"]).toBe(1);
    const visible = await listPublicBlogPosts(rtStore, anon(B), { perPage: 48 });
    expect(visible.posts.map((p) => p.title)).not.toContain("Coming next week");
    expect(visible.posts.map((p) => p.title)).not.toContain("Draft: ideas for the festive season");
    const sizing = await listPublicBlogPosts(rtStore, anon(B), { categoryPath: "guides/sizing" });
    expect(sizing.posts.map((p) => p.title)).toEqual(["How to choose the right size"]);
    const guides = await listPublicBlogPosts(rtStore, anon(B), { categoryPath: "guides" });
    expect(guides.posts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("menu links to blog categories and posts", () => {
  it("resolve only live targets of this store: hidden categories, drafts, scheduled posts and other stores are skipped", async () => {
    const parent = await createBlogCategory(rt, ownerA, { name: "Menu parent" });
    const child = await createBlogCategory(rt, ownerA, { name: "Menu child", parentId: parent.id });
    const live = await createBlogPost(rt, ownerA, { title: "Menu live post", status: "published", categoryId: child.id });
    const draft = await createBlogPost(rt, ownerA, { title: "Menu draft post" });
    const later = await createBlogPost(rt, ownerA, { title: "Menu later post", status: "scheduled", publishedAt: new Date(Date.now() + 86_400_000) });
    const foreign = await createBlogCategory(rt, ownerB, { name: "Menu foreign" });
    const resolve = () =>
      withTenant(rtStore._db.db, A, (tx) =>
        blogMenuTargetsTx(tx, A, { categoryIds: new Set([parent.id, child.id, foreign.id]), postIds: new Set([live.id, draft.id, later.id]) }),
      );
    let t = await resolve();
    expect(t.categories.get(parent.id)).toBe("menu-parent");
    expect(t.categories.get(child.id)).toBe("menu-parent/menu-child");
    expect(t.categories.has(foreign.id)).toBe(false);
    expect([...t.posts.entries()]).toEqual([[live.id, live.slug]]);
    await updateBlogCategory(rt, ownerA, parent.id, { isActive: false });
    t = await resolve();
    expect(t.categories.size).toBe(0);
    expect(t.posts.size).toBe(0); // the live post sits in a hidden category chain
    await updateBlogCategory(rt, ownerA, parent.id, { isActive: true });
    await updateBlogSettings(rt, ownerA, { enabled: false });
    expect((await resolve()).categories.size).toBe(0);
    await updateBlogSettings(rt, ownerA, { enabled: true });
  });
});

describe("preview links for unpublished posts", () => {
  it("tokens bind the store, the post and the expiry, and cannot be forged or reused", () => {
    const now = Date.now();
    const { token } = signBlogPreviewToken(A, "post-1", now);
    expect(verifyBlogPreviewToken(A, "post-1", token, now + 1000)).toBe(true);
    expect(verifyBlogPreviewToken(A, "post-2", token, now + 1000)).toBe(false);
    expect(verifyBlogPreviewToken(B, "post-1", token, now + 1000)).toBe(false);
    expect(verifyBlogPreviewToken(A, "post-1", token, now + 25 * 3_600_000)).toBe(false);
    const [exp, sig] = token.split(".");
    expect(verifyBlogPreviewToken(A, "post-1", `${exp}.${"0".repeat(64)}`, now + 1000)).toBe(false);
    expect(verifyBlogPreviewToken(A, "post-1", `${(parseInt(exp!, 36) + 100_000).toString(36)}.${sig}`, now + 1000)).toBe(false);
    for (const bad of ["", "x", "a.b", `${exp}.`, `.${sig}`, `${exp}.${sig}zz`]) expect(verifyBlogPreviewToken(A, "post-1", bad, now + 1000)).toBe(false);
  });

  it("shows a draft only with a valid link for that store, never makes it public and needs the store to have an address", async () => {
    const draft = await createBlogPost(rt, ownerA, { title: "Secret draft for preview" });
    await expect(createBlogPreviewLink(rt, ownerA, draft.id)).rejects.toThrow(/no active address/);
    await q(`insert into domains (tenant_id, hostname, status, is_primary) values ($1, 'blog-a.example.test', 'active', true) on conflict do nothing`, [A]);
    const link = await createBlogPreviewLink(rt, ownerA, draft.id);
    expect(link.url).toMatch(/^https:\/\/blog-a\.example\.test\/blog\/secret-draft-for-preview\?preview=[0-9a-z]+\.[0-9a-f]{64}$/);
    const token = new URL(link.url).searchParams.get("preview")!;

    expect((await getPublicBlogPost(rtStore, anon(A), draft.slug)).kind).toBe("missing");
    const ok = await getPublicBlogPost(rtStore, anon(A), draft.slug, { previewToken: token });
    expect(ok.kind === "post" && ok.preview).toBe(true);
    expect((await getPublicBlogPost(rtStore, anon(A), draft.slug, { previewToken: token.replace(/.$/, (c) => (c === "0" ? "1" : "0")) })).kind).toBe("missing");
    expect((await getPublicBlogPost(rtStore, anon(B), draft.slug, { previewToken: token })).kind).toBe("missing");
    // The link does not publish anything or change what is listed.
    expect((await listPublicBlogPosts(rtStore, anon(A), { perPage: 48 })).posts.map((p) => p.slug)).not.toContain(draft.slug);
    // A normal visit of a public post is not flagged as a preview.
    const pub = await createBlogPost(rt, ownerA, { title: "Public for preview check", status: "published" });
    const view = await getPublicBlogPost(rtStore, anon(A), pub.slug);
    expect(view.kind === "post" && view.preview).toBe(false);
    await expect(createBlogPreviewLink(rt, ctxOf(A, []), draft.id)).rejects.toThrow();
    await expect(createBlogPreviewLink(rt, ownerB, draft.id)).rejects.toThrow(/not found/i);
  });
});
