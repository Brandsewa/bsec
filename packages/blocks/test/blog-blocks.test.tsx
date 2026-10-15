import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BlogPostContentSchema,
  BlogPostsSchema,
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
    for (const type of ["BlogListing", "BlogPostContent", "BlogPosts"] as const) {
      expect(validateBlockDocument({ version: 1, blocks: [block(`${type}-1`, type)] }).success, type).toBe(true);
    }
    expect(THEME_SYSTEM_PAGES.blog.type).toBe("blog_archive_template");
    expect(THEME_SYSTEM_PAGES["blog-post"].type).toBe("blog_post_template");
  });

  it("keeps the widget's settings inside their limits", () => {
    expect(BlogPostsSchema.safeParse({ count: 13 }).success).toBe(false);
    expect(BlogPostsSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(BlogPostsSchema.safeParse({ layout: "carousel" }).success).toBe(false);
    expect(BlogPostsSchema.parse({})).toMatchObject({ count: 3, layout: "grid", source: "latest", hideWhenEmpty: true });
    expect(BlogListingSchema.safeParse({ postsPerPage: 49 }).success).toBe(false);
    expect(BlogPostContentSchema.safeParse({ relatedCount: 7 }).success).toBe(false);
  });
});

describe("Recent Posts widget", () => {
  const widget = block("w", "BlogPosts", { title: "Latest", count: 3 });

  it("draws the posts it is given with links, dates, categories and escaped text", () => {
    const html = render([widget], { w: { kind: "blog-posts", posts: [post(1), post(2)], viewAllHref: "/blog" } });
    expect(html).toContain('href="/blog/post-1"');
    expect(html).toContain('href="/blog/post-2"');
    expect(html).toContain("Post 1 &lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain('href="/blog/category/guides"');
    expect(html).toContain("1 Mar 2026");
    expect(html).toContain('href="/blog">View all posts');
    expect(html).toContain('width="800"');
    expect(html).toContain('loading="lazy"');
  });

  it("shows nothing at all, not even a heading, when there are no posts", () => {
    expect(render([widget], { w: { kind: "blog-posts", posts: [], viewAllHref: "/blog" } })).toBe("");
    const keep = block("w", "BlogPosts", { hideWhenEmpty: false });
    expect(render([keep], { w: { kind: "blog-posts", posts: [], viewAllHref: "/blog" } })).toContain("No posts to show yet.");
  });

  it("shows labelled samples only where there is no store data at all (the theme editor)", () => {
    expect(render([widget], undefined)).toContain("A sample post about something useful");
    expect(render([widget], {})).toContain("A sample post about something useful");
  });

  it("slider, list and grid layouts and the view-all link target follow the settings", () => {
    const data = { w: { kind: "blog-posts", posts: [post(1)], viewAllHref: "/blog/category/guides" } };
    expect(render([block("w", "BlogPosts", { layout: "slider" })], data)).toContain("bsb-blog-slider");
    expect(render([block("w", "BlogPosts", { layout: "list" })], data)).toContain("bsb-blog-list");
    expect(render([block("w", "BlogPosts", { layout: "grid", columns: "2" })], data)).toContain("--cols:2");
    expect(render([block("w", "BlogPosts", { showViewAll: false })], data)).not.toContain("View all posts");
    expect(render([block("w", "BlogPosts", {})], data)).toContain('href="/blog/category/guides">View all');
    const bare = render([block("w", "BlogPosts", { showImage: false, showExcerpt: false, showDate: false, showCategory: false })], data);
    expect(bare).not.toContain("<img");
    expect(bare).not.toContain("A summary.");
    expect(bare).not.toContain("1 Mar 2026");
  });

  it("uses the placeholder picture when a post has none", () => {
    const html = render([widget], { w: { kind: "blog-posts", posts: [post(1, { imageUrl: undefined, imageWidth: undefined, imageHeight: undefined })], viewAllHref: "/blog" } });
    expect(html).toContain("placeholder");
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
