import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { generateBreadcrumbJsonLd } from "@bs/domain";

export const metadata: Metadata = {
  title: "Blog | Latest Stories & Updates",
  description: "Read the latest news, guides, and stories from our store.",
};

export interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  author: string;
  readTime: string;
}

export const SAMPLE_ARTICLES: BlogPostSummary[] = [
  {
    slug: "mechanical-keyboards-guide-for-beginners",
    title: "The Ultimate Guide to Mechanical Keyboards for Beginners",
    excerpt: "Everything you need to know about linear, tactile, and clicky switches, hot-swap sockets, and keycap profiles.",
    publishedAt: "2026-09-15",
    author: "Alex Morgan",
    readTime: "5 min read",
  },
  {
    slug: "lubing-switches-sound-and-feel",
    title: "Why Lubing Your Switches Changes Everything",
    excerpt: "Discover how proper lubrication eliminates spring ping, deepens acoustics, and delivers that buttery-smooth keystroke feel.",
    publishedAt: "2026-09-20",
    author: "Maya Sharma",
    readTime: "7 min read",
  },
  {
    slug: "workspace-ergonomics-desk-setup",
    title: "Ergonomics & Desk Setup: Typing Comfort That Lasts All Day",
    excerpt: "Simple adjustments to desk height, wrist rests, and keyboard angles that prevent strain and boost productivity.",
    publishedAt: "2026-09-25",
    author: "Kavita Rao",
    readTime: "4 min read",
  },
];

export default async function BlogIndexPage() {
  let host = "localhost";
  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  } catch {
    // Non-fatal
  }

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: `https://${host}` },
    { name: "Blog", url: `https://${host}/blog` },
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      <header className="mb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
          Stories & Guides
        </h1>
        <p className="mt-3 text-lg text-muted max-w-2xl mx-auto">
          Insights on craftsmanship, desk setup inspiration, and technical guides.
        </p>
      </header>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {SAMPLE_ARTICLES.map((article) => (
          <article
            key={article.slug}
            className="flex flex-col rounded-xl border border-border bg-surface p-6 shadow-xs hover:border-foreground/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs text-muted mb-3">
              <time dateTime={article.publishedAt}>{article.publishedAt}</time>
              <span>·</span>
              <span>{article.readTime}</span>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3 leading-snug">
              <Link href={`/blog/${article.slug}`} className="hover:underline">
                {article.title}
              </Link>
            </h2>
            <p className="text-sm text-muted mb-6 flex-1 line-clamp-3">
              {article.excerpt}
            </p>
            <div className="flex items-center justify-between pt-4 border-t border-border/50 text-xs">
              <span className="font-medium text-foreground">{article.author}</span>
              <Link
                href={`/blog/${article.slug}`}
                className="text-primary font-medium hover:underline inline-flex items-center gap-1"
              >
                Read article &rarr;
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
