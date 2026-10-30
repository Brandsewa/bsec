import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import React from "react";
import Link from "next/link";
import type { StorefrontProductSummary } from "@bs/domain";
import { formatMoney } from "@bs/contracts/money";
import { CardCartButton } from "./CardCartButton.tsx";

export interface ProductCardProps {
  product: StorefrontProductSummary;
  /** Look chosen by the theme's collection template; the defaults are the built-in card. */
  imageRatio?: "square" | "portrait" | undefined;
  cardStyle?: "borderless" | "bordered" | "minimal" | undefined;
  showSaleBadge?: boolean | undefined;
  showRatings?: boolean | undefined;
  showCategoryBadge?: boolean | undefined;
  showAddToCart?: boolean | undefined;
  showQuickAdd?: boolean | undefined;
  showViewProduct?: boolean | undefined;
  hoverSecondImage?: boolean | undefined;
  /** Above the fold: load the picture straight away instead of lazily. */
  priority?: boolean | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
}

/**
 * Formats minor units to currency string (defaults to INR).
 */
export function formatInrPrice(minor: number, currency = "INR", locale?: string): string {
  return formatMoney(minor, currency, { ...(locale ? { locale } : {}) });
}

/**
 * One product in a listing. The same markup serves grid and list: the listing container's `data-view` switches the layout in
 * CSS (`.bs-pcard` rules in globals.css), so toggling never re-renders the cards.
 */
export function ProductCard({
  product,
  imageRatio = "square",
  cardStyle = "borderless",
  showSaleBadge = true,
  showRatings = true,
  showCategoryBadge = false,
  showAddToCart = false,
  showQuickAdd = true,
  showViewProduct = true,
  hoverSecondImage = false,
  priority = false,
  currency = "INR",
  locale,
}: ProductCardProps) {
  const isRange = product.priceMin !== product.priceMax;
  const fmt = (minor: number) => formatMoney(minor, currency, { ...(locale ? { locale } : {}) });
  const formattedPrice = isRange ? `${fmt(product.priceMin)} - ${fmt(product.priceMax)}` : fmt(product.priceMin);

  let savingsPercent: number | null = null;
  let formattedCompareAt: string | null = null;
  if (product.compareAtPriceMin && product.compareAtPriceMin > product.priceMin) {
    savingsPercent = Math.round(((product.compareAtPriceMin - product.priceMin) / product.compareAtPriceMin) * 100);
    formattedCompareAt = fmt(product.compareAtPriceMin);
  }

  const imageUrl = product.primaryImage?.url;
  const imageAlt = product.primaryImage?.alt ?? product.title;
  const secondUrl = hoverSecondImage ? product.secondaryImage?.url : undefined;
  const hasRating = showRatings && product.ratingCount > 0;
  const stars = Math.max(0, Math.min(5, Math.round(Number(product.ratingAvg))));
  const outOfStock = product.quickAdd ? !product.quickAdd.inStock : false;

  return (
    <article className="bs-pcard group" data-style={cardStyle}>
      <div className="bs-pcard-media bg-muted" style={{ aspectRatio: imageRatio === "portrait" ? "4 / 5" : "1 / 1" }}>
        <Link href={`/products/${product.slug}`} className="block h-full w-full" aria-label={product.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl ?? PLACEHOLDER_IMAGE_URL} alt={imageUrl ? imageAlt : ""} loading={priority ? "eager" : "lazy"} className="bs-pcard-img" />
          {secondUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={secondUrl} alt="" loading="lazy" aria-hidden className="bs-pcard-img bs-pcard-img2" />
          ) : null}
        </Link>

        <div className="pointer-events-none absolute left-2.5 right-2.5 top-2.5 flex items-start justify-between gap-2">
          <span className="flex min-w-0 flex-col items-start gap-1">
            {!(showCategoryBadge && product.categoryName) && product.isFeatured ? <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-xs">Featured</span> : null}
          </span>
          {showSaleBadge && savingsPercent !== null && savingsPercent > 0 ? <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white shadow-xs">Save {savingsPercent}%</span> : null}
        </div>

        {outOfStock ? <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-md bg-background/95 px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-xs">Sold out</span> : null}

        {showAddToCart && product.quickAdd ? (
          <CardCartButton
            product={{ title: product.title, slug: product.slug, imageUrl, shortDescription: product.shortDescription, quickAdd: product.quickAdd }}
            showQuickAdd={showQuickAdd}
            showViewProduct={showViewProduct}
          />
        ) : null}
      </div>

      <div className="bs-pcard-body">
        {/* First row: reviews on the left, the category on the right (either alone keeps its side). Then the title, then the price. */}
        {hasRating || (showCategoryBadge && product.categoryName) ? (
          <div className="mb-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {hasRating ? (
              <div className="flex shrink-0 items-center gap-1.5" aria-label={`Rated ${product.ratingAvg} out of 5 from ${product.ratingCount} reviews`}>
                <span className="tracking-wide text-amber-500" aria-hidden="true">
                  {"★".repeat(stars)}
                  {"☆".repeat(5 - stars)}
                </span>
                <span className="font-medium text-foreground">{Number(product.ratingAvg).toFixed(1)}</span>
                <span>({product.ratingCount})</span>
              </div>
            ) : null}
            {showCategoryBadge && product.categoryName ? <p className="ml-auto min-w-0 truncate font-medium">{product.categoryName}</p> : null}
          </div>
        ) : null}
        {product.brand ? <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{product.brand.name}</p> : null}

        <h3 className="bs-pcard-title">
          <Link href={`/products/${product.slug}`}>{product.title}</Link>
        </h3>

        {product.shortDescription ? <p className="bs-pcard-desc text-muted-foreground">{product.shortDescription}</p> : null}

        <div className="bs-pcard-price">
          {product.priceOnRequest ? (
            <span className="text-sm font-semibold text-muted-foreground">Price on request</span>
          ) : (
            <>
              <span className="text-base font-bold text-foreground">{formattedPrice}</span>
              {formattedCompareAt ? <span className="text-xs text-muted-foreground line-through">{formattedCompareAt}</span> : null}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
