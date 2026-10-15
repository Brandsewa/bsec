import { describe, expect, it } from "vitest";
import {
  buildBlogArchiveMetadata,
  buildBlogFeedXml,
  buildBlogPostMetadata,
  generateBlogListJsonLd,
  generateBlogPostingJsonLd,
  type BlogPostPage,
  type BlogPostSummary,
  type PublicBlogList,
} from "../src/index.ts";

const settings = { enabled: true, title: "Blog", description: "", postsPerPage: 9 };
const summary = (over: Partial<BlogPostSummary> = {}): BlogPostSummary => ({
  id: "p1",
  slug: "hello-world",
  title: "Hello <World> & friends",
  excerpt: "A short summary.",
  publishedAt: "2026-03-01T10:00:00.000Z",
  authorName: "Asha",
  readingMinutes: 3,
  isFeatured: false,
  image: { url: "https://media.example/a.jpg", alt: "A picture", width: 1200, height: 800 },
  category: { id: "c1", name: "Guides", slug: "guides", path: "guides" },
  ...over,
});
const post = (over: Partial<BlogPostPage> = {}): BlogPostPage => ({
  ...summary(),
  contentHtml: '<h2 id="a">A</h2><p>one two three four five</p>',
  headings: [{ id: "a", text: "A", level: 2 }],
  modifiedAt: "2026-03-02T10:00:00.000Z",
  seo: null,
  seoImage: null,
  noindex: false,
  related: [],
  previous: null,
  next: null,
  ...over,
});

describe("blog post metadata", () => {
  it("uses the post, a canonical on the store host, article Open Graph and a feed link", () => {
    const m = buildBlogPostMetadata({ post: post(), storeName: "Acme", host: "shop.example.com" });
    expect(m.title).toBe("Hello <World> & friends | Acme");
    expect(m.description).toBe("A short summary.");
    expect(m.alternates.canonical).toBe("https://shop.example.com/blog/hello-world");
    expect(m.alternates.types?.["application/rss+xml"]).toBe("https://shop.example.com/blog/feed.xml");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.openGraph).toMatchObject({ type: "article", publishedTime: "2026-03-01T10:00:00.000Z", modifiedTime: "2026-03-02T10:00:00.000Z", authors: ["Asha"], section: "Guides" });
    expect(m.openGraph.images?.[0]).toMatchObject({ url: "https://media.example/a.jpg", width: 1200, height: 800 });
    expect(m.twitter.card).toBe("summary_large_image");
  });

  it("prefers the SEO fields and the social image, and falls back to the store image", () => {
    const seoImage = { url: "https://media.example/social.jpg", alt: "s", width: null, height: null };
    const m = buildBlogPostMetadata({ post: post({ seo: { title: "Custom title", description: "Custom description" }, seoImage }), storeName: "Acme", host: "shop.example.com" });
    expect(m.title).toBe("Custom title | Acme");
    expect(m.description).toBe("Custom description");
    expect(m.openGraph.images?.[0]?.url).toBe("https://media.example/social.jpg");
    const none = buildBlogPostMetadata({ post: post({ image: null }), storeName: "Acme", host: "shop.example.com", fallbackImageUrl: "https://media.example/store.jpg" });
    expect(none.openGraph.images?.[0]?.url).toBe("https://media.example/store.jpg");
    expect(buildBlogPostMetadata({ post: post({ image: null }), storeName: "Acme", host: "shop.example.com" }).twitter.card).toBe("summary");
  });

  it("is noindex for a hidden post, a closed store and a preview, and keeps the description short", () => {
    expect(buildBlogPostMetadata({ post: post({ noindex: true }), storeName: "A", host: "h.example" }).robots.index).toBe(false);
    expect(buildBlogPostMetadata({ post: post(), storeName: "A", host: "h.example", storeNoindex: true }).robots.index).toBe(false);
    expect(buildBlogPostMetadata({ post: post(), storeName: "A", host: "h.example", preview: true }).robots.index).toBe(false);
    const long = buildBlogPostMetadata({ post: post({ excerpt: "word ".repeat(100) }), storeName: "A", host: "h.example" });
    expect(long.description.length).toBeLessThanOrEqual(160);
  });
});

