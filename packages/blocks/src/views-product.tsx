/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs, RenderContext } from "./types.ts";
import { normalizeElementOrder, type PRODUCT_ELEMENTS } from "./product-elements.ts";
import type { ProductDetailProps } from "./registry.ts";
import { SvgIcon } from "./svg-icon.tsx";
import { SampleBuyProvider, SampleOptions, SamplePrice } from "./views-product-sample-client.tsx";

/**
 * The product page as the editors draw it: the same elements, in the same order and with the same settings as the
 * storefront's product page (gallery, rating, title, SKU, description, options, price, buttons, payment picture, delivery
 * estimate, highlight cards, accordion, tags), filled with a sample product. The storefront draws the real thing through
 * `renderProductDetail`; this keeps what is edited and what shoppers see in step, including the order set by the theme.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

function Chevron() {
  return (
    <svg className="bsb-pd-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The accordion rows: one per item, the first open when asked. A custom-field row shows a sample value here (the product's own value on the store). */
export function ProductAccordionRows({ items, firstOpen, valueOf }: { items: NonNullable<ProductDetailProps["accordionItems"]>; firstOpen: boolean; valueOf: (item: NonNullable<ProductDetailProps["accordionItems"]>[number]) => ReactNode }) {
  const rows = items.map((it) => ({ it, body: valueOf(it) })).filter((r) => r.body !== null && r.body !== undefined && r.body !== "");
  if (rows.length === 0) return null;
  return (
    <div className="bsb-pd-acc">
      {rows.map(({ it, body }, i) => (
        <details key={i} className="bsb-pd-acc-item" {...(firstOpen && i === 0 ? { open: true } : null)}>
          <summary className="bsb-pd-acc-head">
            <span className="bsb-pd-acc-icon">
              <SvgIcon name={it.icon} px={22} />
            </span>
            <span className="bsb-pd-acc-title">{it.title}</span>
            <Chevron />
          </summary>
          <div className="bsb-pd-acc-body">{body}</div>
        </details>
      ))}
    </div>
  );
}

