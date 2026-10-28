import Link from "next/link";
import { BlogCard, NewsletterForm, formatBlogDate, type BlogPostOptions } from "@bs/blocks";
import { toBlockBlogPost, type BlogPostPage, type BlogPostSummary, type PublicBlogCategory } from "@bs/domain";


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

type Sidebar = { featured: BlogPostSummary[]; categories: PublicBlogCategory[] } | null;

export function BlogPostSection({ post, options, postUrl, blogTitle, blogDescription = "", sidebar = null }: { post: BlogPostPage; options: BlogPostOptions; postUrl: string; blogTitle: string; blogDescription?: string; sidebar?: Sidebar }) {
  if ((options.layout ?? "magazine") === "magazine") {
    return <MagazinePost post={post} options={options} postUrl={postUrl} blogTitle={blogTitle} blogDescription={blogDescription} sidebar={sidebar} />;
  }
  return <ClassicPost post={post} options={options} postUrl={postUrl} blogTitle={blogTitle} />;
}

/** The magazine layout: wide picture, then contents (left), the text and a sidebar (right). Contents sit in an accordion on phones and stay in view on desktop. */
function MagazinePost({ post, options, postUrl, blogTitle, blogDescription, sidebar }: { post: BlogPostPage; options: BlogPostOptions; postUrl: string; blogTitle: string; blogDescription: string; sidebar: Sidebar }) {
  const cat = post.category;
  const image = post.image;
  const toc = options.showToc ? post.headings.filter((h) => h.level <= 3) : [];
  const related = options.showRelated ? post.related.slice(0, options.relatedCount) : [];
  const showSidebar = options.showSidebar !== false;
  const featured = options.showFeatured !== false && sidebar ? sidebar.featured.filter((f) => f.id !== post.id).slice(0, options.featuredCount ?? 5) : [];
  const cats = options.showCategoriesCloud !== false && sidebar ? sidebar.categories : [];
  const about = showSidebar && options.showAboutCard !== false;
  const tocRight = options.tocPosition === "right";
  const meta = [
    options.showAuthor && post.authorName ? <strong key="a">{post.authorName}</strong> : null,
    options.showDate ? <time key="d" dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time> : null,
    options.showReadingTime ? <span key="r">{post.readingMinutes} min read</span> : null,
  ].filter(Boolean);

  const tocList = (
    <ol>
      {toc.map((h) => (
        <li key={h.id} className={h.level === 3 ? "bsb-bp-toc-sub" : undefined}>
          <a href={`#${h.id}`}>{h.text}</a>
        </li>
      ))}
    </ol>
  );

  return (
    <article className="bsb bs-block-blog-post bsb-bp">
      {image && options.featuredImage !== "hidden" ? (
        <div className="bsb-w bsb-w-wide">
          <figure className="bsb-bp-hero">
            <img src={image.url} alt={image.alt} loading="eager" fetchPriority="high" {...(image.width && image.height ? { width: image.width, height: image.height } : {})} />
          </figure>
        </div>
      ) : null}

      <div className="bsb-w bsb-w-wide">
        {toc.length > 0 ? (
          <details className="bsb-bp-toc-m">
            <summary>Table of contents</summary>
            <nav aria-label="Table of contents">{tocList}</nav>
          </details>
        ) : null}

        <div className={`bsb-bp-grid${tocRight ? " bsb-bp-toc-right" : ""}${toc.length === 0 ? " bsb-bp-no-toc" : ""}${showSidebar ? "" : " bsb-bp-no-side"}`}>
          {toc.length > 0 ? (
            <nav aria-label="Table of contents" className="bsb-bp-toc">
              <p>Table of contents</p>
              {tocList}
            </nav>
          ) : null}

          <div className="bsb-bp-main">
            <header className="bsb-bp-head">
              {options.showCategory && cat ? <Link href={`/blog/category/${cat.path}`} className="bsb-mag-chip">{cat.name}</Link> : null}
              <h1 className="bsb-heading bsb-bp-title">{post.title}</h1>
              {post.excerpt ? <p className="bsb-bp-excerpt">{post.excerpt}</p> : null}
              {meta.length > 0 ? (
                <p className="bsb-bp-meta">
                  {meta.map((m, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : ""}
                      {m}
                    </span>
                  ))}
                </p>
              ) : null}
            </header>

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

          {showSidebar ? (
            <aside className="bsb-bp-side" aria-label="Sidebar">
              {about ? (
                <div className="bsb-bp-about">
                  <p className="bsb-bp-about-title">{options.aboutTitle?.trim() || blogTitle}</p>
                  {(options.aboutText?.trim() || blogDescription) ? <p className="bsb-muted">{options.aboutText?.trim() || blogDescription}</p> : null}
                  <Link href="/blog" className="bsb-link">All posts →</Link>
                </div>
              ) : null}
              {featured.length > 0 ? (
                <section className="bsb-bp-featured" aria-label="Featured posts">
                  <h2>Featured posts</h2>
                  <ul>
                    {featured.map((f) => (
                      <li key={f.id}>
                        <Link href={`/blog/${f.slug}`}>
                          {f.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={f.image.url} alt="" loading="lazy" width={64} height={64} />
                          ) : (
                            <span className="bsb-mag-noimg" aria-hidden="true" />
                          )}
                          <span>
                            <strong>{f.title}</strong>
                            <small>{formatBlogDate(f.publishedAt)}</small>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {related.length > 0 ? (
                <section className="bsb-bp-featured" aria-label="Related posts">
                  <h2>Related posts</h2>
                  <ul>
                    {related.map((r) => (
                      <li key={r.slug}>
                        <Link href={`/blog/${r.slug}`}>
                          {r.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.image.url} alt="" loading="lazy" width={64} height={64} />
                          ) : (
                            <span className="bsb-mag-noimg" aria-hidden="true" />
                          )}
                          <span>
                            <strong>{r.title}</strong>
                            <small>{formatBlogDate(r.publishedAt)}</small>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {options.showSubscribe !== false ? (
                <section className="bsb-bp-subscribe" aria-label="Subscribe">
                  {options.subscribeTitle ? <h2>{options.subscribeTitle}</h2> : null}
                  {options.subscribeText ? <p className="bsb-muted">{options.subscribeText}</p> : null}
                  <NewsletterForm className="bsb-mag-sub" source="blog" placeholder={options.subscribePlaceholder} buttonLabel={options.subscribeLabel} />
                </section>
              ) : null}
              {cats.length > 0 ? (
                <section aria-label="Categories">
                  <h2>Categories</h2>
                  <ul className="bsb-bp-cats">
                    {cats.map((c) => (
                      <li key={c.id}>
                        <Link href={`/blog/category/${c.path}`}>{c.name}</Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>

      {/* With a sidebar the related posts sit there; the full-width row is for layouts without one. */}
      {!showSidebar && related.length > 0 ? (
        <div className="bsb-w bsb-w-wide bsb-blog-related">
          <h2 className="bsb-heading bsb-h-lg">Related posts</h2>
          <div className="bsb-grid bsb-blog-grid" style={{ "--cols": 3, "--cols-t": 2, "--cols-m": 1 } as React.CSSProperties}>
            {related.map((p) => (
              <BlogCard key={p.slug} post={toBlockBlogPost(p)} options={{ showImage: true, showExcerpt: true, showDate: true, showAuthor: false, showCategory: true, imageRatio: "landscape", excerptLines: "2" }} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ClassicPost({ post, options, postUrl, blogTitle }: { post: BlogPostPage; options: BlogPostOptions; postUrl: string; blogTitle: string }) {
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
