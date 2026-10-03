import React, { Suspense } from "react";
import Link from "next/link";
import type { StorefrontProductDetail } from "@bs/domain";
import type { ProductDetailOptions } from "@bs/blocks";
import { ProductGallery } from "./ProductGallery.tsx";
import { VariantSelector } from "./VariantSelector.tsx";
import { StockEtaSkeleton } from "./StockEtaHole.tsx";
import { ProductReviewsSection } from "./ProductReviewsSection.tsx";

export const DEFAULT_PRODUCT_DETAIL_OPTIONS: ProductDetailOptions = {
  galleryPosition: "left",
  showBreadcrumb: true,
  showRating: true,
  showDescription: true,
  showTags: true,
};

/**
 * The product page body: breadcrumb, gallery, title, rating, description, variant picker and tags.
 * A theme's product page places it through the ProductDetail block (and sets the options); stores
 * without a product template get it with the defaults.
 */
export function ProductDetailSection({
  product,
  options = DEFAULT_PRODUCT_DETAIL_OPTIONS,
}: {
  product: StorefrontProductDetail;
  options?: ProductDetailOptions | undefined;
}) {
  const gallery = (
    <div className={options.galleryPosition === "right" ? "lg:order-2" : undefined}>
      <ProductGallery media={product.media} title={product.title} />
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {options.showBreadcrumb ? (
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <span>/</span>
          <Link href="/products" className="hover:text-foreground transition-colors">
            Products
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none">{product.title}</span>
        </nav>
      ) : null}

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 items-start">
        {gallery}

        <div className="flex flex-col gap-6">
          <div>
            {product.brand && (
              <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1.5">{product.brand.name}</p>
            )}
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground" style={{ fontFamily: "var(--bs-font-heading, inherit)" }}>
              {product.title}
            </h1>
          </div>

          {options.showRating && Number(product.ratingCount) > 0 && (
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

          {options.showDescription && product.shortDescription && (
            <p className="text-base text-muted-foreground leading-relaxed">{product.shortDescription}</p>
          )}

          <Suspense fallback={<StockEtaSkeleton />}>
            <VariantSelector product={product} />
          </Suspense>

          {options.showTags && product.tags && product.tags.length > 0 && (
            <div className="pt-4 border-t border-border/60">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">Tags:</span>
              <div className="inline-flex flex-wrap gap-1.5 mt-1">
                {product.tags.map((tag) => (
                  <span key={tag} className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground font-medium">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Product Reviews & Rating Summary */}
      <ProductReviewsSection productId={product.id} productTitle={product.title} />
    </div>
  );
}
