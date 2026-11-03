import type { Metadata } from "next";
import { getMarketContext } from "@/server/market.ts";
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontPageByPath,
  generateBreadcrumbJsonLd,
  tenantTag,
  parsePageSeo,
  resolveMediaUrlById,
} from "@bs/domain";
import { renderBlockDocument } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontPageByPath } from "@/server/cached-storefront.ts";
import { GoogleOneTapPrompt } from "@/components/account/GoogleOneTapPrompt.tsx";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { loadLandingPlans } from "@/server/landing-plans.ts";
import { marketingPageContent } from "@/components/marketing/home/MarketingBlocks.tsx";
import { PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { marketingPage, marketingPageMeta } from "@/server/marketing-page.ts";

interface CustomPageProps {
  params: Promise<{ path: string[] }>;
}

export async function generateMetadata({ params }: CustomPageProps): Promise<Metadata> {
  const { path } = await params;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    if (isPlatformMarketingHost(host)) {
      const built = await marketingPage(path);
      if (!built) return { title: "Page Not Found" };
      const { title, description } = marketingPageMeta(built.page);
      return { title, ...(description ? { description } : {}), alternates: { canonical: built.canonicalPath } };
    }
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId && Array.isArray(path) && path.length > 0) {
      const tenantCtx = {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: ["store_admin"],
        permissions: ["settings.write", "content.write", "theme.publish"],
        requestId: crypto.randomUUID(),
      };

      const result = await getStorefrontPageByPath(rt, tenantCtx, path);
      if (result) {
        const seo = parsePageSeo(result.page.seo);
        const title = seo?.title || result.page.title;
        const description = seo?.description || `Read more about ${result.page.title}.`;
        const canonicalUrl = `https://${host}${result.canonicalPath}`;

        let imageUrl: string | undefined;
        if (seo?.imageMediaId) {
          try {
            imageUrl = await resolveMediaUrlById(rt, access.tenantId, seo.imageMediaId);
          } catch {
            // Degrade gracefully if media cannot be resolved
          }
        }

        return {
          title,
          description,
          alternates: {
            canonical: canonicalUrl,
          },
          openGraph: {
            title,
            description,
            url: canonicalUrl,
            images: imageUrl ? [{ url: imageUrl, alt: title }] : undefined,
          },
          twitter: imageUrl
            ? {
                card: "summary_large_image",
                title,
                description,
                images: [imageUrl],
              }
            : undefined,
        };
      }
    }
  } catch {
    // Non-fatal
  }

  return {
    title: "Page Not Found",
  };
}

/** A page of the platform's own website, in its own frame. There is no built-in version to fall back to here, so a miss is a 404. */
async function MarketingCustomPage({ path }: { path: string[] }) {
  const built = await marketingPage(path);
  if (!built) notFound();
  if (!built.isCanonical) permanentRedirect(built.canonicalPath);
  const content = marketingPageContent(built.page.document, built.renderData, await loadLandingPlans());
  if (!content) notFound();
  return <PageFrame>{content}</PageFrame>;
}

export default async function CustomContentPage({ params }: CustomPageProps) {
  const { path } = await params;

  if (!Array.isArray(path) || path.length === 0) {
    notFound();
  }

  if (isPlatformMarketingHost((await headers()).get("x-forwarded-host") ?? (await headers()).get("host"))) {
    return <MarketingCustomPage path={path} />;
  }

  let pageData: Awaited<ReturnType<typeof getCachedStorefrontPageByPath>> = null;
  let host = "localhost";
  let marketCurrency = "INR";
  let marketLocale = "en-IN";

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      const marketCtx = await getMarketContext(access.tenantId);
      marketCurrency = marketCtx.currency;
      marketLocale = marketCtx.locale;
      pageData = await getCachedStorefrontPageByPath(access.tenantId, path, marketCtx.marketId);

      if (pageData) {
        // Enforce 308 permanent redirect if accessed via non-canonical ancestor path
        if (!pageData.isCanonical) {
          permanentRedirect(pageData.canonicalPath);
        }

        // Set tenant page cache tags for Next.js Cache Components (PLAN §11.6)
        try {
          cacheTag(tenantTag(access.tenantId, "page", pageData.page.slug));
          cacheTag(tenantTag(access.tenantId, "store-shell"));
        } catch {
          // Ignore outside Next.js request context
        }
      }
    }
  } catch (err: unknown) {
    // Re-throw Next.js redirect errors so permanentRedirect can execute
    if (typeof err === "object" && err !== null && "digest" in err) {
      throw err;
    }
    notFound();
  }

  if (!pageData) {
    notFound();
  }

  const renderResult = renderBlockDocument(pageData.page.document);
  if (!renderResult.success) {
    notFound();
  }

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd(
    pageData.breadcrumbs.map((b) => ({
      name: b.name,
      url: b.url.startsWith("http") ? b.url : `https://${host}${b.url}`,
    })),
  );

  return (
    <article className="w-full min-h-[60vh]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      {/* The page's own blocks carry the visible heading; keep the title for screen readers and search engines. */}
      <h1 className="sr-only">{pageData.page.title}</h1>
      <BlockRenderer blocks={renderResult.blocks} renderData={pageData.renderData} context={{ currency: marketCurrency, locale: marketLocale }} />
      <GoogleOneTapPrompt />
    </article>
  );
}
