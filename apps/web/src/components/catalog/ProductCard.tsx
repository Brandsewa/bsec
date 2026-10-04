import React from "react";
import Link from "next/link";
import type { StorefrontProductSummary } from "@bs/domain";

export interface ProductCardProps {
  product: StorefrontProductSummary;
  /** Look chosen by the theme's collection template; the defaults are the built-in card. */
  imageRatio?: "square" | "portrait" | undefined;
  cardStyle?: "bordered" | "minimal" | undefined;
  showSaleBadge?: boolean | undefined;
  showRatings?: boolean | undefined;
}

/**
 * Formats paise minor units to INR currency string.
 */
export function formatInrPrice(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

export function ProductCard({ product, imageRatio = "square", cardStyle = "bordered", showSaleBadge = true, showRatings = true }: ProductCardProps) {
  const isRange = product.priceMin !== product.priceMax;
  const formattedPrice = isRange
    ? `${formatInrPrice(product.priceMin)} - ${formatInrPrice(product.priceMax)}`
    : formatInrPrice(product.priceMin);

  // Compare-at price savings
  let savingsPercent: number | null = null;
  let formattedCompareAt: string | null = null;
  if (product.compareAtPriceMin && product.compareAtPriceMin > product.priceMin) {
    savingsPercent = Math.round(
      ((product.compareAtPriceMin - product.priceMin) / product.compareAtPriceMin) * 100,
    );
    formattedCompareAt = formatInrPrice(product.compareAtPriceMin);
  }

  const imageUrl = product.primaryImage?.url;
  const imageAlt = product.primaryImage?.alt ?? product.title;

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl transition-all duration-200 ${
        cardStyle === "minimal" ? "bg-transparent" : "border border-border/70 bg-card hover:shadow-md hover:border-border"
      }`}
    >
      {/* Product Image */}
      <Link
        href={`/products/${product.slug}`}
        className={`relative w-full overflow-hidden bg-surface ${imageRatio === "portrait" ? "aspect-[4/5]" : "aspect-square"} ${cardStyle === "minimal" ? "rounded-xl" : ""}`}
        aria-label={product.title}
      >
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={imageAlt}
            loading="lazy"
            className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text/40 bg-muted/40">
            <div className="text-center p-4">
              <svg
                className="mx-auto h-10 w-10 text-muted-foreground/50 mb-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span className="text-xs font-medium text-muted-foreground">No image available</span>
            </div>
          </div>
        )}

        {/* Savings Badge */}
        {showSaleBadge && savingsPercent !== null && savingsPercent > 0 && (
          <span className="absolute top-2.5 right-2.5 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white shadow-xs">
            Save {savingsPercent}%
          </span>
        )}

        {/* Featured Tag */}
        {product.isFeatured && (
          <span className="absolute top-2.5 left-2.5 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-xs">
            Featured
          </span>
        )}
      </Link>

      {/* Product Info */}
      <div className={`flex flex-1 flex-col ${cardStyle === "minimal" ? "px-0.5 pt-3 pb-1" : "p-4"}`}>
        {product.brand && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {product.brand.name}
          </p>
        )}

        <h3 className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          <Link href={`/products/${product.slug}`}>{product.title}</Link>
        </h3>

        {/* Rating if present */}
        {showRatings && Number(product.ratingCount) > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex items-center text-amber-500">
              ★ <span className="ml-0.5 font-medium text-foreground">{product.ratingAvg}</span>
            </span>
            <span>({product.ratingCount})</span>
          </div>
        )}

        {/* Price & Savings */}
        <div className="mt-auto pt-3 flex items-baseline gap-2">
          <span className="text-base font-bold text-foreground">{formattedPrice}</span>
          {formattedCompareAt && (
            <span className="text-xs text-muted-foreground line-through">
              {formattedCompareAt}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