export function ProductDetailSample({ props, ctx }: BlockRenderArgs<ProductDetailProps>): ReactNode {
  const order = normalizeElementOrder(props.elementOrder);
  const paymentUrl = props.paymentImageMediaId ? (ctx?.mediaUrl?.(props.paymentImageMediaId) ?? null) : null;
  const usps = props.showUsps ? props.usps.slice(0, 4) : [];
  const btn = (bg: string | undefined, fg: string | undefined): CSSProperties => ({ ...(bg ? { backgroundColor: bg } : null), ...(fg ? { color: fg } : null) });

  const element: Record<(typeof PRODUCT_ELEMENTS)[number], ReactNode> = {
    rating: props.showRating ? (
      <div className="bsb-pd-rating">
        <span className="bsb-stars" aria-hidden="true">★★★★★</span> <span className="bsb-muted">(12 reviews)</span>
      </div>
    ) : null,
    title: <h1 className="bsb-heading bsb-h-lg bsb-pd-title">Sample product name</h1>,
    sku: props.showSku ? <p className="bsb-pd-sku">SKU: SAMPLE-050</p> : null,
    description: props.showDescription ? (
      <div>
        <p className={cx("bsb-pd-desc", props.showReadMore && "bsb-pd-desc-clamp")}>
          A short product description appears here, written by the store for each product. It can run over a few lines, so shoppers get the main idea before they read the details.
        </p>
        {props.showReadMore ? <span className="bsb-pd-more">Read more</span> : null}
      </div>
    ) : null,
    options: <SampleOptions style={props.variantStyle} />,
    price: <SamplePrice note={props.priceNote} />,
    actions: (
      <div className="bsb-pd-actions">
        <div className="bsb-pd-buyrow">
          <span className="bsb-pd-qty">
            <span aria-hidden="true">−</span>
            <span>1</span>
            <span aria-hidden="true">+</span>
          </span>
          <span className={cx("bsb-pd-cart", !props.addToCartBg && "bsb-pd-cart-plain")} style={btn(props.addToCartBg, props.addToCartText)}>
            {props.addToCartLabel}
          </span>
        </div>
        {props.showBuyNow ? (
          <span className={cx("bsb-pd-buy", !props.buyNowBg && "bsb-pd-buy-primary")} style={btn(props.buyNowBg, props.buyNowText)}>
            {props.buyNowLabel}
          </span>
        ) : null}
        {props.showTrustPoints && props.trustPoints.length > 0 ? <p className="bsb-muted bsb-pd-trust">{props.trustPoints.join(" · ")}</p> : null}
      </div>
    ),
    payment: props.showPaymentImage ? (
      <img className="bsb-pd-pay" src={paymentUrl ?? "/secure-payment.svg"} alt={props.paymentImageAlt || "Secure payment"} loading="lazy" />
    ) : null,
    delivery: props.showDeliveryEstimate ? (
      <p className="bsb-pd-delivery">
        <SvgIcon name="truck" px={18} /> Arrives <strong>in {props.deliveryDays} days</strong> if you order before {props.cutoffHour}:00. {props.shipsText}
      </p>
    ) : null,
    usps:
      usps.length > 0 ? (
        <ul className="bsb-pd-usps" style={{ "--usp-cols": usps.length } as CSSProperties}>
          {usps.map((u, i) => (
            <li key={i} className="bsb-pd-usp">
              <SvgIcon name={u.icon} px={28} />
              <span>
                <strong>{u.text}</strong>
                {u.description ? <span className="bsb-muted">{u.description}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null,
    accordion: props.showAccordion ? (
      <ProductAccordionRows
        items={props.accordionItems}
        firstOpen={props.accordionFirstOpen}
        valueOf={(it) => (it.source === "custom_field" ? <p className="bsb-muted">{`Value of “${it.fieldKey || "custom field"}” from each product (hidden for a product without it).`}</p> : <p style={{ whiteSpace: "pre-line" }}>{it.text}</p>)}
      />
    ) : null,
    coupons: props.showCoupons !== false ? <div className="bsb-coupon"><strong>10% off</strong><code>WELCOME10</code><span className="bsb-muted">Sample coupon card</span></div> : null,
    tags: props.showTags ? <p className="bsb-muted bsb-pd-tags">Tags: #tea #green #organic</p> : null,
  };

  // Rating, title and SKU stay close together when they follow each other, as on the storefront.
  const head = new Set(["rating", "title", "sku"]);
  const nodes: ReactNode[] = [];
  let group: ReactNode[] = [];
  const flush = () => {
    if (group.length > 0) nodes.push(<div key={`g${nodes.length}`} className="bsb-pd-head">{group}</div>);
    group = [];
  };
  for (const name of order) {
    const node = element[name];
    if (node === null || node === undefined) continue;
    if (head.has(name)) group.push(<div key={name}>{node}</div>);
    else {
      flush();
      nodes.push(<div key={name}>{node}</div>);
    }
  }
  flush();

  const gallery = (
    <div className={cx("bsb-pd-gallery", `bsb-pd-thumbs-${props.thumbPosition}`, props.galleryPosition === "right" && "bsb-pd-gallery-right")}>
      <div className="bsb-pd-thumbs">
        {[0, 1].map((i) => (
          <span key={i} className={cx("bsb-ph-box bsb-pd-thumb", i === 0 && "bsb-pd-thumb-on")} aria-hidden="true" />
        ))}
      </div>
      <div className="bsb-ph-box bsb-pd-main" aria-hidden="true">
        <span>Product images</span>
      </div>
    </div>
  );

  return (
    <section className="bsb bs-block-product-detail bsb-py-lg">
      <div className="bsb-w bsb-w-wide">
        {props.showBreadcrumb ? <p className="bsb-muted bsb-pd-crumb">Home / Products / Sample product name</p> : null}
        <div className="bsb-pd-grid">
          {gallery}
          <SampleBuyProvider>
            <div className={cx("bsb-pd-info", props.stickyBuyBox && "bsb-pd-sticky")}>{nodes}</div>
          </SampleBuyProvider>
        </div>
        <p className="bsb-muted bsb-align-center" style={{ fontSize: "0.75rem", marginTop: "1rem" }}>
          <strong>Product page</strong> · Each product&apos;s own images, price and options fill this area.
        </p>
      </div>
    </section>
  );
}

export type { RenderContext };
