import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontPageByPath,
  generateBreadcrumbJsonLd,
  tenantTag,
  parsePageSeo,
} from "@bs/domain";
import { renderBlockDocument } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontPageByPath } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";

interface CustomPageProps {
  params: Promise<{ path: string[] }>;
}

export async function generateMetadata({ params }: CustomPageProps): Promise<Metadata> {
  const { path } = await params;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
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

        return {
          title,
          description,
          alternates: {
            canonical: canonicalUrl,
          },
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

export default async function CustomContentPage({ params }: CustomPageProps) {
  const { path } = await params;

  if (!Array.isArray(path) || path.length === 0) {
    notFound();
  }

  let pageData: Awaited<ReturnType<typeof getCachedStorefrontPageByPath>> = null;
  let host = "localhost";

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      pageData = await getCachedStorefrontPageByPath(access.tenantId, path);

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
      <header className="mx-auto max-w-4xl px-4 pt-10 pb-4">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">
          {pageData.page.title}
        </h1>
      </header>
      <BlockRenderer blocks={renderResult.blocks} renderData={pageData.renderData} />
    </article>
  );
}
