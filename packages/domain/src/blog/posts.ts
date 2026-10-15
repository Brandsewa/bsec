import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { clearMediaUsagesForOwner, syncMediaUsages } from "../media-services.ts";
import {
  cleanBlogExcerpt,
  cleanBlogSeo,
  prepareBlogBody,
  RESERVED_BLOG_SLUGS,
  slugifyBlog,
  type BlogSeoInput,
} from "./content.ts";
import { auditBlog, type Tx } from "./shared.ts";

export type BlogPostStatus = "draft" | "scheduled" | "published";

export interface BlogPostInput {
  title: string;
  slug?: string | undefined;
  excerpt?: string | null | undefined;
  contentHtml?: string | undefined;
  featuredImageMediaId?: string | null | undefined;
  featuredImageAlt?: string | null | undefined;
  categoryId?: string | null | undefined;
  authorName?: string | undefined;
  status?: BlogPostStatus | undefined;
  publishedAt?: Date | string | null | undefined;
  isFeatured?: boolean | undefined;
  seo?: BlogSeoInput | null | undefined;
}

export interface BlogPostListQuery {
  search?: string | undefined;
  status?: BlogPostStatus | undefined;
  categoryId?: string | undefined;
  sort?: "updated_desc" | "published_desc" | "title_asc" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

const bad = (m: string) => new Error(`Bad Request: ${m}`);

/** Slug for a post: unique per store, never a blog route word. A taken slug of someone's old redirect is reclaimed. */
async function uniquePostSlug(tx: Tx, tenantId: string, base: string, excludeId?: string, explicit = false): Promise<string> {
  const root = base || "post";
  if (explicit && RESERVED_BLOG_SLUGS.has(root)) throw bad(`"${root}" is reserved for the blog itself. Choose another address.`);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (RESERVED_BLOG_SLUGS.has(candidate)) continue;
    const [hit] = await tx
      .select({ id: schema.blogPosts.id })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.tenantId, tenantId), eq(schema.blogPosts.slug, candidate)))
      .limit(1);
    if (!hit || hit.id === excludeId) return candidate;
    if (explicit && n === 1) throw bad("Another post already uses this address (slug).");
  }
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw bad("The publish date is not valid.");
  return d;
}

/** Turns the requested state and date into what is stored. A "published" request with a future date is scheduled. */
export function resolveBlogStatus(
  requested: BlogPostStatus,
  requestedAt: Date | null,
  existingAt: Date | null,
  now: Date = new Date(),
): { status: BlogPostStatus; publishedAt: Date | null } {
  if (requested === "draft") return { status: "draft", publishedAt: existingAt };
  // Publishing without a date means now, never an old future schedule date left on the row.
  const keep = existingAt && existingAt.getTime() <= now.getTime() ? existingAt : null;
  const at = requestedAt ?? (requested === "scheduled" ? existingAt : keep) ?? now;
  if (requested === "scheduled") {
    if (at.getTime() <= now.getTime()) throw bad("Choose a publish time in the future, or publish now.");
    return { status: "scheduled", publishedAt: at };
  }
  // 60 s of slack so "publish now" from a browser clock slightly ahead does not become a scheduled post.
  if (at.getTime() > now.getTime() + 60_000) return { status: "scheduled", publishedAt: at };
  return { status: "published", publishedAt: at.getTime() > now.getTime() ? now : at };
}

async function assertCategory(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [c] = await tx
    .select({ id: schema.blogCategories.id })
    .from(schema.blogCategories)
    .where(and(eq(schema.blogCategories.tenantId, tenantId), eq(schema.blogCategories.id, id)))
    .limit(1);
  if (!c) throw bad("The category does not exist.");
}

async function staffName(tx: Tx, ctx: TenantContext): Promise<string> {
  if (ctx.actor.type !== "staff") return "";
  const [u] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ctx.actor.userId)).limit(1);
  return u?.name ?? "";
}

async function syncPostUsages(tx: Tx, ctx: TenantContext, postId: string, featured: string | null, seoImage: string | null | undefined, body: string[]): Promise<void> {
  await syncMediaUsages(tx, ctx, { ownerType: "blog_post", ownerId: postId, field: "featured", mediaIds: [featured] });
  await syncMediaUsages(tx, ctx, { ownerType: "blog_post", ownerId: postId, field: "seo", mediaIds: [seoImage] });
  await syncMediaUsages(tx, ctx, { ownerType: "blog_post", ownerId: postId, field: "body", mediaIds: body });
}

