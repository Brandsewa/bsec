import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import Link from "next/link";
import { generateArticleJsonLd, generateBreadcrumbJsonLd, evaluateStorefrontAccess, tenantTag } from "@bs/domain";
import { server } from "@/server/runtime.ts";

interface BlogPostProps {
  params: Promise<{ slug: string }>;
}

export const ARTICLE_DETAILS: Record<
  string,
  {
    title: string;
    description: string;
    author: string;
    publishedAt: string;
    readTime: string;
    content: string[];
  }
> = {};

export async function generateMetadata({ params }: BlogPostProps): Promise<Metadata> {
  const { slug } = await params;
  const article = ARTICLE_DETAILS[slug];

  if (!article) {
    return { title: "Article Not Found" };
  }

  return {
    title: `${article.title} | Blog`,
    description: article.description,
  };
}

export default async function BlogPostPage({ params }: BlogPostProps) {
  const { slug } = await params;
  const article = ARTICLE_DETAILS[slug];

  if (!article) {
    notFound();
  }

  let host = "localhost";
  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (access.tenantId) {
      try {
        cacheTag(tenantTag(access.tenantId, "page", slug));
      } catch {
        // Ignore outside Next.js request context
      }
    }
  } catch {
    // Non-fatal
  }

  const postUrl = `https://${host}/blog/${slug}`;

  const articleJsonLd = generateArticleJsonLd({
    title: article.title,
    description: article.description,
    author: article.author,
    publishedAt: article.publishedAt,
    url: postUrl,
  });

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: `https://${host}` },
    { name: "Blog", url: `https://${host}/blog` },
    { name: article.title, url: postUrl },
  ]);

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      <nav className="mb-8">
        <Link
          href="/blog"
          className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          &larr; Back to all stories
        </Link>
      </nav>

      <header className="mb-10 pb-8 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted mb-4">
          <time dateTime={article.publishedAt}>{article.publishedAt}</time>
          <span>·</span>
          <span>{article.readTime}</span>
          <span>·</span>
          <span className="font-semibold text-foreground">{article.author}</span>
        </div>
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground leading-tight">
          {article.title}
        </h1>
        <p className="mt-4 text-lg text-muted leading-relaxed">
          {article.description}
        </p>
      </header>

      <div className="prose dark:prose-invert max-w-none space-y-6 text-foreground/90 leading-relaxed text-base md:text-lg">
        {article.content.map((p, idx) => (
          <p key={idx}>{p}</p>
        ))}
      </div>
    </article>
  );
}
