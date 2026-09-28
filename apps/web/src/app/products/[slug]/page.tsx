import React, { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import {
  evaluateStorefrontAccess,
  getStorefrontProduct,
  getStoreSettings,
  getStorefrontSeoSettings,
  generateProductJsonLd,
  generateBreadcrumbJsonLd,
  formatTitle,
  tenantTag,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { ProductGallery } from "@/components/product/ProductGallery.tsx";
import { VariantSelector } from "@/components/product/VariantSelector.tsx";
import { StockEtaSkeleton } from "@/components/product/StockEtaHole.tsx";

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
        const storeName = storeSettings?.storeName ?? "Store";
        const metaTitle = formatTitle(seoSettings?.titleTemplate, product.title, storeName);
        const description = product.shortDescription ?? `Buy ${product.title} at ${storeName}.`;
        const firstImage = product.media?.[0]?.url;

        return {
          title: metaTitle,
          description,
          openGraph: {
            title: metaTitle,
            description,
            images: firstImage ? [{ url: firstImage }] : undefined,
          },
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

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read", "settings.write"],
      requestId: crypto.randomUUID(),
    };

    product = await getStorefrontProduct(rt, tenantCtx, slug);
  } catch {
    notFound();
  }

  if (!product) {
    notFound();
  }

  // Set tenant product cache tag for Next.js Cache Components
  // Using tenantTag helper ensures consistency with the bs/tenant-cache-tag invariant
  const productCacheTag = tenantTag(tenantId, "product", product.id);

  const storeUrl = `https://${host}`;
  const productJsonLd = generateProductJsonLd(product, storeUrl);
  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: storeUrl },
    { name: "Products", url: `${storeUrl}/products` },
    { name: product.title, url: `${storeUrl}/products/${product.slug}` },
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" data-cache-tag={productCacheTag}>
      {/* Schema.org Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      {/* Breadcrumbs Navigation */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/products" className="hover:text-foreground transition-colors">
          Products
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none">
          {product.title}
        </span>
      </nav>

      {/* Main Product Layout */}
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 items-start">
        {/* Gallery Column */}
        <div>
          <ProductGallery media={product.media} title={product.title} />
        </div>

        {/* Product Details & Variant Picker Column */}
        <div className="flex flex-col gap-6">
          <div>
            {product.brand && (
              <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1.5">
                {product.brand.name}
              </p>
            )}
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {product.title}
            </h1>
          </div>

          {/* Rating summary */}
          {Number(product.ratingCount) > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center text-amber-500">
                <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="ml-1 font-semibold text-foreground">{product.ratingAvg}</span>
              </div>
              <span className="text-muted-foreground">({product.ratingCount} reviews)</span>
            </div>
          )}

          {/* Short description */}
          {product.shortDescription && (
            <p className="text-base text-muted-foreground leading-relaxed">
              {product.shortDescription}
            </p>
          )}

          {/* Interactive Variant Selection with Suspended Stock Eta Hole */}
          <Suspense fallback={<StockEtaSkeleton />}>
            <VariantSelector product={product} />
          </Suspense>

          {/* Additional details */}
          {product.tags && product.tags.length > 0 && (
            <div className="pt-4 border-t border-border/60">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">
                Tags:
              </span>
              <div className="inline-flex flex-wrap gap-1.5 mt-1">
                {product.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground font-medium"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