describe("blog archive metadata", () => {
  const list = (over: Partial<PublicBlogList> = {}): PublicBlogList => ({ enabled: true, settings, posts: [summary()], total: 1, page: 1, pages: 1, category: null, categoryMissing: false, ...over });

  it("is its own canonical per page and category, noindex when empty", () => {
    const home = buildBlogArchiveMetadata({ list: list(), settings, storeName: "Acme", host: "h.example" });
    expect(home.alternates.canonical).toBe("https://h.example/blog");
    expect(home.title).toBe("Blog | Acme");
    const p2 = buildBlogArchiveMetadata({ list: list({ page: 2, pages: 3 }), settings, storeName: "Acme", host: "h.example" });
    expect(p2.alternates.canonical).toBe("https://h.example/blog/page/2");
    expect(p2.title).toBe("Blog - Page 2 | Acme");
    const cat = { id: "c2", name: "Sizing", slug: "sizing", path: "guides/sizing", description: "Find your fit.", seo: null, parent: { id: "c1", name: "Guides", slug: "guides", path: "guides" } };
    const c = buildBlogArchiveMetadata({ list: list({ category: cat }), settings, storeName: "Acme", host: "h.example" });
    expect(c.alternates.canonical).toBe("https://h.example/blog/category/guides/sizing");
    expect(c.description).toBe("Find your fit.");
    expect(buildBlogArchiveMetadata({ list: list({ posts: [], total: 0 }), settings, storeName: "Acme", host: "h.example" }).robots.index).toBe(false);
  });
});

describe("blog structured data", () => {
  it("BlogPosting has every field search engines ask for and no undefined values", () => {
    const ld = generateBlogPostingJsonLd({ post: post(), host: "h.example", storeName: "Acme", logoUrl: "https://media.example/logo.png" });
    expect(ld).toMatchObject({
      "@type": "BlogPosting",
      headline: "Hello <World> & friends",
      image: ["https://media.example/a.jpg"],
      datePublished: "2026-03-01T10:00:00.000Z",
      dateModified: "2026-03-02T10:00:00.000Z",
      author: { "@type": "Person", name: "Asha" },
      publisher: { "@type": "Organization", name: "Acme", logo: { url: "https://media.example/logo.png" } },
      mainEntityOfPage: { "@id": "https://h.example/blog/hello-world" },
      articleSection: "Guides",
      wordCount: 6,
    });
    expect(JSON.stringify(ld)).not.toContain("undefined");
    expect(Object.values(ld).every((v) => v !== undefined && v !== "")).toBe(true);
  });

  it("the blog list carries Blog and ItemList with absolute urls", () => {
    const ld = generateBlogListJsonLd({
      list: { enabled: true, settings, posts: [summary(), summary({ slug: "two", id: "p2" })], total: 2, page: 1, pages: 1, category: null, categoryMissing: false },
      settings,
      host: "h.example",
      storeName: "Acme",
    }) as { "@type": string; blogPost: Array<{ url: string }>; mainEntity: { itemListElement: Array<{ position: number }> } };
    expect(ld["@type"]).toBe("Blog");
    expect(ld.blogPost.map((p) => p.url)).toEqual(["https://h.example/blog/hello-world", "https://h.example/blog/two"]);
    expect(ld.mainEntity.itemListElement.map((i) => i.position)).toEqual([1, 2]);
  });
});

describe("blog RSS feed", () => {
  it("is well formed, escapes text, uses absolute urls and lists newest first", () => {
    const xml = buildBlogFeedXml({
      posts: [summary({ title: "A & B <c>" }), summary({ id: "p2", slug: "older", publishedAt: "2026-02-01T00:00:00.000Z" })],
      settings,
      storeName: "Acme",
      host: "h.example",
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<title>A &amp; B &lt;c&gt;</title>");
    expect(xml).toContain("<link>https://h.example/blog/hello-world</link>");
    expect(xml.indexOf("hello-world")).toBeLessThan(xml.indexOf("older"));
    expect(xml).toContain('<atom:link href="https://h.example/blog/feed.xml" rel="self"');
    // Every tag opened is one of the feed's own: no raw markup from a title leaks through.
    const tags = [...xml.matchAll(/<\/?([a-zA-Z:]+)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(["rss", "channel", "title", "link", "description", "language", "lastBuildDate", "atom:link", "item", "guid", "pubDate", "category"]));
  });
});
