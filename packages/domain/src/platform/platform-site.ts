import { and, eq, inArray, ne } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { THEME_PAGE_TYPES } from "@bs/blocks";
import { getStorefrontPageByPath } from "../content-services.ts";
import type { Runtime } from "../runtime.ts";
import { listBlogForSitemap } from "../blog/queries.ts";
import { loadMenusData } from "../themes/block-data.ts";

/**
 * bcom.si's own content (pages, blog, menus) lives under one internal `platform_site` tenant, so the existing content
 * services and tables work unchanged (ADR-042). It is not a store: it has no owner, plan, trial or domain row, it is
 * hidden from Super Admin's store screens, and store actions refuse it.
 */
export const PLATFORM_SITE_SLUG = "bcom-platform-site";

/** The internal record's id, or null before it has been created. */
export async function getPlatformSiteId(db: Db): Promise<string | null> {
  const [row] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.kind, "platform_site")).limit(1);
  return row?.id ?? null;
}

/** Store actions (suspend, delete, plan changes, support sessions...) must never reach the internal record. */
export async function assertStoreTenants(db: Db, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const [row] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(inArray(schema.tenants.id, tenantIds), ne(schema.tenants.kind, "store")))
    .limit(1);
  if (row) throw new Error("Conflict: this is the platform's own website, not a store");
}

/** The website's blog URLs for the marketing sitemap. Empty until something is published. */
export async function platformSiteBlogSitemap(db: Db, origin: string) {
  const siteId = await getPlatformSiteId(db);
  if (!siteId) return [];
  const blog = await withTenant(db, siteId, (tx) => listBlogForSitemap(tx, siteId));
  if (blog.posts.length === 0) return [];
  return [
    { loc: `${origin}/blog`, lastmod: (blog.posts[0]?.lastmod ?? new Date()).toISOString(), changefreq: "weekly" as const, priority: 0.6 },
    ...blog.categories.map((c) => ({ loc: `${origin}/blog/category/${c.path}`, lastmod: c.lastmod.toISOString(), changefreq: "weekly" as const, priority: 0.5 })),
    ...blog.posts.map((p) => ({ loc: `${origin}/blog/${p.slug}`, lastmod: p.lastmod.toISOString(), changefreq: "monthly" as const, priority: 0.6 })),
  ];
}

/** Links of the website's `header` menu, or null when it has none: the site then keeps its built-in links. */
export async function platformSiteHeaderLinks(db: Db): Promise<Array<{ label: string; href: string }> | null> {
  const siteId = await getPlatformSiteId(db);
  if (!siteId) return null;
  const header = { id: "site-header", type: "SiteHeader", version: 1, props: { menuHandle: "header" } };
  const { headerData } = await withTenant(db, siteId, (tx) => loadMenusData(tx as never, siteId, [header] as never, []));
  const links = (headerData[header.id] ?? []).flatMap((item) => (item.url ? [{ label: item.label, href: item.url }] : []));
  return links.length > 0 ? links : null;
}

/**
 * A published website page by its URL path, or null. Read on each request, not cached: publishing happens in the Platform
 * service, which cannot clear the web app's cache, and "publish shows at once" matters more here than one query.
 */
export async function getPlatformSitePage(rt: Runtime, path: string[]) {
  const siteId = await getPlatformSiteId(rt._db.db);
  if (!siteId) return null;
  return getStorefrontPageByPath(rt, { tenantId: siteId, storeStatus: "live", actor: { type: "system" }, roles: [], permissions: [], requestId: crypto.randomUUID() }, path);
}

/** The website's published pages for the marketing sitemap. `/about` has its own URL, so it is listed once by the caller. */
export async function platformSitePagesSitemap(db: Db, origin: string) {
  const siteId = await getPlatformSiteId(db);
  if (!siteId) return [];
  const rows = await withTenant(db, siteId, (tx) =>
    tx.select({ slug: schema.pages.slug, type: schema.pages.type, parentId: schema.pages.parentId, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(eq(schema.pages.status, "published")),
  );
  return rows
    .filter((r) => !r.parentId && r.slug !== "about" && !THEME_PAGE_TYPES.has(r.type ?? ""))
    .map((r) => ({ loc: `${origin}/pages/${r.slug}`, lastmod: r.updatedAt.toISOString(), changefreq: "monthly" as const, priority: 0.5 }));
}
