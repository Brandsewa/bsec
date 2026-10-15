import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { publicMediaUrl } from "../media/storage.ts";
import { extractHeadings, type BlogHeading, type BlogSeoInput } from "./content.ts";
import { readBlogSettings, type BlogSettings, type Tx } from "./shared.ts";
import { verifyBlogPreviewToken } from "./preview.ts";

/**
 * Storefront reads (ADR-033). ONE visibility rule for every list, the widget, the sitemap and the feed:
 * published or scheduled with a date that has passed, and the category chain (if any) is active. Because the rule
 * is evaluated at read time a scheduled post appears at its minute even if the worker has not run yet.
 */
const bp = schema.blogPosts;
const visible: SQL = sql`(${bp.status} in ('published','scheduled') and ${bp.publishedAt} <= now() and (${bp.categoryId} is null or exists (
  select 1 from blog_categories c left join blog_categories p on p.tenant_id = c.tenant_id and p.id = c.parent_id
  where c.tenant_id = ${bp.tenantId} and c.id = ${bp.categoryId} and c.is_active and (p.id is null or p.is_active))))`;

export interface BlogImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface BlogCategoryRef {
  id: string;
  name: string;
  slug: string;
  /** URL path under /blog/category/, "parent/child" for a subcategory. */
  path: string;
}

export interface BlogPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  authorName: string;
  readingMinutes: number;
  isFeatured: boolean;
  image: BlogImage | null;
  category: BlogCategoryRef | null;
}

export interface PublicBlogCategory extends BlogCategoryRef {
  description: string | null;
  postCount: number;
  children: PublicBlogCategory[];
}

export interface BlogPostPage extends BlogPostSummary {
  contentHtml: string;
  headings: BlogHeading[];
  modifiedAt: string;
  seo: BlogSeoInput | null;
  seoImage: BlogImage | null;
  noindex: boolean;
  related: BlogPostSummary[];
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

const postColumns = {
  id: bp.id,
  slug: bp.slug,
  title: bp.title,
  excerpt: bp.excerpt,
  contentText: bp.contentText,
  publishedAt: bp.publishedAt,
  authorName: bp.authorName,
  readingMinutes: bp.readingMinutes,
  isFeatured: bp.isFeatured,
  categoryId: bp.categoryId,
  featuredAlt: bp.featuredImageAlt,
  mediaKey: schema.media.storageKey,
  mediaAlt: schema.media.alt,
  mediaWidth: schema.media.width,
  mediaHeight: schema.media.height,
};

type Row = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentText: string;
  publishedAt: Date | null;
  authorName: string;
  readingMinutes: number;
  isFeatured: boolean;
  categoryId: string | null;
  featuredAlt: string | null;
  mediaKey: string | null;
  mediaAlt: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
};

function selectPosts(tx: Tx) {
  return tx
    .select(postColumns)
    .from(bp)
    .leftJoin(schema.media, and(eq(schema.media.tenantId, bp.tenantId), eq(schema.media.id, bp.featuredImageMediaId)));
}

function metaDescription(r: { excerpt: string | null; contentText: string }): string {
  if (r.excerpt) return r.excerpt;
  const t = r.contentText.slice(0, 160);
  return t.length < r.contentText.length ? `${t.replace(/\s+\S*$/, "")}…` : t;
}

async function loadCategoryIndex(tx: Tx, tenantId: string) {
  const rows = await tx
    .select({
      id: schema.blogCategories.id,
      parentId: schema.blogCategories.parentId,
      name: schema.blogCategories.name,
      slug: schema.blogCategories.slug,
      description: schema.blogCategories.description,
      isActive: schema.blogCategories.isActive,
      position: schema.blogCategories.position,
    })
    .from(schema.blogCategories)
    .where(eq(schema.blogCategories.tenantId, tenantId))
    .orderBy(schema.blogCategories.position, schema.blogCategories.name);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ref = (id: string | null): BlogCategoryRef | null => {
    if (!id) return null;
    const c = byId.get(id);
    if (!c) return null;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return { id: c.id, name: c.name, slug: c.slug, path: parent ? `${parent.slug}/${c.slug}` : c.slug };
  };
  return { rows, byId, ref };
}

