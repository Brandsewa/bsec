import Link from "next/link";
import { BlogCard, NewsletterForm, formatBlogDate, type BlogListingOptions } from "@bs/blocks";
import { toBlockBlogPost, type BlogMagazineData, type BlogPostSummary } from "@bs/domain";


/**
 * The magazine-style blog index: a big headline with a subscribe form, the latest posts (one large, a few small), then a row of
 * the newest posts for each category with a "View all" link. Server component; the subscribe form posts to the store's newsletter.
 */

function Thumb({ post, className }: { post: BlogPostSummary; className?: string }) {
  return post.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={post.image.url} alt={post.image.alt} loading="lazy" {...(post.image.width && post.image.height ? { width: post.image.width, height: post.image.height } : {})} />
  ) : (
    <span className={`${className ?? ""} bsb-mag-noimg`} aria-hidden="true" />
  );
}

export function BlogMagazine({ options, data, title }: { options: BlogListingOptions; data: BlogMagazineData; title: string }) {
  const [lead, ...others] = data.latest;
  const side = others.slice(0, options.latestSideCount ?? 5);
  const bold = options.headlineBold?.trim() || title;
  const rowCard = {
    showImage: options.showImage,
    showExcerpt: options.showExcerpt,
    showDate: options.showDate,
    showAuthor: options.showAuthor,
    showReadingTime: false,
    showCategory: options.showCategoryLabel,
    imageRatio: options.imageRatio,
    excerptLines: "2" as const,
    headingLevel: "h3" as const,
  };
  const cols = Math.min(4, Math.max(1, options.postsPerCategory ?? 4));

  return (
    <section className="bsb bs-block-blog-listing bsb-blog-mag bsb-blog-tight">
      <div className="bsb-w bsb-w-wide">
        <header className="bsb-mag-head bsb-head-row">
          <div>
            <h1 className="bsb-heading bsb-mag-title">
              <strong>{bold}</strong>
            </h1>
            {options.subtitle ? <p className="bsb-muted bsb-mag-intro">{options.subtitle}</p> : null}
          </div>
          {options.showSubscribe !== false ? (
            <div className="bsb-mag-subbox">
              <NewsletterForm className="bsb-mag-sub" source="blog" placeholder={options.subscribePlaceholder} buttonLabel={options.subscribeLabel} />
              {options.subscribeText ? <p className="bsb-muted bsb-mag-subbox-text">{options.subscribeText}</p> : null}
            </div>
          ) : null}
        </header>

        {lead ? (
          <div className="bsb-mag-latest">
            <article className="bsb-mag-lead">
              <Link href={`/blog/${lead.slug}`} className="bsb-mag-lead-link">
                <Thumb post={lead} className="bsb-mag-lead-img" />
                <span className="bsb-mag-shade" aria-hidden="true" />
                <span className="bsb-mag-lead-text">
                  {lead.category ? <span className="bsb-mag-chip">{lead.category.name}</span> : null}
                  <h2 className="bsb-mag-lead-title">{lead.title}</h2>
                  <span className="bsb-mag-meta">
                    {lead.authorName ? `${lead.authorName} · ` : ""}
                    {formatBlogDate(lead.publishedAt)}
                  </span>
                </span>
              </Link>
            </article>
            {side.length > 0 ? (
              <ul className="bsb-mag-side" aria-label="More recent posts">
                {side.map((p) => (
                  <li key={p.id}>
                    <Link href={`/blog/${p.slug}`} className="bsb-mag-side-item">
                      <Thumb post={p} className="bsb-mag-side-img" />
                      <span>{p.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="bsb-muted bsb-align-center" data-testid="blog-empty" style={{ padding: "3rem 0" }}>
            {options.emptyText}
          </p>
        )}

        {options.showCategorySections !== false
          ? data.sections.map((s) => (
              <section key={s.category.id} className="bsb-mag-section" aria-label={s.category.name}>
                <div className="bsb-mag-section-head">
                  <h2>{s.category.name}</h2>
                  <Link href={`/blog/category/${s.category.path}`}>View all <span aria-hidden="true">↗</span></Link>
                </div>
                <div className="bsb-grid bsb-blog-grid" style={{ "--cols": cols, "--cols-t": Math.min(cols, 2), "--cols-m": 1 } as React.CSSProperties}>
                  {s.posts.map((p) => (
                    <BlogCard key={p.id} post={toBlockBlogPost(p)} options={{ ...rowCard, layout: "grid" }} />
                  ))}
                </div>
              </section>
            ))
          : null}
      </div>
    </section>
  );
}
