import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { buildBlogPostMetadata, evaluateStorefrontAccess, generateBlogPostingJsonLd, generateBreadcrumbJsonLd } from "@bs/domain";
import { getBlockDefinition, type BlockInstance, type BlogPostOptions } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedBlogPost, getCachedStoreName, getCachedThemePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { BlogPostSection } from "./BlogPostSection.tsx";
import { JsonLd } from "./JsonLd.tsx";

async function request() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  return { host, tenantId: access.tenantId ?? null, noindex: Boolean(access.noindex) };
}

export async function blogPostMetadata(slug: string): Promise<Metadata> {
  const { host, tenantId, noindex } = await request();
  if (!tenantId) return { title: "Not found" };
  const [res, storeName] = await Promise.all([getCachedBlogPost(tenantId, slug), getCachedStoreName(tenantId)]);
  if (res.kind !== "post") return { title: "Not found", robots: { index: false } };
  const m = buildBlogPostMetadata({ post: res.post, storeName, host, storeNoindex: noindex });
  return { title: m.title, description: m.description, robots: m.robots, alternates: m.alternates, openGraph: m.openGraph, twitter: m.twitter };
}

export async function BlogPostPage({ slug }: { slug: string }) {
  const { host, tenantId } = await request();
  if (!tenantId) notFound();
  const res = await getCachedBlogPost(tenantId, slug);
  // A changed address keeps working: 308 to the new one.
  if (res.kind === "redirect") permanentRedirect(`/blog/${res.slug}`);
  if (res.kind === "missing") notFound();
  const { post, settings } = res;
  const [template, storeName] = await Promise.all([getCachedThemePage(tenantId, "blog-post"), getCachedStoreName(tenantId)]);

  const base = `https://${host}`;
  const postUrl = `${base}/blog/${post.slug}`;
  const crumbs = [
    { name: "Home", url: base },
    { name: settings.title, url: `${base}/blog` },
    ...(post.category ? [{ name: post.category.name, url: `${base}/blog/category/${post.category.path}` }] : []),
    { name: post.title, url: postUrl },
  ];
  const blocks: BlockInstance[] = template?.blocks ?? [{ id: "default-blog-post", type: "BlogPostContent", version: 1, props: { ...getBlockDefinition("BlogPostContent").defaultProps } }];

  return (
    <div className="bs-skin">
      <JsonLd data={generateBlogPostingJsonLd({ post, host, storeName })} />
      <JsonLd data={generateBreadcrumbJsonLd(crumbs)} />
      <BlockRenderer
        blocks={blocks}
        renderData={template?.renderData}
        context={{
          renderBlogPost: (options: BlogPostOptions) => <BlogPostSection post={post} options={options} postUrl={postUrl} blogTitle={settings.title} />,
        }}
      />
    </div>
  );
}
