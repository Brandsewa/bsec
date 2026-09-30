import type { Metadata } from "next";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontHomePage,
  generateWebSiteJsonLd,
  generateOrganizationJsonLd,
  getStoreSettings,
  tenantTag,
} from "@bs/domain";
import { renderBlockDocument } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontHomePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { MarketingLandingPage } from "@/components/marketing/MarketingLandingPage.tsx";

export async function generateMetadata(): Promise<Metadata> {
  let title = "Home";
  let description = "Welcome to our store.";

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return {
        title: "gobs.cloud — Launch your online store in under 10 minutes",
        description: "Fastest D2C commerce platform in India: UPI & COD payments, Shiprocket shipping automation, and automated GST invoices.",
      };
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["settings.write", "content.write", "theme.publish"],
      requestId: crypto.randomUUID(),
    };
    const homePage = await getStorefrontHomePage(rt, tenantCtx);
    if (homePage.title) {
      title = homePage.title;
    }
  } catch {
    // Non-fatal fallback for static compilation / mock setups
  }

  return {
    title,
    description,
  };
}

export default async function HomePage() {
  let blocksToRender = [] as ReturnType<typeof renderBlockDocument>["blocks"];
  let host = "localhost";
  let storeName = "Store";
  const logoUrl: string | null = null;

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return <MarketingLandingPage />;
    }

    if (access.tenantId) {
      const tenantCtx = {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: ["store_admin"],
        permissions: ["settings.write", "content.write", "theme.publish"],
        requestId: crypto.randomUUID(),
      };

      const [homeData, storeSettingsData] = await Promise.all([
        getCachedStorefrontHomePage(access.tenantId).catch(() => null),
        getStoreSettings(rt, tenantCtx).catch(() => null),
      ]);

      // Set tenant home page cache tags for Next.js Cache Components (PLAN §11.6)
      try {
        cacheTag(tenantTag(access.tenantId, "page", "home"));
        cacheTag(tenantTag(access.tenantId, "store-shell"));
      } catch {
        // Ignore outside Next.js request context
      }

      if (homeData) {
        const renderResult = renderBlockDocument(homeData.document);
        if (renderResult.success) {
          blocksToRender = renderResult.blocks;
        }
      }

      if (storeSettingsData?.storeName) {
        storeName = storeSettingsData.storeName;
      }
    }
  } catch {
    // Fallback default blocks if DB unconfigured during build
    const defaultDoc = {
      version: 1,
      blocks: [
        {
          id: "fallback-hero",
          type: "Hero" as const,
          version: 1,
          props: {
            title: "Welcome to Our Store",
            subtitle: "Discover our handcrafted collection of high-quality products.",
            ctaText: "Shop All",
            ctaLink: "/collections",
          },
        },
      ],
    };
    const res = renderBlockDocument(defaultDoc);
    if (res.success) {
      blocksToRender = res.blocks;
    }
  }

  const storeUrl = `https://${host}`;
  const webSiteJsonLd = generateWebSiteJsonLd({
    name: storeName,
    url: storeUrl,
  });

  const orgJsonLd = generateOrganizationJsonLd({
    name: storeName,
    url: storeUrl,
    logoUrl,
  });

  return (
    <main className="w-full min-h-[60vh]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <BlockRenderer blocks={blocksToRender} />
    </main>
  );
}
