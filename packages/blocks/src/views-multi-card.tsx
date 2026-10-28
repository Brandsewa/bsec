/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs, ContactFormOptions, ProductCouponsOptions, RenderContext } from "./types.ts";
import { layoutStyle } from "./layout.ts";
import { SvgIcon } from "./svg-icon.tsx";
import type * as R from "./registry.ts";

/**
 * Multi card: a section of cards (icon or picture, heading, text, link). Desktop is always a grid; tablets and phones
 * can be a grid or a swipeable slider. The slider reuses the product showcase's carousel behaviour (arrows, flat page
 * lines, autoplay) through the same host hook, so no second script ships. Pure CSS otherwise.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;
const mediaSrc = (ctx: RenderContext | undefined, id: string | undefined): string | null => (id ? (ctx?.mediaUrl?.(id) ?? null) : null);

const arrowSvg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

/** Coupon cards (product page). The storefront draws the real ones; the editor and previews draw labelled samples. */
export function ProductCouponsView({ props, ctx }: A<R.ProductCouponsProps>): ReactNode {
  if (ctx?.renderProductCoupons) return <>{ctx.renderProductCoupons(props as ProductCouponsOptions)}</>;
  const samples = [
    { code: "WELCOME10", benefit: "10% off", condition: "On your first order" },
    { code: "FREESHIP", benefit: "Free shipping", condition: "On orders over ₹999" },
  ].slice(0, props.showCount);
  return (
    <section className="bsb bs-block-product-coupons bsb-py-sm">
      <div className="bsb-w bsb-w-wide">
        {props.title ? <h3 className="bsb-heading bsb-lvl-h4">{props.title}</h3> : null}
        <div className="bsb-coupon-row">
          {samples.map((c) => (
            <div key={c.code} className="bsb-coupon">
              <strong>{c.benefit}</strong>
              <span className="bsb-muted">{c.condition}</span>
              <code>{c.code}</code>
            </div>
          ))}
        </div>
        <p className="bsb-muted" style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
          Sample coupons. The shop shows the discounts you switch on under Discounts &gt; Show on the storefront.
        </p>
      </div>
    </section>
  );
}

