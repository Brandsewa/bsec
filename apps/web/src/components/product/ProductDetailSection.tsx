import React from "react";
import Link from "next/link";
import type { StorefrontProductDetail } from "@bs/domain";
import { SvgIcon, type ProductDetailOptions } from "@bs/blocks";
import { descriptionText } from "@/lib/description-text.ts";
import { RatingSummary } from "./RatingSummary.tsx";
import { ProductGallery } from "./ProductGallery.tsx";
import { ProductBuyProvider, SkuLine, VariantOptions, PriceBlock, PurchaseActions } from "./VariantSelector.tsx";
import { ProductDescription } from "./ProductDescription.tsx";
import { DeliveryEstimate } from "./DeliveryEstimate.tsx";
import { MobileBuyBar } from "./MobileBuyBar.tsx";

// Server-side copy of the price format (VariantSelector's is a client module and cannot be called from here).
const formatInr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 === 0 ? 0 : 2 }).format(paise / 100);

export const DEFAULT_PRODUCT_DETAIL_OPTIONS: ProductDetailOptions = {
  galleryPosition: "left",
  showBreadcrumb: true,
  showRating: true,
  showDescription: true,
  showTags: true,
  stickyBuyBox: false,
  showTrustPoints: false,
  stickyMobileBar: false,
  showSku: true,
  thumbPosition: "left",
  showReadMore: true,
  variantStyle: "pills",
  priceNote: "Tax and shipping calculated at checkout.",
  showBuyNow: true,
  addToCartLabel: "Add to cart",
  buyNowLabel: "Buy it now",
  showPaymentImage: true,
  paymentImageAlt: "Secure payment",
  showDeliveryEstimate: true,
  cutoffHour: 14,
  deliveryDays: 3,
  shipsText: "Ships within 24 hrs",
  timeZone: "Asia/Kolkata",
  showUsps: true,
  usps: [
    { icon: "truck", text: "Fast dispatch", description: "Packed and shipped within 24 hours" },
    { icon: "shield", text: "Secure payment", description: "Encrypted checkout, details stay private" },
    { icon: "returns", text: "Easy returns", description: "Simple returns if something is not right" },
  ],
};

/**
 * The product page body: breadcrumb, gallery on one side and on the other the review summary, title, SKU, description, options,
 * price, buttons, payment picture, delivery estimate and highlight cards. A theme's product page places it through the
 * ProductDetail block (and sets the options); stores without a product template get it with the defaults.
 */
export function ProductDetailSection({
  product,
  options = DEFAULT_PRODUCT_DETAIL_OPTIONS,
  paymentImageUrl,
}: {
  product: StorefrontProductDetail;
  options?: ProductDetailOptions | undefined;
  /** Resolved URL of the theme's secure-payment picture (media library); the built-in badge is used when absent. */
  paymentImageUrl?: string | undefined;
}) {
  const prices = (product.variants ?? []).map((v) => v.price);
  const lowest = prices.length > 0 ? Math.min(...prices) : 0;
  const priceLabel = prices.length > 1 && Math.max(...prices) !== lowest ? `From ${formatInr(lowest)}` : formatInr(lowest);
  const longDescription = descriptionText(product.descriptionJson);
  const usps = options.showUsps ? (options.usps ?? []).slice(0, 4) : [];

  const gallery = (
    <div className={options.galleryPosition === "right" ? "lg:order-2" : undefined}>
      <ProductGallery media={product.media} title={product.title} thumbPosition={options.thumbPosition ?? "bottom"} />
    </div>
  );

  return (
    <div className={`mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 ${options.stickyMobileBar ? "pb-24 lg:pb-8" : ""}`}>
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

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16 items-start">
        {gallery}

        <ProductBuyProvider product={product}>
          <div className={`flex flex-col gap-5 ${options.stickyBuyBox ? "lg:sticky lg:top-24" : ""}`}>
            <div className="flex flex-col gap-2">
              {options.showRating ? <RatingSummary average={product.ratingAvg} count={Number(product.ratingCount)} /> : null}
              {product.brand ? <p className="text-xs font-semibold uppercase tracking-wider text-primary">{product.brand.name}</p> : null}
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground" style={{ fontFamily: "var(--bs-font-heading, inherit)" }}>
                {product.title}
              </h1>
              {options.showSku !== false ? <SkuLine /> : null}
            </div>

            {options.showDescription ? (
              <ProductDescription title={product.title} short={product.shortDescription?.trim() ?? ""} full={longDescription} clamp={options.showReadMore === true} />
            ) : null}

            <VariantOptions style={options.variantStyle ?? "buttons"} />

            <PriceBlock note={options.priceNote} />

            <PurchaseActions
              addToCartLabel={options.addToCartLabel}
              buyNowLabel={options.buyNowLabel}
              showBuyNow={options.showBuyNow}
              addToCartBg={options.addToCartBg}
              addToCartText={options.addToCartText}
              buyNowBg={options.buyNowBg}
              buyNowText={options.buyNowText}
              trustPoints={options.showTrustPoints ? options.trustPoints : undefined}
            />

            {options.showPaymentImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={paymentImageUrl ?? "/secure-payment.svg"} alt={options.paymentImageAlt || "Secure payment"} loading="lazy" className="h-auto w-full max-w-md self-start" />
            ) : null}

            {options.showDeliveryEstimate ? (
              <DeliveryEstimate
                cutoffHour={options.cutoffHour ?? 14}
                deliveryDays={options.deliveryDays ?? 3}
                shipsText={options.shipsText ?? ""}
                timeZone={options.timeZone ?? "Asia/Kolkata"}
              />
            ) : null}

            {usps.length > 0 ? (
              <ul
                className="bs-usp-grid -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
                style={{ "--usp-cols": usps.length } as React.CSSProperties}
                aria-label="Highlights"
                data-testid="product-usps"
              >
                {usps.map((u, i) => (
                  <li key={i} className="flex min-w-[15rem] shrink-0 snap-start items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 py-3 sm:min-w-0 sm:flex-col sm:items-start sm:gap-2.5">
                    <span className="shrink-0 text-foreground">
                      <SvgIcon name={u.icon} px={30} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug text-foreground">{u.text}</span>
                      {u.description ? <span className="block text-xs leading-snug text-muted-foreground">{u.description}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

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
        </ProductBuyProvider>
      </div>
      {options.stickyMobileBar ? <MobileBuyBar title={product.title} priceLabel={priceLabel} /> : null}
    </div>
  );
}
