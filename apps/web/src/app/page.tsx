import type { Metadata } from "next";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontHomePage,
  generateWebSiteJsonLd,
  generateOrganizationJsonLd,
  getStoreSettings,
  listPublicPlans,
  saasDb,
  tenantTag,
} from "@bs/domain";
import { renderBlockDocument, type BlockData } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontHomePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { MarketingLandingPage } from "@/components/marketing/MarketingLandingPage.tsx";
import type { LandingPlan } from "@/components/marketing/landing/content.ts";
import { MarketingLandingBahi } from "@/components/marketing/MarketingLandingBahi.tsx";
import { MarketingLandingRiso } from "@/components/marketing/MarketingLandingRiso.tsx";
import { DesignSwitcher } from "@/components/marketing/DesignSwitcher.tsx";
import { designSwitcherEnabled, resolveDesign } from "@/components/marketing/designs.ts";

export async function generateMetadata(): Promise<Metadata> {
  let title = "Home";
  const description = "Welcome to our store.";

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return {
        title: "bcom.si: online stores for Indian D2C brands",
        description: "Open an online store with cash on delivery, GST invoices and a no-code theme builder. 14-day free trial, plans from ₹999 a month plus GST.",
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

/** Live plans for the marketing page; an empty list makes the page fall back to the seeded plan values. */
async function loadLandingPlans(): Promise<LandingPlan[]> {
  try {
    const { rt } = server();
    const rows = await listPublicPlans(saasDb(rt));
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      monthlyPaise: p.priceMonthlyPaise,
      yearlyPaise: p.priceYearlyPaise,
      limits: p.limits,
    }));
  } catch {
    return [];
  }
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<{ design?: string | string[] }> }) {
  let blocksToRender = [] as ReturnType<typeof renderBlockDocument>["blocks"];
  let renderData: { data: Record<string, BlockData>; media: Record<string, string> } | undefined;
  let host = "localhost";
  let storeName = "Store";
  const logoUrl: string | null = null;
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

  if (isMarketing) {
    const plans = await loadLandingPlans();
    // Design testing: only when NEXT_PUBLIC_MARKETING_DESIGN_SWITCHER=1; production always renders the default design.
    const requested = (await searchParams)?.design;
    const fromQuery = Array.isArray(requested) ? requested[0] : requested;
    const design = resolveDesign(fromQuery);
    return (
      <>
        {design === "3" ? <MarketingLandingRiso plans={plans} /> : design === "2" ? <MarketingLandingBahi plans={plans} /> : <MarketingLandingPage plans={plans} />}
        {designSwitcherEnabled() ? <DesignSwitcher current={design} /> : null}
      </>
    );
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
      <BlockRenderer blocks={blocksToRender} renderData={renderData} />
    </main>
  );
}
