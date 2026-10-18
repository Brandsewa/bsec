import { descriptionText } from "@/lib/description-text.ts";
import { ProductInfoTabs } from "@/components/product/ProductInfoTabs.tsx";
import { ProductCustomField } from "@/components/product/ProductCustomField.tsx";
import { ProductReviewsSection } from "@/components/product/ProductReviewsSection.tsx";
import { DEFAULT_SHIPPING_CONTENT, type ProductInfoTabsOptions } from "@bs/blocks";
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
import { getCachedProductCustomFields, getCachedRelatedShowcaseData, getCachedStorefrontProduct, getCachedThemePage } from "@/server/cached-storefront.ts";
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

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { slug } = await params;

  let product: Awaited<ReturnType<typeof getStorefrontProduct>> = null;
  let host = "localhost";
  let tenantId = "";

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      notFound();
    }

    tenantId = access.tenantId;
    product = await getCachedStorefrontProduct(tenantId, slug);
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
  const template = await getCachedThemePage(tenantId, "product").catch(() => null);
  const media = template?.renderData?.media ?? {};
  // "Related" product carousels are resolved for this product and laid over the theme page's data.
  const relatedData = template ? await getCachedRelatedShowcaseData(tenantId, product.id, template.blocks).catch(() => ({})) : {};
  const renderData = template ? { ...template.renderData, data: { ...template.renderData.data, ...relatedData } } : undefined;
  const detail = (options?: Parameters<typeof ProductDetailSection>[0]["options"]) => (
    <ProductDetailSection product={product} options={options} customFields={customFields} paymentImageUrl={options?.paymentImageMediaId ? media[options.paymentImageMediaId] : undefined} />
  );
  // Custom fields (ADR-034): loaded once for the product and handed to the theme's "Custom field" blocks.
  const customFields = await getCachedProductCustomFields(tenantId, product.id).catch(() => []);
  const customField = (o: { fieldKey: string; showLabel: boolean; label: string }) => (
    <ProductCustomField field={customFields.find((f) => f.key === o.fieldKey)} showLabel={o.showLabel} label={o.label} />
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

  return (
    <div data-cache-tag={productCacheTag} className="bs-skin">
      {/* Schema.org Structured Data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }} />
      {template ? (
        <BlockRenderer
          blocks={template.blocks}
          renderData={renderData}
          context={{ renderProductDetail: (options) => detail(options), renderProductInfoTabs: infoTabs, renderProductCustomField: customField }}
        />
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
      <div className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
        <ProductReviewsSection productId={product.id} productTitle={product.title} />
      </div>
    </div>
  );
}
