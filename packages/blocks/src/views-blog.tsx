/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockBlogPost, BlockRenderArgs, BlogListingOptions, BlogPostOptions } from "./types.ts";
import { PLACEHOLDER_IMAGE_URL } from "./media.ts";
import type * as R from "./registry.ts";

/**
 * Blog blocks (ADR-033). Pure views like the others: the Recent Posts widget reads its posts from the
 * server-resolved render data; the archive and single post are drawn by the storefront through
 * `renderBlogListing` / `renderBlogPost` and show labelled samples in the editors.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;

/** Dates are shown for an Indian store; a fixed zone keeps the server and the browser on the same day. */
export function formatBlogDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export interface BlogCardOptions {
  showImage: boolean;
  showExcerpt: boolean;
  showDate: boolean;
  showAuthor: boolean;
  showReadingTime?: boolean | undefined;
  showCategory: boolean;
  imageRatio: "landscape" | "square" | "portrait";
  excerptLines?: "2" | "3" | "4" | undefined;
  layout?: "grid" | "list" | undefined;
  /** The first picture on a page is the likely LCP: load it eagerly. */
  priority?: boolean | undefined;
}

/** One post card. Shared by the Recent Posts widget and the blog archive so both look the same. */
export function BlogCard({ post, options }: { post: BlockBlogPost; options: BlogCardOptions }): ReactNode {
  const href = `/blog/${post.slug}`;
  const meta = [
    options.showDate ? formatBlogDate(post.publishedAt) : "",
    options.showAuthor && post.authorName ? post.authorName : "",
    options.showReadingTime && post.readingMinutes ? `${post.readingMinutes} min read` : "",
  ].filter(Boolean);
  return (
    <article className={cx("bsb-blog-card", options.layout === "list" && "bsb-blog-card-row")}>
      {options.showImage ? (
        <a className={cx("bsb-blog-media", `bsb-blog-${options.imageRatio}`)} href={href} tabIndex={-1} aria-hidden="true">
          <img
            src={post.imageUrl ?? PLACEHOLDER_IMAGE_URL}
            alt=""
            loading={options.priority ? "eager" : "lazy"}
            {...(options.priority ? { fetchPriority: "high" as const } : {})}
            {...(post.imageWidth && post.imageHeight ? { width: post.imageWidth, height: post.imageHeight } : {})}
          />
        </a>
      ) : null}
      <div className="bsb-blog-body">
        {options.showCategory && post.categoryName ? (
          <a className="bsb-blog-cat" href={post.categoryPath ? `/blog/category/${post.categoryPath}` : "/blog"}>
            {post.categoryName}
          </a>
        ) : null}
        <h3 className="bsb-blog-title">
          <a href={href}>{post.title}</a>
        </h3>
        {options.showExcerpt && post.excerpt ? (
          <p className="bsb-blog-excerpt" style={{ "--lines": options.excerptLines ?? "3" } as CSSProperties}>
            {post.excerpt}
          </p>
        ) : null}
        {meta.length > 0 ? <p className="bsb-blog-meta">{meta.join(" · ")}</p> : null}
      </div>
    </article>
  );
}

const SAMPLE_BLOG_POSTS: BlockBlogPost[] = [
  { slug: "sample-1", title: "A sample post about something useful", excerpt: "A short summary of the post appears here, cut after a few lines.", publishedAt: "2026-01-15T00:00:00Z", authorName: "Your team", readingMinutes: 4, categoryName: "Guides" },
  { slug: "sample-2", title: "Another post your visitors will enjoy", excerpt: "A short summary of the post appears here, cut after a few lines.", publishedAt: "2026-01-08T00:00:00Z", authorName: "Your team", readingMinutes: 3, categoryName: "News" },
  { slug: "sample-3", title: "How to get the most from your order", excerpt: "A short summary of the post appears here, cut after a few lines.", publishedAt: "2026-01-02T00:00:00Z", authorName: "Your team", readingMinutes: 5, categoryName: "Guides" },
];

