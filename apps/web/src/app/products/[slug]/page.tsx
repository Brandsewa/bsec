import { descriptionText } from "@/lib/description-text.ts";
import { getMarketContext } from "@/server/market.ts";
import { ProductInfoTabs } from "@/components/product/ProductInfoTabs.tsx";
import { ProductCustomField } from "@/components/product/ProductCustomField.tsx";
import { ProductReviewsSection } from "@/components/product/ProductReviewsSection.tsx";
import { DEFAULT_SHIPPING_CONTENT, ProductShowcaseSchema, type ProductCouponsOptions, type ProductInfoTabsOptions } from "@bs/blocks";
import { CouponCards } from "@/components/product/CouponCards.tsx";
import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontProduct,
  getStoreSettings,
  getStorefrontSeoSettings,
  generateProductJsonLd,
  generateBreadcrumbJsonLd,
  buildProductSeoMetadata,
  tenantTag,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedProductCustomFields, getCachedStorefrontCoupons, getCachedRelatedShowcaseData, getCachedStorefrontHomePage, getCachedStorefrontProduct, getCachedThemePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { ProductDetailSection } from "@/components/product/ProductDetailSection.tsx";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
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
        permissions: ["products.read", "settings.write"],
        requestId: crypto.randomUUID(),
      };

      const [product, seoSettings, storeSettings] = await Promise.all([
        getStorefrontProduct(rt, tenantCtx, slug),
        getStorefrontSeoSettings(rt, tenantCtx).catch(() => null),
        getStoreSettings(rt, tenantCtx).catch(() => null),
      ]);

      if (product) {
        const seoMeta = buildProductSeoMetadata({
          product,
          seoSettings,
          storeSettings,
          storeStatusMode: access.mode,
          noindex: access.noindex,
          host,
        });

        return {
          title: seoMeta.title,
          description: seoMeta.description,
          robots: seoMeta.robots,
          openGraph: seoMeta.openGraph,
          alternates: seoMeta.alternates,
        };
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return {
    title: "Product Not Found",
  };
}

