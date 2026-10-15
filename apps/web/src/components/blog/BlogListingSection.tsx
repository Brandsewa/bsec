import Link from "next/link";
import { BlogCard, type BlogListingOptions } from "@bs/blocks";
import { toBlockBlogPost, type PublicBlogCategory, type PublicBlogList } from "@bs/domain";

/** Blog archive body (ADR-033): heading, category links, post cards and numbered page links. Server component. */

function categoryHref(path: string) {
  return `/blog/category/${path}`;
}

function pageHref(basePath: string, n: number) {
  return n <= 1 ? basePath : `${basePath}/page/${n}`;
}

/** The page numbers to show: first, last and a window around the current page, with gaps marked. */
export function pageWindow(current: number, total: number): Array<number | "gap"> {
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev !== undefined && n - prev > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function BlogListingSection({
  list,
  categories,
  options,
}: {
  list: PublicBlogList;
  categories: PublicBlogCategory[];
  options: BlogListingOptions;
}) {
  const cat = list.category;
  const basePath = cat ? categoryHref(cat.path) : "/blog";
  const heading = cat ? cat.name : options.title;
  const intro = cat ? cat.description : options.subtitle;

  // Links under the heading: top-level categories, plus the subcategories of the one being viewed.
  const current = cat?.parent ?? cat ?? null;
  const topLevel = categories;
  const subLinks = current ? (categories.find((c) => c.id === current.id)?.children ?? []) : [];

  const card = {
    showImage: options.showImage,
    showExcerpt: options.showExcerpt,
    showDate: options.showDate,
    showAuthor: options.showAuthor,
    showReadingTime: options.showReadingTime,
    showCategory: options.showCategoryLabel,
    imageRatio: options.imageRatio,
    excerptLines: "3" as const,
    headingLevel: "h2" as const,
  };
  const posts = list.posts.map(toBlockBlogPost);
  const first = options.featuredFirst && list.page === 1 && posts.length > 2 ? posts[0] : undefined;
  const rest = first ? posts.slice(1) : posts;
  const vars = { "--cols": Number(options.columns), "--cols-t": Number(options.columnsTablet), "--cols-m": Number(options.columnsMobile) } as React.CSSProperties;

  return (
    <section className="bsb bs-block-blog-listing bsb-py-lg">
      <div className="bsb-w bsb-w-wide">
        {cat ? (
          <nav aria-label="Breadcrumb" className="bsb-blog-crumbs">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/blog">{list.settings.title}</Link></li>
              {cat.parent ? <li><Link href={categoryHref(cat.parent.path)}>{cat.parent.name}</Link></li> : null}
              <li aria-current="page">{cat.name}</li>
            </ol>
          </nav>
        ) : null}
        <header className="bsb-blog-head">
          <h1 className="bsb-heading bsb-h-xl">{heading}</h1>
          {intro ? <p className="bsb-muted bsb-blog-intro">{intro}</p> : null}
        </header>

        {options.showCategories && topLevel.length > 0 ? (
          <nav aria-label="Blog categories" className="bsb-blog-cats">
            <Link href="/blog" className="bsb-blog-chip" aria-current={!cat ? "page" : undefined}>All</Link>
            {topLevel.map((c) => (
              <Link key={c.id} href={categoryHref(c.path)} className="bsb-blog-chip" aria-current={current?.id === c.id && !cat?.parent ? "page" : undefined}>
                {c.name}
              </Link>
            ))}
            {subLinks.length > 0 ? <span className="bsb-blog-chip-sep" aria-hidden="true">›</span> : null}
            {subLinks.map((c) => (
              <Link key={c.id} href={categoryHref(c.path)} className="bsb-blog-chip" aria-current={cat?.id === c.id ? "page" : undefined}>
                {c.name}
              </Link>
            ))}
          </nav>
        ) : null}

        {posts.length === 0 ? (
          <p className="bsb-muted bsb-align-center" data-testid="blog-empty" style={{ padding: "3rem 0" }}>
            {options.emptyText}
          </p>
        ) : (
          <>
            {first ? (
              <div className="bsb-blog-feature">
                <BlogCard post={first} options={{ ...card, layout: "list", priority: true }} />
              </div>
            ) : null}
            <div className={options.layout === "list" ? "bsb-blog-list" : "bsb-grid bsb-blog-grid"} style={vars}>
              {rest.map((p, i) => (
                <BlogCard key={p.slug} post={p} options={{ ...card, layout: options.layout, priority: !first && i === 0 && list.page === 1 }} />
              ))}
            </div>
          </>
        )}

        {list.pages > 1 ? (
          <nav aria-label="Pagination" className="bsb-blog-pages">
            {list.page > 1 ? (
              <Link href={pageHref(basePath, list.page - 1)} rel="prev" className="bsb-blog-page">Previous</Link>
            ) : null}
            {pageWindow(list.page, list.pages).map((n, i) =>
              n === "gap" ? (
                <span key={`gap-${i}`} aria-hidden="true">…</span>
              ) : (
                <Link key={n} href={pageHref(basePath, n)} className="bsb-blog-page" aria-current={n === list.page ? "page" : undefined} aria-label={`Page ${n}`}>
                  {n}
                </Link>
              ),
            )}
            {list.page < list.pages ? (
              <Link href={pageHref(basePath, list.page + 1)} rel="next" className="bsb-blog-page">Next</Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </section>
  );
}
