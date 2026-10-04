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
import { getCachedStorefrontProduct, getCachedThemePage } from "@/server/cached-storefront.ts";
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
  const detail = (options?: Parameters<typeof ProductDetailSection>[0]["options"]) => (
    <ProductDetailSection product={product} options={options} />
  );

  return (
    <div data-cache-tag={productCacheTag} className="bs-skin">
      {/* Schema.org Structured Data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }} />
      {template ? (
        <BlockRenderer
          blocks={template.blocks}
          renderData={template.renderData}
          context={{ renderProductDetail: (options) => detail(options) }}
        />
      ) : (
        detail()
      )}
    </div>
  );
}