function toSummary(r: Row, ref: (id: string | null) => BlogCategoryRef | null): BlogPostSummary {
  const url = publicMediaUrl(r.mediaKey);
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: metaDescription(r),
    // A draft being previewed has no date yet: show today.
    publishedAt: (r.publishedAt ?? new Date()).toISOString(),
    authorName: r.authorName,
    readingMinutes: r.readingMinutes,
    isFeatured: r.isFeatured,
    image: url ? { url, alt: r.featuredAlt?.trim() || r.mediaAlt?.trim() || r.title, width: r.mediaWidth, height: r.mediaHeight } : null,
    category: ref(r.categoryId),
  };
}

export async function getPublicBlogSettings(rt: Runtime, ctx: TenantContext): Promise<BlogSettings> {
  return withTenant(rt._db.db, ctx.tenantId, (tx) => readBlogSettings(tx, ctx.tenantId));
}

/** Active categories with the number of visible posts in each (a parent counts its subcategories' posts). */
export async function listPublicBlogCategories(rt: Runtime, ctx: TenantContext): Promise<PublicBlogCategory[]> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const settings = await readBlogSettings(tx, ctx.tenantId);
    if (!settings.enabled) return [];
    const { rows, ref } = await loadCategoryIndex(tx, ctx.tenantId);
    const counts = await tx
      .select({ categoryId: bp.categoryId, n: sql<number>`count(*)::int` })
      .from(bp)
      .where(and(eq(bp.tenantId, ctx.tenantId), visible))
      .groupBy(bp.categoryId);
    const own = new Map(counts.map((c) => [c.categoryId, c.n]));
    const active = rows.filter((r) => r.isActive);
    const build = (parentId: string | null): PublicBlogCategory[] =>
      active
        .filter((r) => (r.parentId ?? null) === parentId)
        .map((r) => {
          const children = parentId === null ? build(r.id) : [];
          const postCount = (own.get(r.id) ?? 0) + children.reduce((s, c) => s + c.postCount, 0);
          return { ...(ref(r.id) as BlogCategoryRef), description: r.description, postCount, children };
        });
    // A subcategory is only listed while its parent is active.
    return build(null);
  });
}

export interface PublicBlogListQuery {
  page?: number | undefined;
  perPage?: number | undefined;
  /** "parent" or "parent/child" as in the URL. */
  categoryPath?: string | undefined;
  categoryId?: string | undefined;
  featuredOnly?: boolean | undefined;
}

export interface PublicBlogList {
  enabled: boolean;
  settings: BlogSettings;
  posts: BlogPostSummary[];
  total: number;
  page: number;
  pages: number;
  category: (BlogCategoryRef & { description: string | null; parent: BlogCategoryRef | null; seo: BlogSeoInput | null }) | null;
  /** True when a category path was asked for but does not exist or is not visible. */
  categoryMissing: boolean;
}