export async function listBlogPosts(rt: Runtime, ctx: TenantContext, q: BlogPostListQuery = {}) {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const conds = [eq(schema.blogPosts.tenantId, ctx.tenantId)];
    if (q.status) conds.push(eq(schema.blogPosts.status, q.status));
    if (q.categoryId) conds.push(eq(schema.blogPosts.categoryId, q.categoryId));
    if (q.search?.trim()) conds.push(ilike(schema.blogPosts.title, `%${q.search.trim().replace(/[%_\\]/g, "\\$&")}%`));
    const where = and(...conds);
    const order =
      q.sort === "title_asc"
        ? asc(schema.blogPosts.title)
        : q.sort === "published_desc"
          ? desc(sql`coalesce(${schema.blogPosts.publishedAt}, ${schema.blogPosts.updatedAt})`)
          : desc(schema.blogPosts.updatedAt);
    const items = await tx
      .select({
        id: schema.blogPosts.id,
        title: schema.blogPosts.title,
        slug: schema.blogPosts.slug,
        status: schema.blogPosts.status,
        publishedAt: schema.blogPosts.publishedAt,
        updatedAt: schema.blogPosts.updatedAt,
        authorName: schema.blogPosts.authorName,
        categoryId: schema.blogPosts.categoryId,
        categoryName: sql<string | null>`(select c.name from blog_categories c where c.tenant_id = ${schema.blogPosts.tenantId} and c.id = ${schema.blogPosts.categoryId})`,
        featuredImageMediaId: schema.blogPosts.featuredImageMediaId,
        isFeatured: schema.blogPosts.isFeatured,
      })
      .from(schema.blogPosts)
      .where(where)
      .orderBy(order)
      .limit(Math.min(Math.max(q.limit ?? 25, 1), 100))
      .offset(Math.max(q.offset ?? 0, 0));
    const [tot] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.blogPosts).where(where);
    return {
      items: items.map((i) => ({ ...i, status: i.status as BlogPostStatus, publishedAt: i.publishedAt?.toISOString() ?? null, updatedAt: i.updatedAt.toISOString() })),
      total: tot?.n ?? 0,
    };
  });
}

export async function getBlogPost(rt: Runtime, ctx: TenantContext, id: string) {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.blogPosts).where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.id, id))).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      contentHtml: row.contentHtml,
      readingMinutes: row.readingMinutes,
      featuredImageMediaId: row.featuredImageMediaId,
      featuredImageAlt: row.featuredImageAlt,
      categoryId: row.categoryId,
      authorName: row.authorName,
      status: row.status as BlogPostStatus,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      isFeatured: row.isFeatured,
      seo: (row.seo as BlogSeoInput | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** What the shopper would get for an unsaved body: same sanitiser, same heading ids, so the admin preview is honest. */
export async function previewBlogHtml(rt: Runtime, ctx: TenantContext, contentHtml: string) {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const b = await prepareBlogBody(tx, ctx, contentHtml);
    return { html: b.html, readingMinutes: b.readingMinutes, headings: b.headings };
  });
}