/** The settings of the first Product showcase on a page (looked for through nested blocks), or null. */
function findShowcaseProps(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findShowcaseProps(item);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const o = node as { type?: unknown; props?: unknown };
    if (o.type === "ProductShowcase" && o.props && typeof o.props === "object") return { ...(o.props as Record<string, unknown>) };
    for (const value of Object.values(node)) {
      const hit = findShowcaseProps(value);
      if (hit) return hit;
    }
  }
  return null;
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { slug } = await params;

  let product: Awaited<ReturnType<typeof getStorefrontProduct>> = null;
  let host = "localhost";
  let tenantId = "";
  let marketId: string | null = null;

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      notFound();
    }

    tenantId = access.tenantId;
    marketId = (await getMarketContext(tenantId)).marketId;
    product = await getCachedStorefrontProduct(tenantId, slug, marketId);
  } catch {
    notFound();
  }

  if (!product) {
    notFound();
  }

  // Set tenant product cache tags for Next.js Cache Components (PLAN §11.6)
  try {
    cacheTag(tenantTag(tenantId, "product", product.id));
    cacheTag(tenantTag(tenantId, "product"));
  } catch {
    // Ignore outside Next.js request context
  }

  const productCacheTag = tenantTag(tenantId, "product", product.id);

  const storeUrl = `https://${host}`;
  const productJsonLd = generateProductJsonLd(product, storeUrl);
  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: storeUrl },
    { name: "Products", url: `${storeUrl}/products` },
    { name: product.title, url: `${storeUrl}/products/${product.slug}` },
  ]);

  // The theme's own product page layout, when the store has one; the built-in layout otherwise.
  const template = await getCachedThemePage(tenantId, "product", marketId).catch(() => null);
  const media = template?.renderData?.media ?? {};
  // "Related" product carousels are resolved for this product and laid over the theme page's data.
  // "You may also like" always looks like the home page's product carousel and lists products related to this one: the home
  // carousel's card, arrows and dots settings are copied onto it, and an older plain Product carousel on this page is
  // replaced by that related carousel. The product page keeps its own heading, subtitle and count. The theme's "Reviews"
  // block is only a heading placeholder (the real reviews are drawn below the product's own blocks), so it is left out.
  const homeDesign = template ? await getCachedStorefrontHomePage(tenantId, marketId).then((h) => findShowcaseProps(h.document.blocks)).catch(() => null) : null;
  const adaptedBlocks = (template?.blocks ?? [])
    .filter((b) => b.type !== "Reviews")
    .map((b) => {
      if (b.type === "ProductCarousel") {
        const title = typeof b.props["title"] === "string" && b.props["title"] ? (b.props["title"] as string) : "You may also like";
        const limit = typeof b.props["limit"] === "number" ? (b.props["limit"] as number) : 10;
        return {
          ...b,
          type: "ProductShowcase" as const,
          version: 1,
          props: ProductShowcaseSchema.parse({
            ...(homeDesign ?? {}),
            title,
            subtitle: typeof b.props["subtitle"] === "string" ? b.props["subtitle"] : "",
            tabs: [{ label: "Related", source: "related", collectionSlug: "" }],
            limit: Math.max(2, Math.min(24, limit)),
          }) as Record<string, unknown>,
        };
      }
      const tabs = Array.isArray(b.props["tabs"]) ? (b.props["tabs"] as Array<{ source?: string }>) : [];
      if (b.type !== "ProductShowcase" || !homeDesign || !tabs.some((t) => t.source === "related")) return b;
      const keep = { title: b.props["title"], subtitle: b.props["subtitle"], tabs: b.props["tabs"], limit: b.props["limit"] };
      return { ...b, props: ProductShowcaseSchema.parse({ ...homeDesign, ...keep }) as Record<string, unknown> };
    });
  const relatedData = template ? await getCachedRelatedShowcaseData(tenantId, product.id, adaptedBlocks, marketId).catch(() => ({})) : {};
  const renderData = template ? { ...template.renderData, data: { ...template.renderData.data, ...relatedData } } : undefined;
  const detail = (options?: Parameters<typeof ProductDetailSection>[0]["options"]) => (
    <ProductDetailSection product={product} options={options} customFields={customFields} coupons={coupons} paymentImageUrl={options?.paymentImageMediaId ? media[options.paymentImageMediaId] : undefined} />
  );
  // Custom fields (ADR-034): loaded once for the product and handed to the theme's "Custom field" blocks.
  const customFields = await getCachedProductCustomFields(tenantId, product.id).catch(() => []);
  const customField = (o: { fieldKey: string; showLabel: boolean; label: string }) => (
    <ProductCustomField field={customFields.find((f) => f.key === o.fieldKey)} showLabel={o.showLabel} label={o.label} />
  );
  // Coupon cards: the discounts the store chose to show (Discount > Show on the storefront).
  const coupons = await getCachedStorefrontCoupons(tenantId).catch(() => []);
  const couponCards = (o: ProductCouponsOptions) => (
    <CouponCards coupons={coupons} title={o.title} showCount={o.showCount} showViewAll={o.showViewAll} viewAllLabel={o.viewAllLabel} />
  );
  const infoTabs = (o: ProductInfoTabsOptions) => (
    <ProductInfoTabs
      descriptionLabel={o.descriptionLabel}
      shippingLabel={o.shippingLabel}
      descriptionText={descriptionText(product.descriptionJson) || (product.shortDescription ?? "")}
      shippingContent={o.shippingContent}
      imageUrl={o.imageMediaId ? media[o.imageMediaId] : undefined}
      imageAlt={o.imageAlt}
      imageSide={o.imageSide}
    />
  );

  const templateContext = { renderProductDetail: (options: Parameters<typeof detail>[0]) => detail(options), renderProductInfoTabs: infoTabs, renderProductCustomField: customField, renderProductCoupons: couponCards };
  // The theme's "Reviews" block is only a heading placeholder (the real reviews are drawn below the product's own blocks),
  // so it is left out here; the reviews section has its own heading.
  const templateBlocks = adaptedBlocks;
  const coreTypes = new Set(["ProductDetail", "ProductInfoTabs", "ProductCustomField", "ProductCoupons"]);
  let lastCore = -1;
  templateBlocks.forEach((b, i) => {
    if (coreTypes.has(b.type)) lastCore = i;
  });
  const beforeReviews = templateBlocks.slice(0, lastCore + 1);
  const afterReviews = templateBlocks.slice(lastCore + 1);

  return (
    <div data-cache-tag={productCacheTag} className="bs-skin">
      {/* Schema.org Structured Data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }} />
      {template ? (
        <>
          <BlockRenderer blocks={beforeReviews} renderData={renderData} context={templateContext} />
          {/* Reviews follow the product's own blocks; recommendations and anything else the theme adds come after them. */}
          <div className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
            <ProductReviewsSection productId={product.id} productTitle={product.title} />
          </div>
          <BlockRenderer blocks={afterReviews} renderData={renderData} context={templateContext} />
        </>
      ) : (
        <>
          {detail()}
          <ProductInfoTabs
            descriptionLabel="Description"
            shippingLabel="Shipping & returns"
            descriptionText={descriptionText(product.descriptionJson) || (product.shortDescription ?? "")}
            shippingContent={DEFAULT_SHIPPING_CONTENT}
            imageAlt=""
          />
        </>
      )}
      {template ? null : (
        <div className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
          <ProductReviewsSection productId={product.id} productTitle={product.title} />
        </div>
      )}
    </div>
  );
}
