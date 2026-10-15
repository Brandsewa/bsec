import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import {
  buildBlogArchiveMetadata,
  evaluateStorefrontAccess,
  generateBlogListJsonLd,
  generateBreadcrumbJsonLd,
} from "@bs/domain";
import { getBlockDefinition, type BlockInstance, type BlogListingOptions } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedBlogList, getCachedStoreName, getCachedThemePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { BlogListingSection } from "./BlogListingSection.tsx";
import { JsonLd } from "./JsonLd.tsx";

/**
 * /blog, /blog/page/n and the category pages share this body (ADR-033). Layout comes from the store's
 * blog archive template when it has one, else from the same BlogListing block with default settings.
 */

async function request() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  return { host, tenantId: access.tenantId ?? null, noindex: Boolean(access.noindex) };
}

/** The template first: its "posts per page" (when set) wins over the store's blog setting. */
async function loadArchive(tenantId: string, categoryPath: string | undefined, page: number) {
  const template = await getCachedThemePage(tenantId, "blog");
  let perPage: number | undefined;
  for (const b of template?.blocks ?? []) {
    const n = b.type === "BlogListing" ? Number(b.props["postsPerPage"]) : 0;
    if (n > 0) perPage = n;
  }
  const { list, categories } = await getCachedBlogList(tenantId, { page, ...(categoryPath ? { categoryPath } : {}), ...(perPage ? { perPage } : {}) });
  return { template, list, categories };
}

export async function blogArchiveMetadata(categoryPath: string | undefined, page: number): Promise<Metadata> {
  const { host, tenantId, noindex } = await request();
  if (!tenantId) return { title: "Blog" };
  const [{ list }, storeName] = await Promise.all([loadArchive(tenantId, categoryPath, page), getCachedStoreName(tenantId)]);
  if (!list.enabled || list.categoryMissing) return { title: "Not found", robots: { index: false } };
  const m = buildBlogArchiveMetadata({ list, settings: list.settings, storeName, host, storeNoindex: noindex });
  return { title: m.title, description: m.description, robots: m.robots, alternates: m.alternates, openGraph: m.openGraph, twitter: m.twitter };
}

export async function BlogArchivePage({ categoryPath, page }: { categoryPath?: string | undefined; page: number }) {
  const { host, tenantId } = await request();
  if (!tenantId) notFound();
  const [{ list, categories, template }, storeName] = await Promise.all([loadArchive(tenantId, categoryPath, page), getCachedStoreName(tenantId)]);
  if (!list.enabled || list.categoryMissing) notFound();
  // /blog/page/1 is /blog; a page number past the last page does not exist.
  if (page > list.pages) notFound();

  const base = `https://${host}`;
  const crumbs = [
    { name: "Home", url: base },
    { name: list.settings.title, url: `${base}/blog` },
    ...(list.category?.parent ? [{ name: list.category.parent.name, url: `${base}/blog/category/${list.category.parent.path}` }] : []),
    ...(list.category ? [{ name: list.category.name, url: `${base}/blog/category/${list.category.path}` }] : []),
  ];
  const blocks: BlockInstance[] = template?.blocks ?? [
    { id: "default-blog-archive", type: "BlogListing", version: 1, props: { ...getBlockDefinition("BlogListing").defaultProps, title: list.settings.title } },
  ];

  return (
    <div className="bs-skin">
      <JsonLd data={generateBreadcrumbJsonLd(crumbs)} />
      <JsonLd data={generateBlogListJsonLd({ list, settings: list.settings, host, storeName })} />
      <BlockRenderer
        blocks={blocks}
        renderData={template?.renderData}
        context={{
          renderBlogListing: (options: BlogListingOptions) => (
            <BlogListingSection
              list={list}
              categories={categories}
              options={options.title ? options : { ...options, title: list.settings.title }}
            />
          ),
        }}
      />
    </div>
  );
}

/** /blog/page/1 and /blog/category/x/page/1 are the first page. */
export function redirectFirstPage(basePath: string): never {
  permanentRedirect(basePath);
}
