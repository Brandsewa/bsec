import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  evaluateStorefrontAccess,
  getStorefrontPage,
  generateBreadcrumbJsonLd,
} from "@bs/domain";
import { renderBlockDocument } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";

interface CustomPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CustomPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      const tenantCtx = {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: ["store_admin"],
        permissions: ["settings.write", "content.write", "theme.publish"],
        requestId: crypto.randomUUID(),
      };

      const page = await getStorefrontPage(rt, tenantCtx, slug);
      if (page) {
        return {
          title: page.title,
          description: `Read more about ${page.title}.`,
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
  const { slug } = await params;

  let pageData: Awaited<ReturnType<typeof getStorefrontPage>> = null;
  let host = "localhost";

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      const tenantCtx = {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: ["store_admin"],
        permissions: ["settings.write", "content.write", "theme.publish"],
        requestId: crypto.randomUUID(),
      };

      pageData = await getStorefrontPage(rt, tenantCtx, slug);
    }
  } catch {
    notFound();
  }

  if (!pageData) {
    notFound();
  }

  const renderResult = renderBlockDocument(pageData.document);
  if (!renderResult.success) {
    notFound();
  }

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: `https://${host}` },
    { name: pageData.title, url: `https://${host}/pages/${slug}` },
  ]);

  return (
    <article className="w-full min-h-[60vh]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      <header className="mx-auto max-w-4xl px-4 pt-10 pb-4">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">
          {pageData.title}
        </h1>
      </header>
      <BlockRenderer blocks={renderResult.blocks} />
    </article>
  );
}