function SectionHead({ title, subtitle, action }: { title?: string | undefined; subtitle?: string | undefined; action?: ReactNode }) {
  if (!title && !subtitle && !action) return null;
  return (
    <div className="bsb-section-head bsb-align-left">
      <div>
        {title ? <h2 className="bsb-heading bsb-h-lg">{title}</h2> : null}
        {subtitle ? <p className="bsb-muted" style={{ margin: "0.4rem 0 0" }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Placeholder({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <section className="bsb bs-block-placeholder bsb-py-lg">
      <div className="bsb-w bsb-w-wide">
        {children}
        <p className="bsb-muted bsb-align-center" style={{ fontSize: "0.75rem", marginTop: "1rem" }}>
          <strong>{label}</strong> · {hint}
        </p>
      </div>
    </section>
  );
}

export function BlogPostsView({ props, ctx }: A<R.BlogPostsProps>): ReactNode {
  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  // No data at all means a host with no store (the theme editor): show labelled samples. Real data may be empty.
  const posts = d && d.kind === "blog-posts" ? d.posts : d ? [] : SAMPLE_BLOG_POSTS.slice(0, props.count);
  const viewAll = d && d.kind === "blog-posts" ? d.viewAllHref : "/blog";
  if (posts.length === 0 && props.hideWhenEmpty) return null;
  const card: BlogCardOptions = {
    showImage: props.showImage,
    showExcerpt: props.showExcerpt,
    showDate: props.showDate,
    showAuthor: props.showAuthor,
    showCategory: props.showCategory,
    imageRatio: props.imageRatio,
    excerptLines: props.excerptLines,
    layout: props.layout === "list" ? "list" : "grid",
  };
  const vars = { "--cols": Number(props.columns), "--cols-t": Number(props.columnsTablet), "--cols-m": Number(props.columnsMobile) } as CSSProperties;
  return (
    <section className={cx("bsb bs-block-blog-posts bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide">
        <SectionHead
          title={props.title}
          subtitle={props.subtitle}
          action={
            props.showViewAll && props.viewAllLabel ? (
              <a className="bsb-link" href={viewAll}>
                {props.viewAllLabel} →
              </a>
            ) : undefined
          }
        />
        {posts.length === 0 ? (
          <p className="bsb-muted">No posts to show yet.</p>
        ) : props.layout === "slider" ? (
          <div className="bsb-carousel bsb-blog-slider" style={vars} tabIndex={0} role="region" aria-label={props.title || "Recent posts"}>
            {posts.map((p) => (
              <div key={p.slug}>
                <BlogCard post={p} options={card} />
              </div>
            ))}
          </div>
        ) : props.layout === "list" ? (
          <div className="bsb-blog-list">
            {posts.map((p) => (
              <BlogCard key={p.slug} post={p} options={card} />
            ))}
          </div>
        ) : (
          <div className="bsb-grid bsb-blog-grid" style={vars}>
            {posts.map((p) => (
              <BlogCard key={p.slug} post={p} options={card} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function BlogListingView({ props, ctx }: A<R.BlogListingProps>): ReactNode {
  if (ctx?.renderBlogListing) return <>{ctx.renderBlogListing(props as BlogListingOptions)}</>;
  const card: BlogCardOptions = { ...props, showCategory: props.showCategoryLabel, excerptLines: "3" };
  return (
    <Placeholder label="Blog archive" hint="The store's posts are listed here, with category links and page numbers.">
      <h1 className="bsb-heading bsb-h-lg">{props.title}</h1>
      {props.subtitle ? <p className="bsb-muted">{props.subtitle}</p> : null}
      {props.showCategories ? <p className="bsb-muted" style={{ fontSize: "0.8125rem" }}>All · Guides · News</p> : null}
      <div
        className={props.layout === "list" ? "bsb-blog-list" : "bsb-grid bsb-blog-grid"}
        style={{ "--cols": Number(props.columns), "--cols-t": Number(props.columnsTablet), "--cols-m": Number(props.columnsMobile) } as CSSProperties}
      >
        {SAMPLE_BLOG_POSTS.map((p) => (
          <BlogCard key={p.slug} post={p} options={card} />
        ))}
      </div>
    </Placeholder>
  );
}

export function BlogPostContentView({ props, ctx }: A<R.BlogPostContentProps>): ReactNode {
  if (ctx?.renderBlogPost) return <>{ctx.renderBlogPost(props as BlogPostOptions)}</>;
  return (
    <Placeholder label="Blog post" hint="The post's title, picture, text, related posts and share links are drawn here.">
      <h1 className="bsb-heading bsb-h-lg">Post title</h1>
      <p className="bsb-muted" style={{ fontSize: "0.8125rem" }}>15 Jan 2026 · Your team · 4 min read</p>
      <div className="bsb-ph-box" style={{ aspectRatio: "16 / 9", margin: "1rem 0" }} aria-hidden="true" />
      <p>The body of the post appears here.</p>
    </Placeholder>
  );
}
