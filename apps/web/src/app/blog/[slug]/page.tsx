import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { generateArticleJsonLd, generateBreadcrumbJsonLd } from "@bs/domain";

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
> = {
  "mechanical-keyboards-guide-for-beginners": {
    title: "The Ultimate Guide to Mechanical Keyboards for Beginners",
    description: "Everything you need to know about linear, tactile, and clicky switches, hot-swap sockets, and keycap profiles.",
    author: "Alex Morgan",
    publishedAt: "2026-09-15",
    readTime: "5 min read",
    content: [
      "Typing on a high quality mechanical keyboard transforms your daily computer experience. Unlike common rubber dome keyboards found in typical office equipment, mechanical boards feature individual physical switches beneath every keycap.",
      "The three major switch categories are linear (smooth actuation with no bump), tactile (a discernible physical bump right around actuation point), and clicky (an audible click along with tactile feedback). For office work and shared environments, linear and tactile switches are by far the most popular.",
      "Hot-swappable PCB boards allow you to change out switches without any soldering equipment. When paired with high-grade PBT double-shot keycaps, typing becomes tactile, satisfying, and enduring.",
    ],
  },
  "lubing-switches-sound-and-feel": {
    title: "Why Lubing Your Switches Changes Everything",
    description: "Discover how proper lubrication eliminates spring ping, deepens acoustics, and delivers that buttery-smooth keystroke feel.",
    author: "Maya Sharma",
    publishedAt: "2026-09-20",
    readTime: "7 min read",
    content: [
      "Custom keyboard enthusiasts frequently cite lubing as the single most dramatic acoustic and tactile upgrade you can perform on a mechanical keyboard.",
      "By applying microscopic amounts of high-performance lubricants (such as Krytox 205g0 for housings and stems, and GPL 105 for springs), you remove friction points and eliminate metallic pinging resonance completely.",
      "The result is a deeper, lower-pitched acoustic signature and effortless glide that reduces finger fatigue during long coding or typing sessions.",
    ],
  },
  "workspace-ergonomics-desk-setup": {
    title: "Ergonomics & Desk Setup: Typing Comfort That Lasts All Day",
    description: "Simple adjustments to desk height, wrist rests, and keyboard angles that prevent strain and boost productivity.",
    author: "Kavita Rao",
    publishedAt: "2026-09-25",
    readTime: "4 min read",
    content: [
      "Desk posture is not simply about sitting straight; it is fundamentally about maintaining neutral joint alignment while you work.",
      "Position your keyboard so that your elbows stay bent at approximately 90 to 100 degrees, with wrists floating naturally or resting gently on a firm wooden or leather wrist rest during typing pauses.",
      "Pay attention to monitor height: the top third of your display should be at or just slightly below eye level. Incorporating regular micro-breaks and movement ensures enduring comfort throughout your workday.",
    ],
  },
};

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
