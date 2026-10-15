import type { BlogPostPage, BlogPostSummary, PublicBlogList } from "./queries.ts";
import type { BlogSettings } from "./shared.ts";

/**
 * SEO output for the blog (ADR-033, plan section 9): metadata, structured data and the RSS feed.
 * Pure functions, so every rule is unit tested. The metadata shapes are plain objects the storefront hands to Next.
 */

export interface BlogMetadata {
  title: string;
  description: string;
  robots: { index: boolean; follow: boolean };
  alternates: { canonical: string; types?: Record<string, string> };
  openGraph: {
    type: "article" | "website";
    title: string;
    description: string;
    url: string;
    siteName: string;
    images?: Array<{ url: string; width?: number; height?: number; alt?: string }>;
    publishedTime?: string;
    modifiedTime?: string;
    authors?: string[];
    section?: string;
  };
  twitter: { card: "summary_large_image" | "summary"; title: string; description: string; images?: string[] };
}

const trimTo = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);

export const blogBase = (host: string): string => `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
const feedLink = (host: string) => ({ "application/rss+xml": `${blogBase(host)}/blog/feed.xml` });

export function buildBlogPostMetadata(opts: {
  post: BlogPostPage;
  storeName: string;
  host: string;
  /** Store-level noindex (coming soon, password, maintenance). */
  storeNoindex?: boolean | undefined;
  /** The store's social image, used when the post has no picture of its own. */
  fallbackImageUrl?: string | undefined;
  preview?: boolean | undefined;
}): BlogMetadata {
  const { post, storeName, host } = opts;
  const base = blogBase(host);
  const url = `${base}/blog/${post.slug}`;
  const seo = post.seo;
  const title = trimTo((seo?.title?.trim() || post.title).trim(), 70);
  const description = trimTo(seo?.description?.trim() || post.excerpt, 160);
  const img = post.seoImage ?? post.image;
  const imageUrl = img?.url ?? opts.fallbackImageUrl;
  const index = !(opts.storeNoindex || post.noindex || opts.preview);
  return {
    title: `${title} | ${storeName}`,
    description,
    // A hidden post still lets crawlers follow its links; a closed store (coming soon, password) asks for neither.
    robots: { index, follow: !opts.storeNoindex },
    alternates: { canonical: url, types: feedLink(host) },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: storeName,
      ...(imageUrl ? { images: [{ url: imageUrl, ...(img?.width ? { width: img.width } : {}), ...(img?.height ? { height: img.height } : {}), alt: img?.alt ?? post.title }] } : {}),
      publishedTime: post.publishedAt,
      modifiedTime: post.modifiedAt,
      ...(post.authorName ? { authors: [post.authorName] } : {}),
      ...(post.category ? { section: post.category.name } : {}),
    },
    twitter: { card: imageUrl ? "summary_large_image" : "summary", title, description, ...(imageUrl ? { images: [imageUrl] } : {}) },
  };
}

/** Archive pages: /blog, /blog/page/n and the category pages. Each is its own canonical; empty ones are noindex. */
export function buildBlogArchiveMetadata(opts: {
  list: PublicBlogList;
  settings: BlogSettings;
  storeName: string;
  host: string;
  storeNoindex?: boolean | undefined;
  fallbackImageUrl?: string | undefined;
}): BlogMetadata {
  const { list, settings, storeName, host } = opts;
  const base = blogBase(host);
  const cat = list.category;
  const path = cat ? `/blog/category/${cat.path}` : "/blog";
  const url = `${base}${path}${list.page > 1 ? `/page/${list.page}` : ""}`;
  const baseTitle = cat ? cat.parent ? `${cat.name} (${cat.parent.name})` : cat.name : settings.title;
  const seoTitle = (cat?.seo?.title?.trim() || baseTitle).trim();
  const pageSuffix = list.page > 1 ? ` - Page ${list.page}` : "";
  const description = trimTo(
    (cat ? cat.seo?.description?.trim() || cat.description || `Posts in ${cat.name} from ${storeName}.` : settings.description || `Read the latest posts from ${storeName}.`) + "",
    160,
  );
  const index = !(opts.storeNoindex || list.total === 0);
  const title = `${seoTitle}${pageSuffix}`;
  return {
    title: `${title} | ${storeName}`,
    description,
    robots: { index, follow: true },
    alternates: { canonical: url, types: feedLink(host) },
    openGraph: { type: "website", title, description, url, siteName: storeName, ...(opts.fallbackImageUrl ? { images: [{ url: opts.fallbackImageUrl }] } : {}) },
    twitter: { card: opts.fallbackImageUrl ? "summary_large_image" : "summary", title, description, ...(opts.fallbackImageUrl ? { images: [opts.fallbackImageUrl] } : {}) },
  };
}

type Json = Record<string, unknown>;

export function generateBlogPostingJsonLd(opts: { post: BlogPostPage; host: string; storeName: string; logoUrl?: string | undefined }): Json {
  const { post, host, storeName } = opts;
  const url = `${blogBase(host)}/blog/${post.slug}`;
  const img = post.seoImage ?? post.image;
  const words = post.contentHtml.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: trimTo(post.title, 110),
    description: post.seo?.description?.trim() || post.excerpt,
    ...(img ? { image: [img.url] } : {}),
    datePublished: post.publishedAt,
    dateModified: post.modifiedAt,
    ...(post.authorName ? { author: { "@type": "Person", name: post.authorName } } : {}),
    publisher: { "@type": "Organization", name: storeName, ...(opts.logoUrl ? { logo: { "@type": "ImageObject", url: opts.logoUrl } } : {}) },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    ...(post.category ? { articleSection: post.category.name } : {}),
    wordCount: words,
    inLanguage: "en-IN",
  };
}

export function generateBlogListJsonLd(opts: { list: PublicBlogList; settings: BlogSettings; host: string; storeName: string }): Json {
  const { list, settings, host, storeName } = opts;
  const base = blogBase(host);
  const cat = list.category;
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: cat ? cat.name : settings.title,
    url: `${base}${cat ? `/blog/category/${cat.path}` : "/blog"}`,
    publisher: { "@type": "Organization", name: storeName },
    blogPost: list.posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${base}/blog/${p.slug}`, datePublished: p.publishedAt })),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: list.posts.map((p, i) => ({ "@type": "ListItem", position: (list.page - 1) * Math.max(list.posts.length, 1) + i + 1, url: `${base}/blog/${p.slug}` })),
    },
  };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** RSS 2.0 with excerpts only (the full text stays on the site). Newest first, absolute URLs. */
export function buildBlogFeedXml(opts: { posts: BlogPostSummary[]; settings: BlogSettings; storeName: string; host: string }): string {
  const base = blogBase(opts.host);
  const items = opts.posts
    .map((p) => {
      const url = `${base}/blog/${p.slug}`;
      return [
        "    <item>",
        `      <title>${xml(p.title)}</title>`,
        `      <link>${xml(url)}</link>`,
        `      <guid isPermaLink="true">${xml(url)}</guid>`,
        `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        ...(p.category ? [`      <category>${xml(p.category.name)}</category>`] : []),
        `      <description>${xml(p.excerpt)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  const last = opts.posts[0] ? new Date(opts.posts[0].publishedAt).toUTCString() : new Date(0).toUTCString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xml(`${opts.settings.title} | ${opts.storeName}`)}</title>`,
    `    <link>${xml(`${base}/blog`)}</link>`,
    `    <description>${xml(opts.settings.description || `Latest posts from ${opts.storeName}`)}</description>`,
    "    <language>en-in</language>",
    `    <lastBuildDate>${last}</lastBuildDate>`,
    `    <atom:link href="${xml(`${base}/blog/feed.xml`)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
