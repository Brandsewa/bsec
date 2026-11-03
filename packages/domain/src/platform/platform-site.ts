import { and, eq, inArray, ne } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { BannerSchema, type BannerProps, MkFooterSchema, MkHeaderSchema, THEME_PAGE_TYPES, type BlockInstance, type MkFooterProps, type MkHeaderProps } from "@bs/blocks";
import { getStorefrontPageByPath } from "../content-services.ts";
import { getPublishedPolicy } from "../policies/service.ts";
import { getPrivacySettings } from "../privacy/service.ts";
import type { Runtime } from "../runtime.ts";
import { listBlogForSitemap } from "../blog/queries.ts";
import { loadMenusData, resolvePageRenderData } from "../themes/block-data.ts";

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
export async function platformSiteHeaderLinks(db: Db, menuHandle = "header"): Promise<Array<{ label: string; href: string }> | null> {
  const siteId = await getPlatformSiteId(db);
  if (!siteId) return null;
  const header = { id: "site-header", type: "SiteHeader", version: 1, props: { menuHandle } };
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
  const found = await getStorefrontPageByPath(rt, { tenantId: siteId, storeStatus: "live", actor: { type: "system" }, roles: [], permissions: [], requestId: crypto.randomUUID() }, path);
  if (!found) return null;
  // Images and menus its widgets show, resolved on the website record. A failed lookup leaves the widgets without them.
  const blocks = ((found.page.document as { blocks?: BlockInstance[] } | null)?.blocks ?? []) as BlockInstance[];
  const renderData = await getPlatformSiteRenderData(rt, blocks).catch(() => ({ data: {}, media: {}, mediaMeta: {} }));
  return { ...found, renderData };
}