/** Contact form. The storefront draws the live, working form; the editor draws a static sample. Off = nothing on the storefront. */
export function ContactFormView({ props, ctx }: A<R.ContactFormProps>): ReactNode {
  const live = Boolean(ctx?.renderContactForm);
  if (live && !props.enabled) return null;
  return (
    <section className={cx("bsb bs-block-contact-form bsb-lay", `bsb-tone-${props.tone}`)} style={layoutStyle(props.box)}>
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        {props.title ? <h2 className="bsb-heading bsb-lvl-h2">{props.title}</h2> : null}
        {props.description ? <p className="bsb-muted">{props.description}</p> : null}
        {ctx?.renderContactForm ? (
          ctx.renderContactForm(props as ContactFormOptions)
        ) : (
          <div className="bsb-cf-sample" style={{ opacity: props.enabled ? 1 : 0.5, textAlign: props.fieldAlign, "--cf-j": props.fieldAlign === "center" ? "center" : props.fieldAlign === "right" ? "flex-end" : "flex-start" } as CSSProperties}>
            <div className="bsb-ph-box" style={{ height: 48 }}><span>Name</span></div>
            <div className="bsb-ph-box" style={{ height: 48 }}><span>Email</span></div>
            {props.showPhone ? <div className="bsb-ph-box" style={{ height: 48 }}><span>Phone</span></div> : null}
            {props.showDropdown ? <div className="bsb-ph-box" style={{ height: 48 }}><span>{props.dropdownLabel}</span></div> : null}
            {props.showMessage ? <div className="bsb-ph-box" style={{ height: 128 }}><span>{props.messageLabel}</span></div> : null}
            <p className="bsb-muted" style={{ fontSize: "0.75rem" }}>
              {props.enabled ? `Sample. Submissions go to the admin inbox${props.recipientEmail ? ` (recipient: ${props.recipientEmail})` : ""}.` : "Switched off: this form is hidden on the storefront."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function MultiCardView({ props, ctx }: A<R.MultiCardProps>): ReactNode {
  const slider = props.tabletLayout === "slider" || props.mobileLayout === "slider";
  const hasHead = Boolean(props.title || props.subtitle);
  const vars = {
    "--psc-d": Number(props.perRowDesktop),
    "--psc-t": Number(props.perRowTablet),
    "--psc-m": Number(props.perRowMobile),
    "--psc-gap": `${props.gap}px`,
    "--mc-pad": `${props.cardPadding}px`,
    "--mc-rad": `${props.cardRadius}px`,
    "--mc-bw": `${props.borderWidth}px`,
    "--mc-gap": `${props.elementGap}px`,
    "--mc-icon": `${props.iconSize}px`,
    "--mc-minh": `${props.cardMinHeight}px`,
    "--mc-ratio": props.imageRatio.replace(":", " / "),
    ...(props.borderColor ? { "--mc-bc": props.borderColor } : null),
    ...(props.cardBg ? { "--mc-bg": props.cardBg } : null),
    ...(props.cardText ? { "--mc-fg": props.cardText } : null),
    ...(props.sectionBg ? { "--mc-sbg": props.sectionBg } : null),
  } as CSSProperties;

  const cards = props.items.map((it, i) => {
    const icon = mediaSrc(ctx, it.iconMediaId);
    const bgImg = mediaSrc(ctx, it.bgMediaId ?? props.cardBgMediaId);
    const topImg = props.cardStyle === "image" ? mediaSrc(ctx, it.imageMediaId) : null;
    const showIcon = props.cardStyle !== "image" && props.showIcon && (icon || it.icon);
    return (
      <div key={i} className={cx("bsb-mc-card", props.cardStyle === "image" && "bsb-mc-card-s2", bgImg && "bsb-mc-card-img", props.cardBg && "bsb-mc-card-bg")} {...(slider ? { "data-psc-item": "" } : null)}>
        {bgImg ? (
          <>
            <img className="bsb-mc-bgimg" src={bgImg} alt="" loading="lazy" />
            <span className="bsb-mc-shade" style={{ opacity: props.cardOverlay / 100 }} aria-hidden="true" />
          </>
        ) : null}
        {props.cardStyle === "image" && topImg ? <img className="bsb-mc-topimg" src={topImg} alt="" loading="lazy" /> : null}
        <div className={cx("bsb-mc-body", `bsb-mc-v-${props.contentAlign}`, `bsb-align-${props.textAlign}`)}>
          {showIcon ? (
            <span className="bsb-mc-icon" aria-hidden="true">
              {icon ? <img src={icon} alt="" loading="lazy" /> : <SvgIcon name={it.icon as string} px={props.iconSize} />}
            </span>
          ) : null}
          {props.showHeading && it.heading ? <h3 className="bsb-mc-title">{it.heading}</h3> : null}
          {props.showText && it.text ? <p className="bsb-mc-text">{it.text}</p> : null}
          {props.showLink && it.linkLabel && it.linkHref ? (
            <a className={cx("bsb-mc-link", props.linkStyle === "button" && "bsb-btn bsb-btn-primary bsb-btn-sm")} href={it.linkHref}>
              {it.linkLabel}
              {props.linkStyle === "link" ? " →" : ""}
            </a>
          ) : null}
        </div>
      </div>
    );
  });

  const markup = (
    <section
      className={cx("bsb bs-block-multi-card bsb-lay", `bsb-tone-${props.tone}`, props.sectionBg && "bsb-mc-sbg", slider && "bsb-psc", `bsb-mc-t-${props.tabletLayout}`, `bsb-mc-m-${props.mobileLayout}`)}
      style={{ ...vars, ...layoutStyle(props.box) }}
      {...(slider ? { "data-psc": "", "aria-roledescription": "carousel" } : null)}
      aria-label={props.title || "Cards"}
    >
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        {hasHead ? (
          <div className={cx("bsb-mc-head", `bsb-align-${props.headerAlign}`)}>
            {props.title ? <h2 className="bsb-heading bsb-lvl-h2">{props.title}</h2> : null}
            {props.subtitle ? <p className="bsb-muted">{props.subtitle}</p> : null}
          </div>
        ) : null}
        {slider ? (
          <div className="bsb-psc-panel" data-psc-panel="">
            <div className="bsb-psc-viewport">
              <div className="bsb-psc-track bsb-mc-track" data-psc-track="" tabIndex={0}>
                {cards}
              </div>
              {props.arrows ? (
                <div className="bsb-hs-arrows bsb-psc-arrows bsb-hs-arrow-circle bsb-hs-arrow-md bsb-hs-arrow-c-light">
                  <button type="button" className="bsb-hs-arrow bsb-hs-prev" data-psc-prev="" aria-label="Previous cards">
                    {arrowSvg(<path d="M15 5l-7 7 7 7" />)}
                  </button>
                  <button type="button" className="bsb-hs-arrow bsb-hs-next" data-psc-next="" aria-label="Next cards">
                    {arrowSvg(<path d="M9 5l7 7-7 7" />)}
                  </button>
                </div>
              ) : null}
            </div>
            {props.dots ? <div className={cx("bsb-hs-dots", "bsb-psc-dots", "bsb-mc-dots", "bsb-hs-dots-center", "bsb-hs-dots-md", `bsb-hs-dots-c-${props.dotsColor}`)} data-psc-dots="" role="group" aria-label="Choose page" /> : null}
          </div>
        ) : (
          <div className="bsb-mc-track bsb-mc-grid">{cards}</div>
        )}
      </div>
    </section>
  );

  const behavior = { tabs: false, autoplay: props.autoplay, interval: props.interval, loop: props.loop, pauseOnHover: true };
  return slider && ctx?.renderProductShowcase ? <>{ctx.renderProductShowcase({ options: behavior, children: markup })}</> : markup;
}