export async function listPublicBlogPosts(rt: Runtime, ctx: TenantContext, q: PublicBlogListQuery = {}): Promise<PublicBlogList> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const settings = await readBlogSettings(tx, ctx.tenantId);
    const empty: PublicBlogList = { enabled: settings.enabled, settings, posts: [], total: 0, page: 1, pages: 1, category: null, categoryMissing: false };
    if (!settings.enabled) return empty;
    const { rows, byId, ref } = await loadCategoryIndex(tx, ctx.tenantId);

    let categoryId = q.categoryId ?? null;
    let category: PublicBlogList["category"] = null;
    if (q.categoryPath) {
      const [first, second, ...rest] = q.categoryPath.split("/").filter(Boolean);
      const top = rows.find((r) => r.isActive && !r.parentId && r.slug === first);
      const hit = second ? rows.find((r) => r.isActive && r.parentId === top?.id && r.slug === second) : top;
      if (!first || rest.length > 0 || !top || !hit) return { ...empty, categoryMissing: true };
      categoryId = hit.id;
    }
    if (categoryId) {
      const c = byId.get(categoryId);
      if (!c || !c.isActive) return { ...empty, categoryMissing: true };
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      if (parent && !parent.isActive) return { ...empty, categoryMissing: true };
      const [seoRow] = await tx
        .select({ seo: schema.blogCategories.seo })
        .from(schema.blogCategories)
        .where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.id, categoryId)))
        .limit(1);
      category = { ...(ref(categoryId) as BlogCategoryRef), description: c.description, parent: ref(c.parentId), seo: (seoRow?.seo as BlogSeoInput | null) ?? null };
    }

    const conds: SQL[] = [eq(bp.tenantId, ctx.tenantId), visible];
    if (categoryId) {
      // A parent category lists its subcategories' posts as well.
      conds.push(sql`${bp.categoryId} in (select id from blog_categories where tenant_id = ${ctx.tenantId} and (id = ${categoryId} or parent_id = ${categoryId}))`);
    }
    if (q.featuredOnly) conds.push(eq(bp.isFeatured, true));
    const where = and(...conds);
    const perPage = Math.min(Math.max(q.perPage ?? settings.postsPerPage, 1), 48);
    const [tot] = await tx.select({ n: sql<number>`count(*)::int` }).from(bp).where(where);
    const total = tot?.n ?? 0;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(q.page ?? 1, 1), pages);
    const list = await selectPosts(tx)
      .where(where)
      .orderBy(desc(bp.publishedAt), desc(bp.id))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return { enabled: true, settings, posts: list.map((r) => toSummary(r, ref)), total, page, pages, category, categoryMissing: false };
  });
}

/** Newest posts for the Recent Posts widget: one query, bounded by `limit`. Runs inside the caller's tenant transaction. */
export async function recentBlogPostsTx(
  tx: Tx,
  tenantId: string,
  opts: { limit?: number | undefined; categorySlug?: string | undefined; featuredOnly?: boolean | undefined } = {},
): Promise<{ posts: BlogPostSummary[]; enabled: boolean; categoryPath: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 12);
  const settings = await readBlogSettings(tx, tenantId);
  if (!settings.enabled) return { posts: [], enabled: false, categoryPath: null };
  const { rows, ref } = await loadCategoryIndex(tx, tenantId);
  const conds: SQL[] = [eq(bp.tenantId, tenantId), visible];
  let categoryPath: string | null = null;
  if (opts.categorySlug) {
    const c = rows.find((r) => r.isActive && r.slug === opts.categorySlug);
    if (!c) return { posts: [], enabled: true, categoryPath: null };
    categoryPath = ref(c.id)?.path ?? null;
    conds.push(sql`${bp.categoryId} in (select id from blog_categories where tenant_id = ${tenantId} and (id = ${c.id} or parent_id = ${c.id}))`);
  }
  if (opts.featuredOnly) conds.push(eq(bp.isFeatured, true));
  const list = await selectPosts(tx).where(and(...conds)).orderBy(desc(bp.publishedAt), desc(bp.id)).limit(limit);
  return { posts: list.map((r) => toSummary(r, ref)), enabled: true, categoryPath };
}

export async function getRecentBlogPosts(
  rt: Runtime,
  ctx: TenantContext,
  opts: { limit?: number | undefined; categorySlug?: string | undefined; featuredOnly?: boolean | undefined } = {},
): Promise<{ posts: BlogPostSummary[]; enabled: boolean }> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const { posts, enabled } = await recentBlogPostsTx(tx, ctx.tenantId, opts);
    return { posts, enabled };
  });
}

export type PublicBlogPostResult =
  | { kind: "post"; post: BlogPostPage; settings: BlogSettings; preview: boolean }
  | { kind: "redirect"; slug: string }
  | { kind: "missing" };

