import React from "react";
import Link from "next/link";
import type { StorefrontCoupon, StorefrontCustomField, StorefrontProductDetail } from "@bs/domain";
import { formatMoney } from "@bs/contracts/money";
import { CouponCards } from "./CouponCards.tsx";
import { SvgIcon, normalizeElementOrder, type ProductDetailOptions } from "@bs/blocks";
import { customFieldBody } from "./ProductCustomField.tsx";
import { descriptionText } from "@/lib/description-text.ts";
import { RatingSummary } from "./RatingSummary.tsx";
import { ProductGallery } from "./ProductGallery.tsx";
import { ProductBuyProvider, SkuLine, VariantOptions, PriceBlock, PurchaseActions } from "./VariantSelector.tsx";
import { ProductDescription } from "./ProductDescription.tsx";
import { DeliveryEstimate } from "./DeliveryEstimate.tsx";
import { MobileBuyBar } from "./MobileBuyBar.tsx";

export const DEFAULT_PRODUCT_DETAIL_OPTIONS: ProductDetailOptions = {
  galleryPosition: "left",
  showBreadcrumb: true,
  showRating: true,
  showDescription: true,
  showTags: true,
  showCoupons: true,
  couponCount: 2,
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
  customFields = [],
  coupons = [],
  currency = "INR",
  locale,
}: {
  product: StorefrontProductDetail;
  /** The product's custom field values, for accordion rows that pull one. */
  customFields?: StorefrontCustomField[] | undefined;
  /** Coupons the store shows (Discount > Show on the storefront). */
  coupons?: StorefrontCoupon[] | undefined;
  options?: ProductDetailOptions | undefined;
  /** Resolved URL of the theme's secure-payment picture (media library); the built-in badge is used when absent. */
  paymentImageUrl?: string | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
}) {
  const prices = (product.variants ?? []).map((v) => v.price);
  const lowest = prices.length > 0 ? Math.min(...prices) : 0;
  const fmt = (minor: number) => formatMoney(minor, currency, { ...(locale ? { locale } : {}) });
  const priceLabel = prices.length > 1 && Math.max(...prices) !== lowest ? `From ${fmt(lowest)}` : fmt(lowest);
  const longDescription = descriptionText(product.descriptionJson);
  const usps = options.showUsps ? (options.usps ?? []).slice(0, 4) : [];

  const gallery = (
    <div className={options.galleryPosition === "right" ? "lg:order-2" : undefined}>
      <ProductGallery media={product.media} title={product.title} thumbPosition={options.thumbPosition ?? "bottom"} />
    </div>
  );

  const accordionRows = (options.showAccordion ? (options.accordionItems ?? []) : [])
    .map((item) => {
      if (item.source === "custom_field") {
        const field = customFields.find((f) => f.key === item.fieldKey);
        return { item, body: field ? customFieldBody(field) : null };
      }
      const text = item.text?.trim();
      return { item, body: text ? <p className="whitespace-pre-line">{text}</p> : null };
    })
    .filter((r) => r.body !== null);

  // The elements of the buy-box column, in the order the theme sets (the old fixed order when it sets none). Rating, title
  // and SKU that follow each other stay together as one block.
  const elements: Record<string, React.ReactNode> = {
    rating: options.showRating ? <RatingSummary average={product.ratingAvg} count={Number(product.ratingCount)} /> : null,
    title: (
      <>
        {product.brand ? <p className="text-xs font-semibold uppercase tracking-wider text-primary">{product.brand.name}</p> : null}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground" style={{ fontFamily: "var(--bs-font-heading, inherit)" }}>
          {product.title}
        </h1>
      </>
    ),
    sku: options.showSku !== false ? <SkuLine /> : null,
    description: options.showDescription ? (
      <ProductDescription title={product.title} short={product.shortDescription?.trim() ?? ""} full={longDescription} clamp={options.showReadMore === true} />
    ) : null,
    options: <VariantOptions style={options.variantStyle ?? "buttons"} />,
    price: <PriceBlock note={options.priceNote} />,
    actions: (
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
    ),
    payment: options.showPaymentImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={paymentImageUrl ?? "/secure-payment.svg"} alt={options.paymentImageAlt || "Secure payment"} loading="lazy" className="h-auto w-full max-w-md self-start" />
    ) : null,
    delivery: options.showDeliveryEstimate ? (
      <DeliveryEstimate
        cutoffHour={options.cutoffHour ?? 14}
        deliveryDays={options.deliveryDays ?? 3}
        shipsText={options.shipsText ?? ""}
        timeZone={options.timeZone ?? "Asia/Kolkata"}
      />
    ) : null,
    usps:
      usps.length > 0 ? (
        <ul
          className="bs-usp-grid -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
          style={{ "--usp-cols": usps.length } as React.CSSProperties}
          aria-label="Highlights"
          data-testid="product-usps"
        >
          {usps.map((u, i) => (
            <li key={i} className="flex basis-[calc(50%-0.375rem)] shrink-0 snap-start flex-col items-start gap-2 rounded-xl border border-border bg-surface/60 px-3 py-3 sm:min-w-0 sm:basis-auto sm:gap-2.5 sm:px-4">
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
      ) : null,
    accordion:
      accordionRows.length > 0 ? (
        <div className="border-t border-border/70" data-testid="product-accordion">
          {accordionRows.map(({ item, body }, i) => (
            <details key={i} className="group border-b border-border/70" {...(options.accordionFirstOpen !== false && i === 0 ? { open: true } : null)}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-0.5 py-4 [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 text-foreground/85">
                  <SvgIcon name={item.icon} px={22} />
                </span>
                <span className="flex-1 font-medium tracking-wide text-foreground">{item.title}</span>
                <svg className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="pb-5 pl-9 pr-3 leading-relaxed text-muted-foreground">{body}</div>
            </details>
          ))}
        </div>
      ) : null,
    coupons:
      options.showCoupons !== false && coupons.length > 0 ? (
        <CouponCards inline coupons={coupons} title="Available offers" showCount={options.couponCount ?? 2} showViewAll viewAllLabel="View all" />
      ) : null,
    tags:
      options.showTags && product.tags && product.tags.length > 0 ? (
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
      ) : null,
  };
  const headNames = new Set(["rating", "title", "sku"]);
  const orderedNodes: React.ReactNode[] = [];
  let headGroup: React.ReactNode[] = [];
  const flushHead = () => {
    if (headGroup.length > 0) orderedNodes.push(<div key={`head-${orderedNodes.length}`} className="flex flex-col gap-2">{headGroup}</div>);
    headGroup = [];
  };
  for (const name of normalizeElementOrder(options.elementOrder)) {
    const node = elements[name];
    if (node === null || node === undefined) continue;
    if (headNames.has(name)) headGroup.push(<React.Fragment key={name}>{node}</React.Fragment>);
    else {
      flushHead();
      orderedNodes.push(<React.Fragment key={name}>{node}</React.Fragment>);
    }
  }
  flushHead();

  return (
    <div className={`mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 lg:px-8 pb-2 sm:pb-8`}>
      {options.showBreadcrumb ? (
        <nav aria-label="Breadcrumb" className="mb-6 hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
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

      <div className="grid grid-cols-1 gap-6 sm:gap-10 lg:grid-cols-2 lg:gap-16 items-start">
        {gallery}

        <ProductBuyProvider product={product}>
          <div className={`flex flex-col gap-5 ${options.stickyBuyBox ? "lg:sticky lg:top-24" : ""}`}>{orderedNodes}</div>
        </ProductBuyProvider>
      </div>
      {options.stickyMobileBar ? <MobileBuyBar title={product.title} priceLabel={priceLabel} /> : null}
    </div>
  );
}
