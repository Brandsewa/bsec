import Link from "next/link";
import { BlogCard, formatBlogDate, type BlogPostOptions } from "@bs/blocks";
import { toBlockBlogPost, type BlogPostPage } from "@bs/domain";

/** One blog post (ADR-033): header, picture, table of contents, the sanitised body, share links, related posts. Server component. */

function shareLinks(url: string, title: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { label: "WhatsApp", href: `https://wa.me/?text=${t}%20${u}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { label: "Email", href: `mailto:?subject=${t}&body=${u}` },
  ];
}

export function BlogPostSection({ post, options, postUrl, blogTitle }: { post: BlogPostPage; options: BlogPostOptions; postUrl: string; blogTitle: string }) {
  const metaParts = [
    options.showDate ? <time key="d" dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time> : null,
    options.showAuthor && post.authorName ? <span key="a">By {post.authorName}</span> : null,
    options.showReadingTime ? <span key="r">{post.readingMinutes} min read</span> : null,
  ].filter(Boolean);
  const cat = post.category;
  const image = post.image;
  const toc = options.showToc && post.headings.filter((h) => h.level === 2).length >= 3 ? post.headings.filter((h) => h.level <= 3) : [];
  const related = options.showRelated ? post.related.slice(0, options.relatedCount) : [];
  const figure =
    image && options.featuredImage !== "hidden" ? (
      <figure className={options.featuredImage === "wide" ? "bsb-blog-hero bsb-blog-hero-wide" : "bsb-blog-hero"}>
        <img
          src={image.url}
          alt={image.alt}
          loading="eager"
          fetchPriority="high"
          {...(image.width && image.height ? { width: image.width, height: image.height } : {})}
        />
      </figure>
    ) : null;

  return (
    <article className="bsb bs-block-blog-post bsb-py-lg">
      {options.featuredImage === "wide" ? figure : null}
      <div className={options.contentWidth === "narrow" ? "bsb-w bsb-blog-narrow" : "bsb-w bsb-w-wide"}>
        {options.showBreadcrumb ? (
          <nav aria-label="Breadcrumb" className="bsb-blog-crumbs">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/blog">{blogTitle}</Link></li>
              {cat ? <li><Link href={`/blog/category/${cat.path}`}>{cat.name}</Link></li> : null}
              <li aria-current="page">{post.title}</li>
            </ol>
          </nav>
        ) : null}
        <header className="bsb-blog-head">
          {options.showCategory && cat ? (
            <Link href={`/blog/category/${cat.path}`} className="bsb-blog-cat">{cat.name}</Link>
          ) : null}
          <h1 className="bsb-heading bsb-h-xl">{post.title}</h1>
          {metaParts.length > 0 ? (
            <p className="bsb-blog-meta">
              {metaParts.map((part, i) => (
                <span key={i}>
                  {i > 0 ? " · " : ""}
                  {part}
                </span>
              ))}
            </p>
          ) : null}
        </header>
        {options.featuredImage === "above" ? figure : null}

        {toc.length > 0 ? (
          <nav aria-label="Table of contents" className="bsb-blog-toc">
            <p className="bsb-blog-toc-title">In this article</p>
            <ol>
              {toc.map((h) => (
                <li key={h.id} className={h.level === 3 ? "bsb-blog-toc-sub" : undefined}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {/* Sanitised on the server on every save (ADR-033); only formatting tags, links and media-library images remain. */}
        <div className="bsb-prose" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />

        {options.showShare ? (
          <aside aria-label="Share this post" className="bsb-blog-share">
            <span>Share</span>
            {shareLinks(postUrl, post.title).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
            ))}
          </aside>
        ) : null}

        {options.showPrevNext && (post.previous || post.next) ? (
          <nav aria-label="More posts" className="bsb-blog-prevnext">
            {post.previous ? <Link href={`/blog/${post.previous.slug}`} rel="prev"><span>Older post</span>{post.previous.title}</Link> : <span />}
            {post.next ? <Link href={`/blog/${post.next.slug}`} rel="next"><span>Newer post</span>{post.next.title}</Link> : <span />}
          </nav>
        ) : null}
      </div>

      {related.length > 0 ? (
        <div className="bsb-w bsb-w-wide bsb-blog-related">
          <h2 className="bsb-heading bsb-h-lg">Related posts</h2>
          <div className="bsb-grid bsb-blog-grid" style={{ "--cols": 3, "--cols-t": 2, "--cols-m": 1 } as React.CSSProperties}>
            {related.map((p) => (
              <BlogCard
                key={p.slug}
                post={toBlockBlogPost(p)}
                options={{ showImage: true, showExcerpt: true, showDate: true, showAuthor: false, showCategory: true, imageRatio: "landscape", excerptLines: "2" }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