/**
 * One post for the storefront. With a valid preview token (see preview.ts) the post shows whatever its state, so a
 * draft can be reviewed; without one only visible posts resolve. Related posts and neighbours are always public ones.
 */
export async function getPublicBlogPost(rt: Runtime, ctx: TenantContext, slug: string, opts: { previewToken?: string | undefined } = {}): Promise<PublicBlogPostResult> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const settings = await readBlogSettings(tx, ctx.tenantId);
    if (!settings.enabled && !opts.previewToken) return { kind: "missing" };
    const { ref } = await loadCategoryIndex(tx, ctx.tenantId);
    let preview = false;
    if (opts.previewToken) {
      const [cand] = await tx.select({ id: bp.id }).from(bp).where(and(eq(bp.tenantId, ctx.tenantId), eq(bp.slug, slug))).limit(1);
      preview = cand ? verifyBlogPreviewToken(ctx.tenantId, cand.id, opts.previewToken) : false;
    }
    const [row] = await selectPosts(tx)
      .where(and(eq(bp.tenantId, ctx.tenantId), eq(bp.slug, slug), preview ? sql`true` : visible))
      .limit(1);
    if (!row) {
      const [red] = await tx
        .select({ slug: bp.slug })
        .from(schema.blogSlugRedirects)
        .innerJoin(bp, and(eq(bp.tenantId, schema.blogSlugRedirects.tenantId), eq(bp.id, schema.blogSlugRedirects.postId)))
        .where(and(eq(schema.blogSlugRedirects.tenantId, ctx.tenantId), eq(schema.blogSlugRedirects.fromSlug, slug), visible))
        .limit(1);
      return red ? { kind: "redirect", slug: red.slug } : { kind: "missing" };
    }
    const [full] = await tx
      .select({ contentHtml: bp.contentHtml, updatedAt: bp.updatedAt, seo: bp.seo })
      .from(bp)
      .where(and(eq(bp.tenantId, ctx.tenantId), eq(bp.id, row.id)))
      .limit(1);
    const seo = (full?.seo as BlogSeoInput | null) ?? null;
    let seoImage: BlogImage | null = null;
    if (seo?.imageMediaId) {
      const [m] = await tx
        .select({ key: schema.media.storageKey, alt: schema.media.alt, width: schema.media.width, height: schema.media.height })
        .from(schema.media)
        .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, seo.imageMediaId)))
        .limit(1);
      const url = publicMediaUrl(m?.key);
      if (m && url) seoImage = { url, alt: m.alt ?? row.title, width: m.width, height: m.height };
    }
    // Related: same category first, then the newest others.
    const rel = await selectPosts(tx)
      .where(and(eq(bp.tenantId, ctx.tenantId), visible, sql`${bp.id} <> ${row.id}`))
      .orderBy(sql`(${bp.categoryId} is not distinct from ${row.categoryId}) desc`, desc(bp.publishedAt))
      .limit(3);
    const [prev] = await tx
      .select({ slug: bp.slug, title: bp.title })
      .from(bp)
      .where(and(eq(bp.tenantId, ctx.tenantId), visible, sql`${bp.publishedAt} < ${row.publishedAt}`))
      .orderBy(desc(bp.publishedAt))
      .limit(1);
    const [next] = await tx
      .select({ slug: bp.slug, title: bp.title })
      .from(bp)
      .where(and(eq(bp.tenantId, ctx.tenantId), visible, sql`${bp.publishedAt} > ${row.publishedAt}`))
      .orderBy(bp.publishedAt)
      .limit(1);
    const html = full?.contentHtml ?? "";
    return {
      kind: "post",
      preview,
      settings,
      post: {
        ...toSummary(row, ref),
        contentHtml: html,
        headings: extractHeadings(html),
        modifiedAt: (full?.updatedAt ?? row.publishedAt ?? new Date()).toISOString(),
        seo,
        seoImage,
        noindex: seo?.noindex === true,
        related: rel.map((r) => toSummary(r, ref)),
        previous: prev ?? null,
        next: next ?? null,
      },
    };
  });
}