/** The website's published pages for the marketing sitemap. `/about` has its own URL, so it is listed once by the caller. */
export async function platformSitePagesSitemap(db: Db, origin: string) {
  const siteId = await getPlatformSiteId(db);
  if (!siteId) return [];
  const rows = await withTenant(db, siteId, (tx) =>
    tx.select({ slug: schema.pages.slug, type: schema.pages.type, parentId: schema.pages.parentId, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(eq(schema.pages.status, "published")),
  );
  return rows
    .filter((r) => !r.parentId && r.slug !== "about" && r.slug !== "bcom-home" && !THEME_PAGE_TYPES.has(r.type ?? ""))
    .map((r) => ({ loc: `${origin}/pages/${r.slug}`, lastmod: r.updatedAt.toISOString(), changefreq: "monthly" as const, priority: 0.5 }));
}

export interface PlatformSiteStatus {
  mode: "live" | "coming_soon" | "maintenance";
  headline: string | null;
  showCountdown: boolean;
  launchAt: string | null;
  hideFromSearchEngines: boolean;
}

/**
 * What the public website should do. No record, no status row, an unknown mode or a read that fails all mean "live":
 * the website must never go dark because of a settings problem. Password mode is a store feature and is ignored here.
 */
export async function getPlatformSiteStatus(db: Db): Promise<PlatformSiteStatus> {
  const live: PlatformSiteStatus = { mode: "live", headline: null, showCountdown: false, launchAt: null, hideFromSearchEngines: false };
  try {
    const siteId = await getPlatformSiteId(db);
    if (!siteId) return live;
    return await withTenant(db, siteId, async (tx) => {
      const [row] = await tx.select().from(schema.storeStatus).where(eq(schema.storeStatus.tenantId, siteId)).limit(1);
      const [seo] = await tx.select({ indexingEnabled: schema.seoSettings.indexingEnabled }).from(schema.seoSettings).where(eq(schema.seoSettings.tenantId, siteId)).limit(1);
      const mode = row?.mode === "coming_soon" || row?.mode === "maintenance" ? row.mode : "live";
      return {
        mode,
        headline: row?.headline ?? null,
        showCountdown: row?.showCountdown ?? false,
        launchAt: row?.launchAt ? row.launchAt.toISOString() : null,
        hideFromSearchEngines: seo ? !seo.indexingEnabled : false,
      };
    });
  } catch {
    return live;
  }
}

/** The website's published policy (terms, privacy, refund, shipping, legal notice), or null so the built-in text shows. */
export async function getPlatformSitePolicy(db: Db, handle: Parameters<typeof getPublishedPolicy>[2]) {
  try {
    const siteId = await getPlatformSiteId(db);
    return siteId ? await getPublishedPolicy(db, siteId, handle) : null;
  } catch {
    return null;
  }
}

/** The privacy contact set in Settings, or null while nothing is set (the built-in details then show). */
export async function getPlatformSitePrivacy(rt: Runtime): Promise<{ email: string | null; officerName: string | null; slaDays: number } | null> {
  try {
    const siteId = await getPlatformSiteId(rt._db.db);
    if (!siteId) return null;
    const ctx = { tenantId: siteId, storeStatus: "live", actor: { type: "system" as const }, roles: [], permissions: ["settings.read"], requestId: crypto.randomUUID() };
    const p = await getPrivacySettings(rt, ctx as never);
    return p.privacyContactEmail || p.grievanceOfficerName ? { email: p.privacyContactEmail, officerName: p.grievanceOfficerName, slaDays: p.requestSlaDays } : null;
  } catch {
    return null;
  }
}

export interface PlatformSiteChrome {
  header: MkHeaderProps | null;
  /** The announcement bar above the header, when it is switched on. */
  announcement: BannerProps | null;
  footer: MkFooterProps | null;
}

/**
 * The website's published header, announcement bar and footer (Storefront > Pages > Header, Footer), or nulls so the
 * built-in ones show. Anything unreadable or invalid reads as "not set".
 */
export async function getPlatformSiteChrome(db: Db): Promise<PlatformSiteChrome> {
  const none: PlatformSiteChrome = { header: null, announcement: null, footer: null };
  try {
    const siteId = await getPlatformSiteId(db);
    if (!siteId) return none;
    const docs = await withTenant(db, siteId, async (tx) => {
      const pages = await tx.select({ type: schema.pages.type, versionId: schema.pages.publishedVersionId }).from(schema.pages).where(and(eq(schema.pages.status, "published"), inArray(schema.pages.type, ["header", "footer"])));
      const ids = pages.flatMap((p) => (p.versionId ? [p.versionId] : []));
      if (ids.length === 0) return [] as Array<{ type: string; blocks: BlockInstance[] }>;
      const versions = await tx.select({ id: schema.pageVersions.id, document: schema.pageVersions.document }).from(schema.pageVersions).where(inArray(schema.pageVersions.id, ids));
      return pages.flatMap((p) => {
        const v = versions.find((x) => x.id === p.versionId);
        return v ? [{ type: p.type ?? "", blocks: ((v.document as { blocks?: BlockInstance[] } | null)?.blocks ?? []) }] : [];
      });
    });
    const headerBlocks = docs.find((d) => d.type === "header")?.blocks ?? [];
    const footerBlocks = docs.find((d) => d.type === "footer")?.blocks ?? [];
    const header = headerBlocks.find((b) => b.type === "MkHeader" && !b.hidden);
    const banner = headerBlocks.find((b) => b.type === "Banner" && !b.hidden);
    const footer = footerBlocks.find((b) => b.type === "MkFooter" && !b.hidden);
    const bannerProps = banner ? BannerSchema.safeParse(banner.props) : null;
    const headerProps = header ? MkHeaderSchema.safeParse(header.props) : null;
    const footerProps = footer ? MkFooterSchema.safeParse(footer.props) : null;
    return {
      header: headerProps?.success ? headerProps.data : null,
      announcement: bannerProps?.success ? bannerProps.data : null,
      footer: footerProps?.success ? footerProps.data : null,
    };
  } catch {
    return none;
  }
}

/** Images and menus the blocks of a website page need, resolved on the website record. */
export async function getPlatformSiteRenderData(rt: Runtime, blocks: BlockInstance[]) {
  const siteId = await getPlatformSiteId(rt._db.db);
  if (!siteId) return { data: {}, media: {}, mediaMeta: {} };
  return resolvePageRenderData(rt, { tenantId: siteId, storeStatus: "live", actor: { type: "system" as const }, roles: [], permissions: ["content.write"], requestId: crypto.randomUUID() } as never, blocks);
}