export async function createBlogPost(rt: Runtime, ctx: TenantContext, input: BlogPostInput): Promise<{ id: string; slug: string; status: BlogPostStatus }> {
  assertPermission(ctx, "content.write");
  const title = input.title.trim();
  if (!title) throw bad("The post needs a title.");
  const saved = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    if (input.categoryId) await assertCategory(tx, ctx.tenantId, input.categoryId);
    const body = await prepareBlogBody(tx, ctx, input.contentHtml ?? "");
    const slug = await uniquePostSlug(tx, ctx.tenantId, slugifyBlog(input.slug?.trim() || title), undefined, Boolean(input.slug?.trim()));
    const state = resolveBlogStatus(input.status ?? "draft", toDate(input.publishedAt), null);
    const seo = cleanBlogSeo(input.seo);
    const [row] = await tx
      .insert(schema.blogPosts)
      .values({
        tenantId: ctx.tenantId,
        title: title.slice(0, 200),
        slug,
        excerpt: cleanBlogExcerpt(input.excerpt),
        contentHtml: body.html,
        contentText: body.text,
        readingMinutes: body.readingMinutes,
        featuredImageMediaId: input.featuredImageMediaId ?? null,
        featuredImageAlt: input.featuredImageAlt?.trim().slice(0, 300) || null,
        categoryId: input.categoryId ?? null,
        authorUserId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        authorName: (input.authorName?.trim() || (await staffName(tx, ctx))).slice(0, 120),
        status: state.status,
        publishedAt: state.publishedAt,
        isFeatured: input.isFeatured ?? false,
        seo,
      })
      .returning({ id: schema.blogPosts.id, slug: schema.blogPosts.slug, status: schema.blogPosts.status });
    if (!row) throw new Error("Failed to create post");
    await syncPostUsages(tx, ctx, row.id, input.featuredImageMediaId ?? null, seo?.imageMediaId ?? undefined, body.mediaIds);
    await tx.delete(schema.blogSlugRedirects).where(and(eq(schema.blogSlugRedirects.tenantId, ctx.tenantId), eq(schema.blogSlugRedirects.fromSlug, slug)));
    await auditBlog(tx, ctx, "blog.post.created", "blog_post", row.id, { title, slug, status: state.status });
    return { id: row.id, slug: row.slug, status: row.status as BlogPostStatus, categoryId: input.categoryId ?? null };
  });
  await invalidateCache(rt, ctx, { type: "blog_post_changed", postId: saved.id, slug: saved.slug, categoryId: saved.categoryId });
  return { id: saved.id, slug: saved.slug, status: saved.status };
}

export async function updateBlogPost(rt: Runtime, ctx: TenantContext, id: string, input: Partial<BlogPostInput>): Promise<{ slug: string; status: BlogPostStatus }> {
  assertPermission(ctx, "content.write");
  const saved = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [cur] = await tx.select().from(schema.blogPosts).where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.id, id))).limit(1);
    if (!cur) throw bad("Post not found.");
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const wasPublic = cur.status !== "draft";
    if (input.title !== undefined) {
      if (!input.title.trim()) throw bad("The post needs a title.");
      set["title"] = input.title.trim().slice(0, 200);
    }
    let slug = cur.slug;
    if (input.slug !== undefined && input.slug.trim() && slugifyBlog(input.slug) !== cur.slug) {
      slug = await uniquePostSlug(tx, ctx.tenantId, slugifyBlog(input.slug), id, true);
      set["slug"] = slug;
      if (wasPublic) {
        // Keep the old address working (308 to the new one).
        await tx
          .insert(schema.blogSlugRedirects)
          .values({ tenantId: ctx.tenantId, fromSlug: cur.slug, postId: id })
          .onConflictDoUpdate({ target: [schema.blogSlugRedirects.tenantId, schema.blogSlugRedirects.fromSlug], set: { postId: id } });
      }
      await tx.delete(schema.blogSlugRedirects).where(and(eq(schema.blogSlugRedirects.tenantId, ctx.tenantId), eq(schema.blogSlugRedirects.fromSlug, slug)));
    }
    if (input.excerpt !== undefined) set["excerpt"] = cleanBlogExcerpt(input.excerpt);
    let bodyMedia: string[] | null = null;
    if (input.contentHtml !== undefined) {
      const body = await prepareBlogBody(tx, ctx, input.contentHtml);
      set["contentHtml"] = body.html;
      set["contentText"] = body.text;
      set["readingMinutes"] = body.readingMinutes;
      bodyMedia = body.mediaIds;
    }
    if (input.featuredImageMediaId !== undefined) set["featuredImageMediaId"] = input.featuredImageMediaId;
    if (input.featuredImageAlt !== undefined) set["featuredImageAlt"] = input.featuredImageAlt?.trim().slice(0, 300) || null;
    if (input.categoryId !== undefined) {
      if (input.categoryId) await assertCategory(tx, ctx.tenantId, input.categoryId);
      set["categoryId"] = input.categoryId;
    }
    if (input.authorName !== undefined) set["authorName"] = input.authorName.trim().slice(0, 120);
    if (input.isFeatured !== undefined) set["isFeatured"] = input.isFeatured;
    let seo = (cur.seo as BlogSeoInput | null) ?? null;
    if (input.seo !== undefined) {
      seo = cleanBlogSeo(input.seo);
      set["seo"] = seo;
    }
    let status = cur.status as BlogPostStatus;
    if (input.status !== undefined || input.publishedAt !== undefined) {
      const state = resolveBlogStatus(input.status ?? (cur.status as BlogPostStatus), input.publishedAt !== undefined ? toDate(input.publishedAt) : null, cur.publishedAt);
      set["status"] = state.status;
      set["publishedAt"] = state.publishedAt;
      status = state.status;
    }
    await tx.update(schema.blogPosts).set(set).where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.id, id)));
    const featured = input.featuredImageMediaId !== undefined ? input.featuredImageMediaId : cur.featuredImageMediaId;
    if (input.featuredImageMediaId !== undefined || input.seo !== undefined || bodyMedia) {
      if (input.featuredImageMediaId !== undefined) await syncMediaUsages(tx, ctx, { ownerType: "blog_post", ownerId: id, field: "featured", mediaIds: [featured] });
      if (input.seo !== undefined) await syncMediaUsages(tx, ctx, { ownerType: "blog_post", ownerId: id, field: "seo", mediaIds: [seo?.imageMediaId] });
      if (bodyMedia) await syncMediaUsages(tx, ctx, { ownerType: "blog_post", ownerId: id, field: "body", mediaIds: bodyMedia });
    }
    const action =
      status !== cur.status
        ? status === "published"
          ? "blog.post.published"
          : status === "scheduled"
            ? "blog.post.scheduled"
            : "blog.post.unpublished"
        : "blog.post.updated";
    await auditBlog(tx, ctx, action, "blog_post", id, { changed: Object.keys(set).filter((k) => k !== "updatedAt"), status });
    return { slug, status, oldSlug: cur.slug, categoryIds: [cur.categoryId, (set["categoryId"] as string | null | undefined) ?? cur.categoryId] };
  });
  await invalidateCache(rt, ctx, {
    type: "blog_post_changed",
    postId: id,
    slug: saved.slug,
    previousSlug: saved.oldSlug,
    categoryId: saved.categoryIds[1] ?? saved.categoryIds[0] ?? null,
  });
  return { slug: saved.slug, status: saved.status };
}