/**
 * Menu links to a blog category or a post (ADR-033): only live targets resolve, so a hidden category or a draft
 * never shows in navigation. Runs inside the caller's tenant transaction.
 */
export async function blogMenuTargetsTx(
  tx: Tx,
  tenantId: string,
  want: { categoryIds: ReadonlySet<string>; postIds: ReadonlySet<string> },
): Promise<{ categories: Map<string, string>; posts: Map<string, string> }> {
  const out = { categories: new Map<string, string>(), posts: new Map<string, string>() };
  const settings = await readBlogSettings(tx, tenantId);
  if (!settings.enabled) return out;
  if (want.categoryIds.size > 0) {
    const { rows, ref } = await loadCategoryIndex(tx, tenantId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of want.categoryIds) {
      const c = byId.get(id);
      const parent = c?.parentId ? byId.get(c.parentId) : undefined;
      if (c?.isActive && (!c.parentId || parent?.isActive)) out.categories.set(id, ref(id)?.path ?? c.slug);
    }
  }
  if (want.postIds.size > 0) {
    const rows = await tx
      .select({ id: bp.id, slug: bp.slug })
      .from(bp)
      .where(and(eq(bp.tenantId, tenantId), visible, sql`${bp.id} in (${sql.join([...want.postIds].map((id) => sql`${id}::uuid`), sql`, `)})`));
    for (const r of rows) out.posts.set(r.id, r.slug);
  }
  return out;
}

/** Visible, indexable posts and active categories for the sitemap (runs inside the caller's tenant transaction). */
export async function listBlogForSitemap(tx: Tx, tenantId: string) {
  const settings = await readBlogSettings(tx, tenantId);
  if (!settings.enabled) return { enabled: false, posts: [] as { slug: string; lastmod: Date }[], categories: [] as { path: string; lastmod: Date }[] };
  const posts = await tx
    .select({ slug: bp.slug, updatedAt: bp.updatedAt, seo: bp.seo })
    .from(bp)
    .where(and(eq(bp.tenantId, tenantId), visible))
    .orderBy(desc(bp.publishedAt));
  const { rows, ref } = await loadCategoryIndex(tx, tenantId);
  const counted = await listPublicBlogCategoriesFlat(tx, tenantId, rows);
  const cats = counted.map((id) => ({ path: ref(id)?.path ?? "", lastmod: new Date() })).filter((c) => c.path);
  return {
    enabled: true,
    posts: posts.filter((p) => (p.seo as BlogSeoInput | null)?.noindex !== true).map((p) => ({ slug: p.slug, lastmod: p.updatedAt })),
    categories: cats,
  };
}

/** Ids of active categories (with an active parent) that have at least one visible post, parents included. */
async function listPublicBlogCategoriesFlat(
  tx: Tx,
  tenantId: string,
  rows: { id: string; parentId: string | null; isActive: boolean }[],
): Promise<string[]> {
  const counts = await tx
    .select({ categoryId: bp.categoryId })
    .from(bp)
    .where(and(eq(bp.tenantId, tenantId), visible))
    .groupBy(bp.categoryId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Set<string>();
  for (const c of counts) {
    if (!c.categoryId) continue;
    const cat = byId.get(c.categoryId);
    if (!cat?.isActive) continue;
    out.add(cat.id);
    if (cat.parentId && byId.get(cat.parentId)?.isActive) out.add(cat.parentId);
  }
  return [...out];
}

/** Latest posts for RSS: summaries plus the plain-text body start (the feed carries excerpts only). */
export async function listBlogForFeed(rt: Runtime, ctx: TenantContext, limit = 20) {
  const res = await getRecentBlogPosts(rt, ctx, { limit: Math.min(limit, 20) });
  const settings = await getPublicBlogSettings(rt, ctx);
  return { enabled: res.enabled, settings, posts: res.posts };
}
