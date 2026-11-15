import type { Metadata } from "next";
import { getMarketContext } from "@/server/market.ts";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontHomePage,
  generateWebSiteJsonLd,
  generateOrganizationJsonLd,
  getStoreSettings,
  getStorefrontSeoSettings,
  buildHomeSeoMetadata,
  homeLanguageAlternates,
  tenantTag,
} from "@bs/domain";
import { renderBlockDocument, type BlockData } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedBrandAssets, getCachedStorefrontHomePage, getCachedThemePage } from "@/server/cached-storefront.ts";
import { withShareImage } from "@/lib/share-image.ts";
import { blocksHaveH1 } from "@/lib/has-h1.ts";
import { themeChromeIdentity } from "@/lib/theme-brand.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { GoogleOneTapPrompt } from "@/components/account/GoogleOneTapPrompt.tsx";
import { MarketingLandingPage } from "@/components/marketing/MarketingLandingPage.tsx";
import { loadLandingPlans } from "@/server/landing-plans.ts";
import { HomeRoot } from "@/components/marketing/home/HomeRoot.tsx";
import { siteHold } from "@/components/marketing/home/SiteHold.tsx";
import { marketingPageContent } from "@/components/marketing/home/MarketingBlocks.tsx";
import { PageFrame } from "@/components/marketing/landing/PageFrame.tsx";
import { marketingPage } from "@/server/marketing-page.ts";

export async function generateMetadata(): Promise<Metadata> {
  const title = "Home";
  const description = "Welcome to our store.";

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return {
        title: "BCOM: the agent-first e-commerce platform for Indian brands",
        description: "Open a complete online store today with cash on delivery, GST invoices and a no-code theme builder, built for the AI shopping era. 14-day free trial, plans from ₹999 a month plus GST.",
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
    const [homePage, seoSettings, storeSettings, marketCtx] = await Promise.all([
      getStorefrontHomePage(rt, tenantCtx),
      getStorefrontSeoSettings(rt, tenantCtx).catch(() => null),
      getStoreSettings(rt, tenantCtx).catch(() => null),
      getMarketContext(access.tenantId).catch(() => null),
    ]);
    // Title, description, canonical and share tags for the store's home page (never "Home" / "Welcome to our store.").
    const seoMeta = buildHomeSeoMetadata({
      homePage,
      seoSettings,
      storeSettings,
      storeStatusMode: access.mode,
      noindex: access.noindex,
      host,
      prefix: marketCtx?.prefix,
    });
    const assets = await getCachedBrandAssets(access.tenantId).catch(() => null);
    return withShareImage(
      {
        title: { absolute: seoMeta.title },
        description: seoMeta.description,
        robots: seoMeta.robots,
        openGraph: { ...seoMeta.openGraph, type: "website" },
        twitter: { card: assets?.shareImage ? "summary_large_image" : "summary", title: seoMeta.openGraph.title, description: seoMeta.openGraph.description },
        alternates: { ...seoMeta.alternates, ...(marketCtx?.markets && homeLanguageAlternates(marketCtx.markets, host) ? { languages: homeLanguageAlternates(marketCtx.markets, host) } : {}) },
      },
      assets?.shareImage,
    );
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
  let renderData: { data: Record<string, BlockData>; media: Record<string, string> } | undefined;
  let host = "localhost";
  let storeName = "Store";
  let marketCurrency = "INR";
  let marketLocale = "en-IN";
  let logoUrl: string | null = null;
  let orgFacts: { legalName: string | null; email: string | null; telephone: string | null; sameAs: string[] } = { legalName: null, email: null, telephone: null, sameAs: [] };
  let isMarketing = false;

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      isMarketing = true;
    } else {
      const tenantCtx = {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: ["store_admin"],
        permissions: ["settings.write", "content.write", "theme.publish"],
        requestId: crypto.randomUUID(),
      };

      const marketCtx = await getMarketContext(access.tenantId);
      marketCurrency = marketCtx.currency;
      marketLocale = marketCtx.locale;

      const [homeData, storeSettingsData, brandAssets, chromeHeader, chromeFooter] = await Promise.all([
        getCachedStorefrontHomePage(access.tenantId, marketCtx.scope).catch(() => null),
        getStoreSettings(rt, tenantCtx).catch(() => null),
        getCachedBrandAssets(access.tenantId).catch(() => null),
        getCachedThemePage(access.tenantId, "header").catch(() => null),
        getCachedThemePage(access.tenantId, "footer").catch(() => null),
      ]);
      // Logo: Brand settings first, else the one set in the theme's header or footer. Profile links come from the footer's social icons.
      const chrome = themeChromeIdentity(chromeHeader, chromeFooter);
      logoUrl = brandAssets?.logoUrl ?? chrome.logoUrl;
      orgFacts = {
        legalName: storeSettingsData?.legalName ?? null,
        email: storeSettingsData?.supportEmail ?? null,
        telephone: storeSettingsData?.supportPhone ?? null,
        sameAs: chrome.sameAs,
      };

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
          renderData = homeData.renderData;
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
          type: "HeroSlider" as const,
          version: 1,
          props: {
            slides: [
              {
                title: "Welcome to Our Store",
                subtitle: "Discover our handcrafted collection of high-quality products.",
                primaryLabel: "Shop All",
                primaryHref: "/collections",
              },
            ],
          },
        },
      ],
    };
    const res = renderBlockDocument(defaultDoc);
    if (res.success) {
      blocksToRender = res.blocks;
    }
  }

  if (isMarketing) {
    const hold = await siteHold();
    if (hold) {
      return (
        <HomeRoot>
          <main id="main">{hold}</main>
        </HomeRoot>
      );
    }
    const plans = await loadLandingPlans();
    // A Home page published in Super Admin replaces the built-in one; any problem reading it keeps the built-in page (ADR-011).
    const built = await marketingPage(["bcom-home"]);
    const content = built ? marketingPageContent(built.page.document, built.renderData, plans) : null;
    if (content) return <PageFrame>{content}</PageFrame>;
    return <MarketingLandingPage plans={plans} />;
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
    ...orgFacts,
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
      {blocksHaveH1(blocksToRender) ? null : <h1 className="sr-only">{storeName}</h1>}
      <BlockRenderer
        blocks={blocksToRender}
        renderData={renderData}
        context={{
          currency: marketCurrency,
          locale: marketLocale,
        }}
      />
      <GoogleOneTapPrompt />
    </main>
  );
}