export async function publishBlogPost(rt: Runtime, ctx: TenantContext, id: string, publishedAt?: Date | string | null) {
  return updateBlogPost(rt, ctx, id, { status: "published", ...(publishedAt !== undefined ? { publishedAt } : {}) });
}

export async function scheduleBlogPost(rt: Runtime, ctx: TenantContext, id: string, publishedAt: Date | string) {
  return updateBlogPost(rt, ctx, id, { status: "scheduled", publishedAt });
}

export async function unpublishBlogPost(rt: Runtime, ctx: TenantContext, id: string) {
  return updateBlogPost(rt, ctx, id, { status: "draft" });
}

export async function duplicateBlogPost(rt: Runtime, ctx: TenantContext, id: string): Promise<{ id: string; slug: string }> {
  const src = await getBlogPost(rt, ctx, id);
  if (!src) throw bad("Post not found.");
  const created = await createBlogPost(rt, ctx, {
    title: `Copy of ${src.title}`.slice(0, 200),
    excerpt: src.excerpt,
    contentHtml: src.contentHtml,
    featuredImageMediaId: src.featuredImageMediaId,
    featuredImageAlt: src.featuredImageAlt,
    categoryId: src.categoryId,
    authorName: src.authorName,
    isFeatured: false,
    seo: src.seo,
    status: "draft",
  });
  return { id: created.id, slug: created.slug };
}

export async function deleteBlogPost(rt: Runtime, ctx: TenantContext, id: string): Promise<void> {
  assertPermission(ctx, "content.write");
  const info = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [cur] = await tx.select().from(schema.blogPosts).where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.id, id))).limit(1);
    if (!cur) throw bad("Post not found.");
    await clearMediaUsagesForOwner(tx, ctx, { ownerType: "blog_post", ownerId: id });
    await tx.delete(schema.blogPosts).where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.id, id)));
    await auditBlog(tx, ctx, "blog.post.deleted", "blog_post", id, { title: cur.title, slug: cur.slug });
    return { slug: cur.slug, categoryId: cur.categoryId };
  });
  await invalidateCache(rt, ctx, { type: "blog_post_changed", postId: id, slug: info.slug, categoryId: info.categoryId });
}
