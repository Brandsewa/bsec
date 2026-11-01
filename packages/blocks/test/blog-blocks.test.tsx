import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BlogPostContentSchema,
  BlogListingSchema,
  renderBlockTree,
  validateBlockDocument,
  THEME_SYSTEM_PAGES,
  type BlockBlogPost,
  type BlockInstance,
} from "../src/index.ts";

const block = (id: string, type: BlockInstance["type"], props: Record<string, unknown> = {}): BlockInstance => ({ id, type, version: 1, props });
const post = (n: number, over: Partial<BlockBlogPost> = {}): BlockBlogPost => ({
  slug: `post-${n}`,
  title: `Post ${n} <b>bold</b>`,
  excerpt: "A summary.",
  publishedAt: "2026-03-01T10:00:00.000Z",
  authorName: "Asha",
  readingMinutes: 4,
  imageUrl: `https://media.example/${n}.jpg`,
  imageWidth: 800,
  imageHeight: 600,
  categoryName: "Guides",
  categoryPath: "guides",
  ...over,
});
const render = (blocks: BlockInstance[], data: Record<string, unknown> | undefined) =>
  renderToStaticMarkup(<>{renderBlockTree(blocks, { data: data as never })}</>);

describe("blog blocks", () => {
  it("validate with defaults only and are registered as theme pages", () => {
    for (const type of ["BlogListing", "BlogPostContent", "BlogShowcase"] as const) {
      expect(validateBlockDocument({ version: 1, blocks: [block(`${type}-1`, type)] }).success, type).toBe(true);
    }
    expect(THEME_SYSTEM_PAGES.blog.type).toBe("blog_archive_template");
    expect(THEME_SYSTEM_PAGES["blog-post"].type).toBe("blog_post_template");
  });

  it("keeps the listing and post settings inside their limits", () => {
    expect(BlogListingSchema.safeParse({ postsPerPage: 49 }).success).toBe(false);
    expect(BlogPostContentSchema.safeParse({ relatedCount: 7 }).success).toBe(false);
  });
});

describe("Blog slider widget", () => {
  it("draws the posts it is given with links, dates, categories and escaped text", () => {
    const html = render([block("w", "BlogShowcase", { title: "Latest" })], { w: { kind: "blog-posts", posts: [post(1), post(2)], viewAllHref: "/blog" } });
    expect(html).toContain('href="/blog/post-1"');
    expect(html).toContain('href="/blog/post-2"');
    expect(html).toContain("Post 1 &lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain('href="/blog/category/guides"');
  });
});

describe("archive and single post cores", () => {
  it("call the host when it supplies them and draw labelled samples otherwise", () => {
    const html = renderToStaticMarkup(<>{renderBlockTree([block("l", "BlogListing", { title: "Our blog" })], { renderBlogListing: (o) => <div data-listing={o.title} /> })}</>);
    expect(html).toContain('data-listing="Our blog"');
    expect(renderToStaticMarkup(<>{renderBlockTree([block("l", "BlogListing", {})], {})}</>)).toContain("Blog archive");
    const single = renderToStaticMarkup(<>{renderBlockTree([block("p", "BlogPostContent", {})], { renderBlogPost: (o) => <div data-toc={String(o.showToc)} /> })}</>);
    expect(single).toContain('data-toc="true"');
    expect(renderToStaticMarkup(<>{renderBlockTree([block("p", "BlogPostContent", {})], {})}</>)).toContain("Blog post");
  });
});
