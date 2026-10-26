/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode, ElementType } from "react";
import { sanitizeRichText } from "./sanitize.ts";
import { parseMarkdownToHtml } from "./markdown.ts";
import type {
  BlockProduct,
  CartContentsOptions,
  CollectionListingOptions,
  ProductDetailOptions,
  ProductCustomFieldOptions,
  ProductInfoTabsOptions,
  BlockRenderArgs,
  RenderContext,
  SlotRender,
} from "./types.ts";
import { layoutHasAspectRatio, layoutStyle, slideRadiusStyle } from "./layout.ts";
import { bricksElementStyle } from "./bricks-layout.ts";
import { mediaImage } from "./media-image.ts";
import { PLACEHOLDER_IMAGE_URL } from "./media.ts";
import { SvgIcon } from "./svg-icon.tsx";
import type * as R from "./registry.ts";
import { ProductDetailSample } from "./views-product.tsx";
import { MobileMenu } from "./views-mobile-menu-client.tsx";
import type { LogoSize } from "./common.ts";

/**
 * Presentational renderers for every block. Pure: no hooks, no data fetching, no browser
 * APIs, so they render identically in the storefront (server) and the visual editor.
 * All styling is class-based (blocks.css); merchants only pick enumerated options.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;

const mediaSrc = (ctx: RenderContext | undefined, id: string | undefined): string | null =>
  id ? (ctx?.mediaUrl?.(id) ?? null) : null;

const isExternal = (href: string) => /^https?:\/\//i.test(href);
const rel = (href: string, newTab?: boolean) =>
  newTab || isExternal(href) ? "noopener noreferrer" : undefined;

function Actions({ children }: { children: ReactNode }) {
  return <div className="bsb-actions">{children}</div>;
}

/** Storefront prices are stored in paise (minor units). */
const money = (paise: number) => {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: rupees % 1 === 0 ? 0 : 2 })}`;
};

function Stars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="bsb-stars" role="img" aria-label={`${v} out of 5 stars`}>
      {"★".repeat(v)}
      {"☆".repeat(5 - v)}
    </span>
  );
}

/* ---------------------------- sections ---------------------------- */

function SectionHead({
  title,
  subtitle,
  align = "left",
  action,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
  align?: "left" | "center" | "right";
  action?: ReactNode;
}) {
  if (!title && !subtitle) return null;
  return (
    <div className={cx("bsb-section-head", `bsb-align-${align}`)}>
      <div>
        {title ? <h2 className="bsb-heading bsb-h-lg">{title}</h2> : null}
        {subtitle ? <p className="bsb-muted" style={{ margin: "0.4rem 0 0" }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function HeroView({ props, ctx }: A<R.HeroProps>): ReactNode {
  const detail = props.backgroundMediaId ? ctx?.mediaDetails?.(props.backgroundMediaId) : null;
  const bg = detail?.url ?? mediaSrc(ctx, props.backgroundMediaId);
  const bgImg = bg
    ? mediaImage(
        detail
          ? {
              url: bg,
              width: detail.width,
              height: detail.height,
              focalX: detail.focalX,
              focalY: detail.focalY,
              dominantColor: detail.dominantColor,
              derivatives: detail.derivatives,
            }
          : { url: bg },
        { sizes: "100vw" },
      )
    : null;
  const ctaText = props.ctaText ?? props.buttonText;
  const ctaLink = props.ctaLink ?? props.buttonUrl;
  return (
    <section
      className={cx("bsb bs-block-hero bsb-hero", !bg && `bsb-tone-${props.tone}`)}
      style={{ backgroundColor: bgImg?.dominantColor ?? undefined }}
    >
      {bgImg ? (
        <>
          <img
            className="bsb-hero-bg"
            src={bgImg.src}
            srcSet={bgImg.srcSet}
            sizes={bgImg.sizes}
            alt=""
            style={{ objectPosition: bgImg.objectPosition }}
          />
          <div className="bsb-hero-scrim" style={{ opacity: props.overlayOpacity / 100 }} />
        </>
      ) : null}
      <div className={cx("bsb-hero-inner", !bg && "bsb-no-media")}>
        <div className={cx("bsb-hero-copy", `bsb-align-${props.alignment}`)}>
          {props.eyebrow ? <p className="bsb-eyebrow">{props.eyebrow}</p> : null}
          <h1 className="bsb-heading bsb-h-xl">{props.title}</h1>
          {props.subtitle ? (
            <p style={{ fontSize: "1.125rem", lineHeight: 1.55, margin: "1rem 0 0", opacity: 0.92 }}>{props.subtitle}</p>
          ) : null}
          {ctaText ? (
            <div
              className="bsb-actions"
              style={{ marginTop: "1.75rem", justifyContent: props.alignment === "center" ? "center" : props.alignment === "right" ? "flex-end" : "flex-start" }}
            >
              <a href={ctaLink || "#"} className="bsb-btn bsb-btn-lg" style={{ background: "#fff", color: "#0f172a", borderColor: "#fff" }}>
                {ctaText}
              </a>
              {props.secondaryCtaText ? (
                <a href={props.secondaryCtaLink || "#"} className="bsb-btn bsb-btn-lg" style={{ background: "transparent", color: "inherit", borderColor: "currentColor" }}>
                  {props.secondaryCtaText}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function BannerView({ props, ctx }: A<R.BannerProps>): ReactNode {
  const all = [{ text: props.text, link: props.link }, ...props.messages];
  const rotating = props.rotate && all.length > 1;
  const style = {
    padding: "0.6rem 1rem",
    fontSize: `${props.fontSize / 16}rem`,
    fontWeight: Number(props.fontWeight),
    ...(props.font === "heading" ? { fontFamily: "var(--fh, inherit)" } : null),
    ...(props.bgColor ? { background: props.bgColor } : null),
    ...(props.textColor ? { color: props.textColor } : null),
    "--ann-n": all.length,
    "--ann-iv": `${props.interval}s`,
  } as CSSProperties;
  const bar = (
    <div
      className={cx("bsb bs-block-banner bsb-ann", !props.bgColor && "bsb-tone-primary", `bsb-align-${props.align}`, rotating && `bsb-ann-rotate bsb-ann-n${all.length}`)}
      style={style}
      role="region"
      aria-label="Announcements"
    >
      {rotating ? (
        <button type="button" className="bsb-ann-nav bsb-ann-prev" data-ann-dir="-1" aria-label="Previous announcement">
          ‹
        </button>
      ) : null}
      {all.map((m, i) => (
        <p key={i} className="bsb-ann-msg" style={{ "--ann-i": i } as CSSProperties} {...(rotating && i > 0 ? { "aria-hidden": true } : null)}>
          {m.link ? (
            // A linked message is not underlined: a small arrow after the text shows that it can be clicked.
            <a href={m.link} className="bsb-ann-link">
              {m.text}
              <span className="bsb-ann-go" aria-hidden="true">
                →
              </span>
            </a>
          ) : (
            m.text
          )}
        </p>
      ))}
      {rotating ? (
        <button type="button" className="bsb-ann-nav bsb-ann-next" data-ann-dir="1" aria-label="Next announcement">
          ›
        </button>
      ) : null}
    </div>
  );
  return rotating && ctx?.renderBanner ? <>{ctx.renderBanner({ children: bar })}</> : bar;
}

function defaultCard(p: BlockProduct, o: { showPrice: boolean; showRating: boolean }, ctx?: RenderContext): ReactNode {
  const img = p.imageUrl ?? mediaSrc(ctx, p.imageMediaId);
  return (
    <a className="bsb-card" href={`/products/${p.slug}`}>
      <div className="bsb-card-media">
        <img src={img ?? PLACEHOLDER_IMAGE_URL} alt={img ? (p.imageAlt ?? p.title) : ""} loading="lazy" />
      </div>
      <div className="bsb-card-body">
        <h3 className="bsb-card-title">{p.title}</h3>
        {o.showRating && p.ratingCount ? (
          <div style={{ fontSize: "0.8125rem" }}>
            <Stars value={Number(p.ratingAvg ?? 0)} /> <span className="bsb-muted">({p.ratingCount})</span>
          </div>
        ) : null}
        {o.showPrice ? (
          <div className="bsb-price">
            {p.priceOnRequest ? (
              <span className="bsb-muted">Price on request</span>
            ) : (
              <>
                {money(p.priceMin)}
                {p.compareAtPriceMin && p.compareAtPriceMin > p.priceMin ? <s>{money(p.compareAtPriceMin)}</s> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </a>
  );
}

function productsFor(ctx: RenderContext | undefined, blockId?: string): BlockProduct[] {
  const d = blockId ? ctx?.data?.[blockId] : undefined;
  return d && d.kind === "products" ? d.products : [];
}

function ProductList({
  products,
  ctx,
  showPrice,
  showRating,
}: {
  products: BlockProduct[];
  ctx: RenderContext | undefined;
  showPrice: boolean;
  showRating: boolean;
}) {
  return products.map((p) => (
    <div key={p.id}>
      {ctx?.renderProductCard ? ctx.renderProductCard(p, { showPrice, showRating }) : defaultCard(p, { showPrice, showRating }, ctx)}
    </div>
  ));
}

export function ProductGridView({ props, ctx }: A<R.ProductGridProps>): ReactNode {
  const products = productsFor(ctx, ctx?.blockId);
  return (
    <section className={cx("bsb bs-block-product-grid bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide">
        <SectionHead title={props.title} subtitle={props.subtitle} align="center" />
        {products.length === 0 ? (
          <p className="bsb-muted bsb-align-center" data-testid="product-grid-empty">No products to show yet.</p>
        ) : (
          <div className="bsb-grid bsb-gap-md" data-testid="product-grid" style={{ "--cols": Number(props.columns), "--cols-m": 2 } as CSSProperties}>
            <ProductList products={products} ctx={ctx} showPrice={props.showPrice} showRating={props.showRating} />
          </div>
        )}
      </div>
    </section>
  );
}

export function CollectionGridView({ props, ctx }: A<R.CollectionGridProps>): ReactNode {
  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  const collections = d && d.kind === "collections" ? d.collections : [];
  return (
    <section className="bsb bs-block-collection-grid bsb-py-lg">
      <div className="bsb-w bsb-w-wide">
        <SectionHead title={props.title} subtitle={props.subtitle} align={props.headerAlign} />
        {collections.length === 0 ? (
          <p className={cx("bsb-muted", `bsb-align-${props.headerAlign}`)}>No collections selected yet.</p>
        ) : (
          <div className="bsb-grid bsb-ccards" style={{ "--cols": Number(props.columns), "--cols-t": Number(props.columnsTablet), "--cols-m": Number(props.columnsMobile) } as CSSProperties}>
            {collections.map((c) => {
              const img = mediaSrc(ctx, c.imageMediaId);
              return (
                <a key={c.slug} className="bsb-ccard" href={`/collections/${c.slug}`}>
                  <div className="bsb-ccard-media">
                    <img src={img ?? PLACEHOLDER_IMAGE_URL} alt="" loading="lazy" />
                  </div>
                  <div className="bsb-ccard-body">
                    <h3 className="bsb-ccard-title">{c.title}</h3>
                    {c.description ? <p className="bsb-ccard-desc">{c.description}</p> : null}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function ProductCarouselView({ props, ctx }: A<R.ProductCarouselProps>): ReactNode {
  const products = productsFor(ctx, ctx?.blockId);
  return (
    <section className={cx("bsb bs-block-product-carousel bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide">
        <SectionHead
          title={props.title}
          subtitle={props.subtitle}
          action={
            props.viewAllLabel ? (
              <a className="bsb-link" href={props.viewAllHref || "/collections/all"}>
                {props.viewAllLabel} →
              </a>
            ) : undefined
          }
        />
        {products.length === 0 ? (
          <p className="bsb-muted">No products to show yet.</p>
        ) : (
          <div className="bsb-carousel" style={{ "--cols": Number(props.columns) } as CSSProperties}>
            <ProductList products={products} ctx={ctx} showPrice={props.showPrice} showRating={props.showRating} />
          </div>
        )}
      </div>
    </section>
  );
}

function QuoteCard({ item, ctx }: { item: R.TestimonialsProps["items"][number]; ctx: RenderContext | undefined }) {
  const avatar = mediaSrc(ctx, item.avatarMediaId);
  return (
    <figure className="bsb-quote">
      <Stars value={item.rating} />
      <blockquote style={{ margin: 0, lineHeight: 1.6 }}>“{item.quote}”</blockquote>
      <figcaption className="bsb-person">
        {avatar ? (
          <img className="bsb-avatar" src={avatar} alt="" loading="lazy" width={36} height={36} />
        ) : (
          <span className="bsb-avatar" aria-hidden>{item.author.slice(0, 1).toUpperCase()}</span>
        )}
        <span>
          {item.author}
          {item.role ? <span className="bsb-muted" style={{ display: "block", fontWeight: 400, fontSize: "0.75rem" }}>{item.role}</span> : null}
        </span>
      </figcaption>
    </figure>
  );
}

export function TestimonialsView({ props, ctx }: A<R.TestimonialsProps>): ReactNode {
  const items = props.items;
  return (
    <section className={cx("bsb bs-block-testimonials bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide">
        <SectionHead title={props.title} align="center" />
        {props.layout === "single" ? (
          <div style={{ maxWidth: "44rem", margin: "0 auto" }}>
            {items[0] ? <QuoteCard item={items[0]} ctx={ctx} /> : null}
          </div>
        ) : props.layout === "carousel" ? (
          <div className="bsb-carousel" style={{ "--cols": 3 } as CSSProperties}>
            {items.map((it, i) => (
              <div key={i}><QuoteCard item={it} ctx={ctx} /></div>
            ))}
          </div>
        ) : (
          <div className="bsb-grid bsb-gap-md" style={{ "--cols": 3, "--cols-m": 1 } as CSSProperties}>
            {items.map((it, i) => (
              <QuoteCard key={i} item={it} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function ReviewsView({ props }: A<R.ReviewsProps>): ReactNode {
  return (
    <section className="bsb bs-block-reviews bsb-py-lg">
      <div className="bsb-w bsb-w-default">
        <SectionHead title={props.title} />
      </div>
    </section>
  );
}

export function RichTextView({ props }: A<R.RichTextProps>): ReactNode {
  const customStyle = bricksElementStyle(props);
  return (
    <section
      className={cx("bsb bs-block-richtext brxe-text bsb-py-lg bsb-w bsb-w-default bsb-richtext", `bsb-align-${props.alignment}`)}
      style={customStyle}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(props.content) }}
    />
  );
}

export function FaqView({ props }: A<R.FAQProps>): ReactNode {
  return (
    <section className="bsb bs-block-faq bsb-py-lg">
      <div className="bsb-w bsb-w-narrow bsb-faq">
        <SectionHead title={props.title} align="center" />
        {props.items.map((it, i) => (
          <details key={i}>
            <summary>{it.question}</summary>
            <p className="bsb-muted" style={{ margin: "0.6rem 0 0" }}>{it.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function GalleryView({ props, ctx }: A<R.GalleryProps>): ReactNode {
  return (
    <section className="bsb bs-block-gallery bsb-py-lg">
      <div className="bsb-w bsb-w-wide">
        <SectionHead title={props.title} align="center" />
        <div className="bsb-grid bsb-gap-md" style={{ "--cols": 3, "--cols-m": 2 } as CSSProperties}>
          {props.images.map((im, i) => {
            const detail = im.mediaId ? ctx?.mediaDetails?.(im.mediaId) : null;
            const src = detail?.url ?? mediaSrc(ctx, im.mediaId);
            if (!src) return null;
            const imgInfo = mediaImage(
              detail
                ? {
                    url: src,
                    width: detail.width,
                    height: detail.height,
                    focalX: detail.focalX,
                    focalY: detail.focalY,
                    dominantColor: detail.dominantColor,
                    derivatives: detail.derivatives,
                  }
                : { url: src },
              { sizes: "(max-width: 640px) 50vw, 33vw" },
            );
            const img = (
              <img
                className="bsb-img bsb-ratio-square bsb-rounded"
                src={imgInfo.src}
                srcSet={imgInfo.srcSet}
                sizes={imgInfo.sizes}
                alt={im.caption ?? detail?.alt ?? ""}
                loading="lazy"
                style={{
                  objectPosition: imgInfo.objectPosition,
                  backgroundColor: imgInfo.dominantColor ?? undefined,
                }}
              />
            );
            return <figure key={i} style={{ margin: 0 }}>{im.link ? <a href={im.link}>{img}</a> : img}</figure>;
          })}
        </div>
      </div>
    </section>
  );
}

export function NewsletterView({ props }: A<R.NewsletterProps>): ReactNode {
  return (
    <section className="bsb bs-block-newsletter bsb-tone-surface bsb-py-lg bsb-align-center">
      <div className="bsb-w bsb-w-narrow">
        <h2 className="bsb-heading bsb-h-lg">{props.title}</h2>
        {props.subtitle ? <p className="bsb-muted">{props.subtitle}</p> : null}
        <form className="bsb-form" action="#" method="post">
          <input className="bsb-input" type="email" name="email" placeholder={props.placeholder} aria-label="Email" />
          <button className="bsb-btn bsb-btn-primary" type="submit">{props.buttonText}</button>
        </form>
      </div>
    </section>
  );
}


export function UspStripView({ props }: A<R.UspStripProps>): ReactNode {
  return (
    <section className="bsb bs-block-usp-strip bsb-tone-surface bsb-py-md" style={{ borderBlock: "1px solid var(--b)" }}>
      <div className="bsb-w bsb-w-wide bsb-grid bsb-gap-md" style={{ "--cols": Math.min(props.items.length, 4), "--cols-m": 2 } as CSSProperties}>
        {props.items.map((it, i) => (
          <div key={i} className="bsb-usp">
            <span className="bsb-icon"><SvgIcon name={it.icon} px={28} /></span>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", marginTop: "0.4rem" }}>{it.title}</div>
            <div className="bsb-muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>{it.description}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- layout ----------------------------- */

/** Renders a layout block's children: a plain wrapper on the storefront, the drop zone in the editor. */
function Slot({
  children,
  className,
  style,
}: {
  children: ReactNode | SlotRender | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  if (typeof children === "function") return <>{children({ className, style } as { className?: string; style?: CSSProperties })}</>;
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function SectionView({ props, children, ctx }: A<R.SectionProps>): ReactNode {
  const bgImageId = props.background?.mediaId || props.backgroundMediaId;
  const desktopBg = props.background?.imageUrl || mediaSrc(ctx, bgImageId);
  const tabletBg = props.responsive?.tablet?.background?.imageUrl || mediaSrc(ctx, props.responsive?.tablet?.background?.mediaId);
  const mobileBg = props.responsive?.mobile?.background?.imageUrl || mediaSrc(ctx, props.responsive?.mobile?.background?.mediaId);
  const bg = desktopBg || tabletBg || mobileBg;

  const bgVideo = props.background?.videoUrl;
  const videoPoster = mediaSrc(ctx, props.background?.videoPosterId);
  const customStyle = bricksElementStyle(props, { defaultWidth: "100%", defaultDisplay: "flex" });

  const hasExplicitBg = Boolean(bg || bgVideo || props.background?.color);

  return (
    <section
      className={cx("bsb brxe-section brx-resp", !hasExplicitBg && props.tone && `bsb-tone-${props.tone}`, props.paddingY && `bsb-py-${props.paddingY}`)}
      style={{
        position: "relative",
        boxSizing: "border-box",
        ...customStyle,
      }}
    >
      {bg ? (
        <>
          <picture style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, borderRadius: "inherit", overflow: "hidden" }}>
            {mobileBg && <source media="(max-width: 767px)" srcSet={mobileBg} />}
            {tabletBg && <source media="(max-width: 1023px)" srcSet={tabletBg} />}
            <img
              className="bsb-hero-bg"
              src={desktopBg || tabletBg || mobileBg || ""}
              alt=""
              loading="lazy"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: (props.background?.imageSize as CSSProperties["objectFit"]) || "cover",
                objectPosition: props.background?.imagePosition || "center center",
                zIndex: 0,
                borderRadius: "inherit",
              }}
            />
          </picture>
          {props.overlayOpacity ? <div className="bsb-hero-scrim" style={{ position: "absolute", inset: 0, background: "#000", opacity: props.overlayOpacity / 100, zIndex: 0, borderRadius: "inherit" }} /> : null}
        </>
      ) : null}
      {bgVideo ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          poster={videoPoster ?? undefined}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: (props.background?.videoFit as CSSProperties["objectFit"]) || "cover",
            objectPosition: props.background?.videoPosition || "center center",
            zIndex: 0,
            borderRadius: "inherit",
          }}
        >
          <source src={bgVideo} />
        </video>
      ) : null}
      <Slot
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          display: "flex",
          flexDirection: (props.direction ? `var(--b-dir, ${props.direction})` : "var(--b-dir, column)") as CSSProperties["flexDirection"],
          alignItems: (props.alignCrossAxis ? `var(--b-ai, ${props.alignCrossAxis})` : "var(--b-ai, stretch)") as CSSProperties["alignItems"],
          justifyContent: (props.alignMainAxis ? `var(--b-jc, ${props.alignMainAxis})` : "var(--b-jc, flex-start)") as CSSProperties["justifyContent"],
          gap: props.gap ? `var(--b-gap, ${props.gap})` : (props.responsive?.tablet?.gap || props.responsive?.mobile?.gap ? "var(--b-gap)" : undefined),
          rowGap: props.rowGap ? `var(--b-rg, ${props.rowGap})` : (props.responsive?.tablet?.rowGap || props.responsive?.mobile?.rowGap ? "var(--b-rg)" : undefined),
          columnGap: props.colGap ? `var(--b-cg, ${props.colGap})` : (props.responsive?.tablet?.colGap || props.responsive?.mobile?.colGap ? "var(--b-cg)" : undefined),
        }}
      >
        {children}
      </Slot>
    </section>
  );
}

export function ContainerView({ props, children, ctx }: A<R.ContainerProps>): ReactNode {
  const desktopBg = props.background?.imageUrl || mediaSrc(ctx, props.background?.mediaId);
  const tabletBg = props.responsive?.tablet?.background?.imageUrl || mediaSrc(ctx, props.responsive?.tablet?.background?.mediaId);
  const mobileBg = props.responsive?.mobile?.background?.imageUrl || mediaSrc(ctx, props.responsive?.mobile?.background?.mediaId);
  const bg = desktopBg || tabletBg || mobileBg;

  const bgVideo = props.background?.videoUrl;
  const videoPoster = mediaSrc(ctx, props.background?.videoPosterId);
  const customStyle = bricksElementStyle(props, { defaultWidth: "100%", defaultDisplay: "flex" });

  const hasExplicitBg = Boolean(bg || bgVideo || props.background?.color);
  const hasCustomTone = props.tone && props.tone !== "default";

  return (
    <div
      className={cx(
        "bsb brxe-container brx-resp",
        !hasExplicitBg && hasCustomTone && `bsb-tone-${props.tone}`,
        props.paddingY && props.paddingY !== "none" && `bsb-py-${props.paddingY}`,
        props.align && `bsb-align-${props.align}`
      )}
      style={{
        position: "relative",
        zIndex: 1,
        boxSizing: "border-box",
        ...customStyle,
      }}
    >
      {bg ? (
        <picture style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, borderRadius: "inherit", overflow: "hidden" }}>
          {mobileBg && <source media="(max-width: 767px)" srcSet={mobileBg} />}
          {tabletBg && <source media="(max-width: 1023px)" srcSet={tabletBg} />}
          <img
            className="bsb-hero-bg"
            src={desktopBg || tabletBg || mobileBg || ""}
            alt=""
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: (props.background?.imageSize as CSSProperties["objectFit"]) || "cover",
              objectPosition: props.background?.imagePosition || "center center",
              zIndex: 0,
              borderRadius: "inherit",
            }}
          />
        </picture>
      ) : null}
      {bgVideo ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          poster={videoPoster ?? undefined}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: (props.background?.videoFit as CSSProperties["objectFit"]) || "cover",
            objectPosition: props.background?.videoPosition || "center center",
            zIndex: 0,
            borderRadius: "inherit",
          }}
        >
          <source src={bgVideo} />
        </video>
      ) : null}
      <Slot
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: (props.direction ? `var(--b-dir, ${props.direction})` : "var(--b-dir, column)") as CSSProperties["flexDirection"],
          alignItems: (props.alignCrossAxis ? `var(--b-ai, ${props.alignCrossAxis})` : "var(--b-ai, stretch)") as CSSProperties["alignItems"],
          justifyContent: (props.alignMainAxis ? `var(--b-jc, ${props.alignMainAxis})` : "var(--b-jc, flex-start)") as CSSProperties["justifyContent"],
          gap: props.gap ? `var(--b-gap, ${props.gap})` : (props.responsive?.tablet?.gap || props.responsive?.mobile?.gap ? "var(--b-gap)" : undefined),
          rowGap: props.rowGap ? `var(--b-rg, ${props.rowGap})` : (props.responsive?.tablet?.rowGap || props.responsive?.mobile?.rowGap ? "var(--b-rg)" : undefined),
          columnGap: props.colGap ? `var(--b-cg, ${props.colGap})` : (props.responsive?.tablet?.colGap || props.responsive?.mobile?.colGap ? "var(--b-cg)" : undefined),
          flexWrap: (props.flexWrap ? `var(--b-wrap, ${props.flexWrap})` : "var(--b-wrap, nowrap)") as CSSProperties["flexWrap"],
        }}
      >
        {children}
      </Slot>
    </div>
  );
}

export function BlockView({ props, children, ctx }: A<R.BlockProps>): ReactNode {
  const desktopBg = props.background?.imageUrl || mediaSrc(ctx, props.background?.mediaId);
  const tabletBg = props.responsive?.tablet?.background?.imageUrl || mediaSrc(ctx, props.responsive?.tablet?.background?.mediaId);
  const mobileBg = props.responsive?.mobile?.background?.imageUrl || mediaSrc(ctx, props.responsive?.mobile?.background?.mediaId);
  const bg = desktopBg || tabletBg || mobileBg;

  const bgVideo = props.background?.videoUrl;
  const videoPoster = mediaSrc(ctx, props.background?.videoPosterId);
  
  // If custom width is given, use it; otherwise use flex: 1 1 0 with minWidth: 0 so sibling blocks distribute space automatically
  const hasCustomWidth = Boolean(props.sizing?.width);
  const customStyle = bricksElementStyle(props, {
    defaultWidth: hasCustomWidth ? undefined : "auto",
    defaultDisplay: "flex",
  });

  return (
    <div
      className="bsb brxe-block brx-resp"
      style={{
        position: "relative",
        zIndex: 1,
        boxSizing: "border-box",
        flex: hasCustomWidth ? (props.sizing?.width === "100%" ? "1 1 100%" : `0 0 ${props.sizing?.width}`) : "1 1 0",
        minWidth: 0,
        ...customStyle,
      }}
    >
      {bg ? (
        <picture style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, borderRadius: "inherit", overflow: "hidden" }}>
          {mobileBg && <source media="(max-width: 767px)" srcSet={mobileBg} />}
          {tabletBg && <source media="(max-width: 1023px)" srcSet={tabletBg} />}
          <img
            className="bsb-hero-bg"
            src={desktopBg || tabletBg || mobileBg || ""}
            alt=""
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: (props.background?.imageSize as CSSProperties["objectFit"]) || "cover",
              objectPosition: props.background?.imagePosition || "center center",
              zIndex: 0,
              borderRadius: "inherit",
            }}
          />
        </picture>
      ) : null}
      {bgVideo ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          poster={videoPoster ?? undefined}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: (props.background?.videoFit as CSSProperties["objectFit"]) || "cover",
            objectPosition: props.background?.videoPosition || "center center",
            zIndex: 0,
            borderRadius: "inherit",
          }}
        >
          <source src={bgVideo} />
        </video>
      ) : null}
      <Slot
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: (props.direction ? `var(--b-dir, ${props.direction})` : "var(--b-dir, column)") as CSSProperties["flexDirection"],
          alignItems: (props.alignCrossAxis ? `var(--b-ai, ${props.alignCrossAxis})` : "var(--b-ai, stretch)") as CSSProperties["alignItems"],
          justifyContent: (props.alignMainAxis ? `var(--b-jc, ${props.alignMainAxis})` : "var(--b-jc, flex-start)") as CSSProperties["justifyContent"],
          gap: props.gap ? `var(--b-gap, ${props.gap})` : (props.responsive?.tablet?.gap || props.responsive?.mobile?.gap ? "var(--b-gap)" : undefined),
          rowGap: props.rowGap ? `var(--b-rg, ${props.rowGap})` : (props.responsive?.tablet?.rowGap || props.responsive?.mobile?.rowGap ? "var(--b-rg)" : undefined),
          columnGap: props.colGap ? `var(--b-cg, ${props.colGap})` : (props.responsive?.tablet?.colGap || props.responsive?.mobile?.colGap ? "var(--b-cg)" : undefined),
          flexWrap: (props.flexWrap ? `var(--b-wrap, ${props.flexWrap})` : "var(--b-wrap, nowrap)") as CSSProperties["flexWrap"],
        }}
      >
        {children}
      </Slot>
    </div>
  );
}

export function GridView({ props, children }: A<R.GridProps>): ReactNode {
  return (
    <Slot
      className={cx("bsb bsb-grid", `bsb-gap-${props.gap}`)}
      style={{ "--cols": props.columns, "--cols-m": props.columnsMobile } as CSSProperties}
    >
      {children}
    </Slot>
  );
}

export function FlexRowView({ props, children }: A<R.FlexRowProps>): ReactNode {
  return (
    <Slot className={cx("bsb bsb-flex-row", `bsb-gap-${props.gap}`, `bsb-items-${props.alignItems}`, `bsb-justify-${props.justify}`)}>
      {children}
    </Slot>
  );
}

export function FlexColumnView({ props, children }: A<R.FlexColumnProps>): ReactNode {
  return <Slot className={cx("bsb bsb-flex-col", `bsb-gap-${props.gap}`, `bsb-items-${props.alignItems}`)}>{children}</Slot>;
}

export function SpacerView({ props }: A<R.SpacerProps>): ReactNode {
  return <div className={cx("bsb", `bsb-spacer-${props.size}`)} aria-hidden />;
}

export function DividerView({ props }: A<R.DividerProps>): ReactNode {
  return (
    <div className={cx("bsb bsb-w", `bsb-w-${props.width}`)}>
      <hr className="bsb-divider" />
    </div>
  );
}

/* ----------------------------- content ---------------------------- */

export function HeadingView({ props }: A<R.HeadingProps>): ReactNode {
  const Tag = (props.level || "h2") as ElementType;
  const customStyle = bricksElementStyle(props, { defaultWidth: "100%", defaultDisplay: "block" });

  const textDesktop = props.text;
  const textTablet = props.responsive?.tablet?.text;
  const textMobile = props.responsive?.mobile?.text;

  const hasCustomFontSize = Boolean(props.typography?.fontSize);

  const content = (
    <Tag
      className={cx(
        "bsb-heading",
        !hasCustomFontSize && (props.size === "auto" || !props.size ? `bsb-lvl-${props.level}` : `bsb-h-${props.size}`)
      )}
    >
      {textMobile ? <span className="brx-only-mobile">{textMobile}</span> : null}
      {textTablet ? <span className="brx-only-tablet">{textTablet}</span> : null}
      <span className={cx(textMobile && "brx-hide-mobile", textTablet && "brx-hide-tablet")}>
        {textDesktop}
      </span>
    </Tag>
  );

  return (
    <div
      className={cx("bsb brxe-heading brx-resp", `bsb-align-${props.align}`)}
      style={customStyle}
    >
      {props.link ? <a href={props.link} style={{ color: "inherit", textDecoration: "none" }}>{content}</a> : content}
    </div>
  );
}

export function TextView({ props }: A<R.TextProps>): ReactNode {
  const customStyle = bricksElementStyle(props, { defaultWidth: "100%", defaultDisplay: "block" });

  const textDesktop = props.text;
  const textTablet = props.responsive?.tablet?.text;
  const textMobile = props.responsive?.mobile?.text;

  const renderContent = (raw: string) => {
    const html = parseMarkdownToHtml(raw);
    return <div className="bsb-text" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const content = (
    <>
      {textMobile ? <div className="brx-only-mobile">{renderContent(textMobile)}</div> : null}
      {textTablet ? <div className="brx-only-tablet">{renderContent(textTablet)}</div> : null}
      <div className={cx(textMobile && "brx-hide-mobile", textTablet && "brx-hide-tablet")}>
        {renderContent(textDesktop || "")}
      </div>
    </>
  );

  return (
    <div
      className={cx("bsb brxe-text-basic brx-resp", `bsb-align-${props.align}`, props.muted && "bsb-muted")}
      style={customStyle}
    >
      {props.link ? <a href={props.link} style={{ color: "inherit", textDecoration: "none" }}>{content}</a> : content}
    </div>
  );
}

const RATIO_CLASS = { auto: "", square: "bsb-ratio-square", "4-3": "bsb-ratio-4-3", "16-9": "bsb-ratio-16-9" } as const;

export function ImageView({ props, ctx }: A<R.ImageProps>): ReactNode {
  const customStyle = bricksElementStyle(props, { defaultWidth: "100%", defaultDisplay: "block" });

  const desktopDetail = props.mediaId ? ctx?.mediaDetails?.(props.mediaId) : null;
  const desktopSrc = desktopDetail?.url ?? (props.mediaId ? mediaSrc(ctx, props.mediaId) : props.imageUrl);

  const tabletMediaId = props.responsive?.tablet?.mediaId;
  const tabletImageUrl = props.responsive?.tablet?.imageUrl;
  const tabletDetail = tabletMediaId ? ctx?.mediaDetails?.(tabletMediaId) : null;
  const tabletSrc = tabletDetail?.url ?? (tabletMediaId ? mediaSrc(ctx, tabletMediaId) : tabletImageUrl);

  const mobileMediaId = props.responsive?.mobile?.mediaId;
  const mobileImageUrl = props.responsive?.mobile?.imageUrl;
  const mobileDetail = mobileMediaId ? ctx?.mediaDetails?.(mobileMediaId) : null;
  const mobileSrc = mobileDetail?.url ?? (mobileMediaId ? mediaSrc(ctx, mobileMediaId) : mobileImageUrl);

  const activeSrc = desktopSrc || tabletSrc || mobileSrc;
  if (!activeSrc) return <div className="bsb bsb-placeholder">Add an image</div>;

  const detail = desktopDetail || tabletDetail || mobileDetail;
  const imgInfo = mediaImage(
    detail
      ? {
          url: activeSrc,
          width: detail.width,
          height: detail.height,
          focalX: detail.focalX,
          focalY: detail.focalY,
          dominantColor: detail.dominantColor,
          derivatives: detail.derivatives,
        }
      : { url: activeSrc },
    { sizes: "(max-width: 768px) 100vw, 800px" },
  );

  const altText = props.alt && props.alt.trim().length > 0 ? props.alt : (detail?.alt ?? "");
  const objectPos = props.objectPosition || imgInfo.objectPosition || "center center";
  const objectFitStyle = props.objectFit || "cover";

  const rawImg = (
    <img
      className={cx("bsb-img", RATIO_CLASS[(props.ratio || "auto") as keyof typeof RATIO_CLASS], props.rounded && "bsb-rounded")}
      src={desktopSrc || activeSrc}
      srcSet={desktopSrc ? imgInfo.srcSet : undefined}
      sizes={imgInfo.sizes}
      alt={altText}
      loading="lazy"
      style={{
        objectFit: objectFitStyle as CSSProperties["objectFit"],
        objectPosition: objectPos,
        backgroundColor: imgInfo.dominantColor ?? undefined,
        width: "100%",
        height: "100%",
        borderRadius: "inherit",
      }}
    />
  );

  const renderedImage = (tabletSrc || mobileSrc) ? (
    <picture>
      {mobileSrc ? <source media="(max-width: 767px)" srcSet={mobileSrc} /> : null}
      {tabletSrc ? <source media="(max-width: 1023px)" srcSet={tabletSrc} /> : null}
      {rawImg}
    </picture>
  ) : rawImg;

  return (
    <figure className="bsb brxe-image brx-resp" style={{ margin: 0, ...customStyle }}>
      {props.href ? <a href={props.href}>{renderedImage}</a> : renderedImage}
    </figure>
  );
}

function embed(url: string): { kind: "iframe" | "video"; src: string } | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get("v"))
      return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${u.searchParams.get("v")}` };
    if (u.hostname === "youtu.be") return { kind: "iframe", src: `https://youtube-nocookie.com/embed${u.pathname}` };
    if (u.hostname === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video${u.pathname}` };
    if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: "video", src: url };
  } catch {
    /* invalid URL: placeholder below */
  }
  return null;
}

export function VideoView({ props, ctx }: A<R.VideoProps>): ReactNode {
  const customStyle = bricksElementStyle(props, { defaultWidth: "100%", defaultDisplay: "block" });

  const desktopMediaUrl = props.mediaId ? mediaSrc(ctx, props.mediaId) : null;
  const tabletMediaUrl = props.responsive?.tablet?.mediaId ? mediaSrc(ctx, props.responsive.tablet.mediaId) : null;
  const mobileMediaUrl = props.responsive?.mobile?.mediaId ? mediaSrc(ctx, props.responsive.mobile.mediaId) : null;

  const posterUrl = props.posterMediaId ? mediaSrc(ctx, props.posterMediaId) : null;
  const showControls = props.controls !== false && !props.autoplayLoop;
  const videoFit = (props.objectFit || "cover") as CSSProperties["objectFit"];
  const videoPos = props.objectPosition || "center center";

  if (props.mediaId || tabletMediaUrl || mobileMediaUrl) {
    const activeUrl = desktopMediaUrl || tabletMediaUrl || mobileMediaUrl;
    if (!activeUrl) {
      return <div className="bsb bsb-placeholder">Video not found</div>;
    }
    return (
      <div className="bsb brxe-video brx-resp" style={customStyle}>
        <video
          className="bsb-video"
          poster={posterUrl ?? undefined}
          controls={showControls}
          autoPlay={props.autoplayLoop}
          loop={props.autoplayLoop}
          muted={props.autoplayLoop}
          playsInline
          preload="none"
          style={{ width: "100%", height: "100%", objectFit: videoFit, objectPosition: videoPos, borderRadius: "inherit" }}
        >
          {mobileMediaUrl ? <source media="(max-width: 767px)" src={mobileMediaUrl} /> : null}
          {tabletMediaUrl ? <source media="(max-width: 1023px)" src={tabletMediaUrl} /> : null}
          {desktopMediaUrl ? <source src={desktopMediaUrl} /> : null}
        </video>
      </div>
    );
  }

  const desktopUrl = props.url;
  const tabletUrl = props.responsive?.tablet?.videoUrl;
  const mobileUrl = props.responsive?.mobile?.videoUrl;
  const activeExternalUrl = desktopUrl || tabletUrl || mobileUrl;

  const e = activeExternalUrl ? embed(activeExternalUrl) : null;
  if (!e) return <div className="bsb bsb-placeholder">Add a video from media or a link</div>;

  const renderSingleVideoOrIframe = (embedData: { kind: "iframe" | "video"; src: string }) => {
    return embedData.kind === "video" ? (
      <video
        className="bsb-video"
        src={embedData.src}
        poster={posterUrl ?? undefined}
        controls={showControls}
        autoPlay={props.autoplayLoop}
        loop={props.autoplayLoop}
        muted={props.autoplayLoop}
        preload="none"
        playsInline
        style={{ width: "100%", height: "100%", objectFit: videoFit, objectPosition: videoPos, borderRadius: "inherit" }}
      />
    ) : (
      <iframe
        className="bsb-video"
        src={embedData.src}
        loading="lazy"
        allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        style={{ width: "100%", height: "100%", objectFit: videoFit, border: 0, borderRadius: "inherit" }}
      />
    );
  };

  const mobileEmbed = mobileUrl ? embed(mobileUrl) : null;
  const tabletEmbed = tabletUrl ? embed(tabletUrl) : null;

  return (
    <div className="bsb brxe-video brx-resp" style={customStyle}>
      {mobileEmbed ? (
        <div className="brx-only-mobile" style={{ width: "100%", height: "100%" }}>
          {renderSingleVideoOrIframe(mobileEmbed)}
        </div>
      ) : null}
      {tabletEmbed ? (
        <div className="brx-only-tablet" style={{ width: "100%", height: "100%" }}>
          {renderSingleVideoOrIframe(tabletEmbed)}
        </div>
      ) : null}
      <div className={cx(mobileEmbed && "brx-hide-mobile", tabletEmbed && "brx-hide-tablet")} style={{ width: "100%", height: "100%" }}>
        {renderSingleVideoOrIframe(e)}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMimeLabel(mime: string, filename?: string): string {
  if (mime === "application/pdf" || filename?.endsWith(".pdf")) return "PDF";
  if (mime.includes("word") || filename?.endsWith(".docx") || filename?.endsWith(".doc")) return "DOC";
  if (mime.includes("sheet") || mime.includes("excel") || filename?.endsWith(".xlsx") || filename?.endsWith(".csv")) return "SHEET";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed")) return "ZIP";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  return "FILE";
}

export function FileDownloadView({ props, ctx }: A<R.FileDownloadProps>): ReactNode {
  const fileUrl = props.mediaId ? mediaSrc(ctx, props.mediaId) : null;
  const blockData = ctx?.blockId && ctx.data ? ctx.data[ctx.blockId] : undefined;
  const fileData = blockData && blockData.kind === "file" ? blockData : undefined;
  const mediaDetails = props.mediaId && ctx?.mediaDetails ? ctx.mediaDetails(props.mediaId) : undefined;

  if (!props.mediaId) {
    return <div className="bsb bsb-placeholder">Select a file to download</div>;
  }

  const downloadUrl = props.mediaId ? `/media/${props.mediaId}/download` : (fileUrl || fileData?.url || mediaDetails?.url);
  const filename = fileData?.filename || mediaDetails?.filename || "download";
  const mime = fileData?.mime || mediaDetails?.mime || "application/octet-stream";
  const bytes = fileData?.bytes ?? mediaDetails?.bytes;
  const typeLabel = formatMimeLabel(mime, filename);
  const sizeLabel = typeof bytes === "number" ? formatFileSize(bytes) : undefined;
  const metaText = [typeLabel, sizeLabel].filter(Boolean).join(", ");
  const ariaLabel = `${props.label}${sizeLabel ? ` (${sizeLabel})` : ""}`;

  return (
    <div className="bsb">
      <a
        className="bsb-file-download"
        href={downloadUrl ?? "#"}
        download={filename}
        aria-label={ariaLabel}
      >
        <div className="bsb-file-download-content">
          <div className="bsb-file-download-icon" aria-hidden="true">
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>{typeLabel}</span>
          </div>
          <div className="bsb-file-download-info">
            <span className="bsb-file-download-label">{props.label}</span>
            {props.description ? <span className="bsb-file-download-desc">{props.description}</span> : null}
            <span className="bsb-file-download-meta">
              {filename} {metaText ? `• ${metaText}` : ""}
            </span>
          </div>
        </div>
        <div className="bsb-file-download-action" aria-hidden="true">
          <span>Download</span>
          <span style={{ fontSize: "14px" }}>↓</span>
        </div>
      </a>
    </div>
  );
}

export function ButtonView({ props }: A<R.ButtonProps>): ReactNode {
  const styleType = props.styleType || "theme";
  const customStyle = bricksElementStyle(props, { defaultDisplay: "inline-flex" });

  const labelDesktop = props.text || props.label || "Click here";
  const labelTablet = props.responsive?.tablet?.text;
  const labelMobile = props.responsive?.mobile?.text;

  const href = props.link || props.href || "#";
  const target = props.newTab ? "_blank" : undefined;
  const relAttr = props.newTab ? "noopener noreferrer" : undefined;

  const iconName = props.icon && props.icon !== "none" ? props.icon : undefined;
  const iconPos = props.iconPosition || "left";
  const iconGap = props.iconGap || "8px";

  // CSS variables for custom colors & icon gap
  const btnStyle: CSSProperties & Record<string, string | undefined> = {};
  if (props.buttonColor) btnStyle["--brx-btn-bg"] = props.buttonColor;
  if (props.textColor) btnStyle["--brx-btn-tc"] = props.textColor;
  if (props.hoverButtonColor) btnStyle["--brx-btn-hbg"] = props.hoverButtonColor;
  if (props.hoverTextColor) btnStyle["--brx-btn-htc"] = props.hoverTextColor;
  if (iconGap) btnStyle["--brx-btn-gap"] = iconGap;

  const iconEl = iconName ? (
    <span className="brxe-button-icon" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <SvgIcon name={iconName} px={18} />
    </span>
  ) : null;

  const labelEl = (
    <span className="brxe-button-text">
      {labelMobile ? <span className="brx-only-mobile">{labelMobile}</span> : null}
      {labelTablet ? <span className="brx-only-tablet">{labelTablet}</span> : null}
      <span className={cx(labelMobile && "brx-hide-mobile", labelTablet && "brx-hide-tablet")}>
        {labelDesktop}
      </span>
    </span>
  );

  return (
    <div
      className={cx("bsb brxe-button brx-resp", `bsb-align-${props.align}`, props.fullWidth && "brx-btn-full")}
      style={customStyle}
    >
      <a
        href={href}
        target={target}
        rel={relAttr}
        className={cx(
          "bsb-btn",
          styleType === "theme" && `bsb-btn-${props.variant || "primary"}`,
          styleType === "normal" && "brx-btn-normal",
          styleType === "line" && "brx-btn-line",
          styleType === "text" && "brx-btn-text",
          props.size !== "auto" && `bsb-btn-${props.size}`,
          props.fullWidth && "bsb-btn-block"
        )}
        style={btnStyle}
      >
        {iconPos === "left" && iconEl}
        {labelEl}
        {iconPos === "right" && iconEl}
      </a>
    </div>
  );
}

const ICON_PX = { sm: 20, md: 32, lg: 48 } as const;

export function IconView({ props }: A<R.IconProps>): ReactNode {
  return (
    <div className={cx("bsb", `bsb-align-${props.align}`)}>
      <span className="bsb-icon"><SvgIcon name={props.name} px={ICON_PX[props.size]} /></span>
    </div>
  );
}

export function LinkView({ props }: A<R.LinkProps>): ReactNode {
  return (
    <a
      className="bsb bsb-link"
      href={props.href}
      target={props.newTab ? "_blank" : undefined}
      rel={rel(props.href, props.newTab)}
    >
      {props.label}
    </a>
  );
}

export function CallToActionView({ props, ctx }: A<R.CallToActionProps>): ReactNode {
  const bg = mediaSrc(ctx, props.backgroundMediaId);
  return (
    <section className={cx("bsb bs-block-call-to-action bsb-py-xl", !bg && `bsb-tone-${props.tone}`, bg && "bsb-on-media", `bsb-align-${props.align}`)} style={{ position: "relative", overflow: "hidden", color: bg ? "#fff" : undefined }}>
      {bg ? (
        <>
          <img className="bsb-hero-bg" src={bg} alt="" loading="lazy" />
          <div className="bsb-hero-scrim" style={{ opacity: props.overlayOpacity / 100 }} />
        </>
      ) : null}
      <div className="bsb-w bsb-w-default" style={{ position: "relative" }}>
        <h2 className="bsb-heading bsb-h-lg">{props.heading}</h2>
        {props.text ? <p style={{ fontSize: "1.0625rem", lineHeight: 1.6, margin: "0.9rem 0 0", opacity: 0.92 }}>{props.text}</p> : null}
        {props.primaryLabel || props.secondaryLabel ? (
          <div style={{ marginTop: "1.75rem", display: "flex", justifyContent: props.align === "center" ? "center" : "flex-start" }}>
            <Actions>
              {props.primaryLabel ? (
                <a href={props.primaryHref || "#"} className="bsb-btn bsb-btn-primary bsb-btn-lg">{props.primaryLabel}</a>
              ) : null}
              {props.secondaryLabel ? (
                <a href={props.secondaryHref || "#"} className="bsb-btn bsb-btn-outline bsb-btn-lg">{props.secondaryLabel}</a>
              ) : null}
            </Actions>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------- store chrome and page cores ------------------- */

function NavLink({ ctx, href, className, children }: { ctx: RenderContext | undefined; href: string; className?: string; children: ReactNode }) {
  if (ctx?.renderLink) return <>{ctx.renderLink({ href, ...(className ? { className } : {}), children })}</>;
  return (
    <a href={href} className={className} {...(isExternal(href) ? { rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

const SearchIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const CartIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

export function SiteHeaderView({ props, ctx }: A<R.SiteHeaderProps>): ReactNode {
  const name = props.logoText || ctx?.storeName || "Your store";
  const customLogoUrl = mediaSrc(ctx, props.logoMediaId);
  const logoUrl = customLogoUrl || (!props.logoText ? ctx?.logoUrl : null);

  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  const menuData = d && d.kind === "menu" ? d.items : undefined;
  const hasResolvedMenu = Array.isArray(menuData) && menuData.length > 0;

  return (
    <header className={cx("bsb bs-block-site-header bsb-site-header", `bsb-tone-${props.tone}`, props.sticky && "bsb-sticky", props.layout === "center" && "bsb-site-header-center", `bsb-hl-${props.layout}`)}>
      <div className="bsb-w bsb-w-wide bsb-site-header-row">
        {hasResolvedMenu ? (
          <MobileMenu>
            <div>
              <nav className="bsb-mobile-nav" aria-label="Mobile Navigation">
                <ul className="bsb-mobile-list">
                  {menuData.map((item) => (
                    <li key={item.id} className="bsb-mobile-item">
                      {item.children && item.children.length > 0 ? (
                        <details className="bsb-mobile-accordion">
                          <summary className="bsb-mobile-accordion-header">
                            <span>{item.label}</span>
                            <svg className="bsb-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </summary>
                          <div className="bsb-mobile-sublist">
                            <NavLink ctx={ctx} href={item.url} className="bsb-mobile-link bsb-mobile-parent-link">
                              All {item.label}
                            </NavLink>
                            {item.children.map((child) => (
                              <div key={child.id} className="bsb-mobile-subitem">
                                {child.children && child.children.length > 0 ? (
                                  <details className="bsb-mobile-accordion bsb-mobile-subaccordion">
                                    <summary className="bsb-mobile-accordion-header">
                                      <span>{child.label}</span>
                                      <svg className="bsb-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="m6 9 6 6 6-6" />
                                      </svg>
                                    </summary>
                                    <div className="bsb-mobile-subsublist">
                                      <NavLink ctx={ctx} href={child.url} className="bsb-mobile-link bsb-mobile-parent-link">
                                        All {child.label}
                                      </NavLink>
                                      {child.children.map((sub) => (
                                        <NavLink key={sub.id} ctx={ctx} href={sub.url} className="bsb-mobile-link">
                                          {sub.label}
                                        </NavLink>
                                      ))}
                                    </div>
                                  </details>
                                ) : (
                                  <NavLink ctx={ctx} href={child.url} className="bsb-mobile-link">
                                    {child.label}
                                  </NavLink>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <NavLink ctx={ctx} href={item.url} className="bsb-mobile-link">
                          {item.label}
                        </NavLink>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </MobileMenu>
        ) : null}
        <NavLink ctx={ctx} href="/" className="bsb-site-logo">
          {logoUrl ? <img className="bsb-logo-img" src={logoUrl} alt={name} style={logoSizeStyle(props.logoSize)} /> : <span>{name}</span>}
        </NavLink>
        <nav className="bsb-site-nav" aria-label="Main">
          {hasResolvedMenu ? (
            menuData.map((item) =>
              item.children && item.children.length > 0 ? (
                <div key={item.id} className="bsb-nav-item bsb-has-dropdown">
                  <NavLink ctx={ctx} href={item.url} className="bsb-nav-link">
                    <span>{item.label}</span>
                    <svg className="bsb-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </NavLink>
                  <div className="bsb-dropdown-menu">
                    <ul className="bsb-dropdown-list">
                      {item.children.map((child) => (
                        <li key={child.id} className="bsb-dropdown-item">
                          <NavLink ctx={ctx} href={child.url} className="bsb-dropdown-link">
                            {child.label}
                          </NavLink>
                          {child.children && child.children.length > 0 ? (
                            <ul className="bsb-dropdown-sublist">
                              {child.children.map((sub) => (
                                <li key={sub.id} className="bsb-dropdown-subitem">
                                  <NavLink ctx={ctx} href={sub.url} className="bsb-dropdown-sublink">
                                    {sub.label}
                                  </NavLink>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <NavLink key={item.id} ctx={ctx} href={item.url} className="bsb-nav-link">
                  {item.label}
                </NavLink>
              ),
            )
          ) : (
            props.links.map((l, i) => (
              <NavLink key={`${l.href}-${i}`} ctx={ctx} href={l.href}>
                {l.label}
              </NavLink>
            ))
          )}
        </nav>
        <div className="bsb-site-actions">
          {props.showSearch ? (
            <NavLink ctx={ctx} href="/search" className="bsb-site-icon bsb-site-search">
              <span className="bsb-sr">Search</span>
              {SearchIcon}
            </NavLink>
          ) : null}
          {props.showAccount ? (
            ctx?.renderAccount ? (
              ctx.renderAccount()
            ) : (
              <NavLink ctx={ctx} href="/account" className="bsb-site-icon">
                <span className="bsb-sr">Account</span>
                {UserIcon}
              </NavLink>
            )
          ) : ctx?.renderAccount ? (
            // Phones always show the account pill; a header that turned the account icon off keeps it off on larger screens.
            <span className="bsb-phone-only">{ctx.renderAccount()}</span>
          ) : null}
          {props.showCart ? (
            ctx?.renderCart ? (
              ctx.renderCart()
            ) : (
              <NavLink ctx={ctx} href="/cart" className="bsb-site-icon">
                <span className="bsb-sr">Cart</span>
                {CartIcon}
              </NavLink>
            )
          ) : null}
        </div>
      </div>
    </header>
  );
}

const SOCIAL_PATHS: Record<R.SocialNetwork, ReactNode> = {
  instagram: (
    <>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </>
  ),
  facebook: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  x: <path d="M4 4l16 16M20 4L4 20" />,
  youtube: (
    <>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </>
  ),
  linkedin: (
    <>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </>
  ),
  whatsapp: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  email: (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
};
const SOCIAL_LABELS: Record<R.SocialNetwork, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", linkedin: "LinkedIn", whatsapp: "WhatsApp", email: "Email", website: "Website" };

function FooterSocials({ props }: { props: R.SiteFooterProps }): ReactNode {
  const socials = props.socials.filter((s) => s.url.replace(/^https?:\/\//i, "").trim() !== "");
  if (socials.length === 0) return null;
  const size = props.socialSize;
  return (
    <ul className={cx("bsb-socials", `bsb-socials-${props.socialStyle}`, `bsb-socials-c-${props.socialColor}`)} style={{ "--soc": `${size}px` } as CSSProperties}>
      {socials.map((s, i) => (
        <li key={`${s.network}-${i}`}>
          <a href={s.url} className="bsb-social" aria-label={SOCIAL_LABELS[s.network]} {...(isExternal(s.url) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {SOCIAL_PATHS[s.network]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooterView({ props, ctx }: A<R.SiteFooterProps>): ReactNode {
  const name = props.logoText || ctx?.storeName || "Your store";
  const logoUrl = mediaSrc(ctx, props.logoMediaId);
  const year = new Date().getFullYear();

  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  const footerMenus = d && d.kind === "footer-menus" ? d.columns : undefined;

  const columns = props.columns.map((c, i) => {
    const menuCol = footerMenus ? footerMenus[i] : null;
    const links = menuCol && menuCol.length > 0 ? menuCol.map((item) => ({ label: item.label, href: item.url })) : c.links;
    return { key: `${c.title}-${i}`, title: c.title, links };
  });
  const linkList = (links: Array<{ label: string; href: string }>) => (
    <ul className="bsb-site-footer-links">
      {links.map((l, j) => (
        <li key={`${l.href}-${j}`}>
          <NavLink ctx={ctx} href={l.href}>
            {l.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
  const brand = (
    <div className="bsb-site-footer-brand">
      {logoUrl ? <img className="bsb-logo-img" src={logoUrl} alt={name} style={logoSizeStyle(props.logoSize)} /> : <p className="bsb-heading bsb-h-sm">{name}</p>}
      {props.about ? <p className="bsb-muted" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>{props.about}</p> : null}
      <FooterSocials props={props} />
    </div>
  );
  // Wide screens show every column open. With the accordion on, phones get the same links as one folded section per
  // column (a second copy in the markup, swapped by CSS), so a long menu never pushes the page far down.
  const columnBlocks = columns.map((c) => (
    <div key={c.key} className="bsb-site-footer-col">
      <div className="bsb-site-footer-open">
        <p className="bsb-site-footer-title">{c.title}</p>
        {linkList(c.links)}
      </div>
      {props.mobileAccordion ? (
        <details className="bsb-site-footer-fold">
          <summary className="bsb-site-footer-title">
            <span>{c.title}</span>
            <svg className="bsb-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          {linkList(c.links)}
        </details>
      ) : null}
    </div>
  ));
  const newsletter = props.showNewsletter ? (
    <div className="bsb-site-footer-news">
      <p className="bsb-site-footer-title">{props.newsletterTitle}</p>
      <p className="bsb-muted" style={{ fontSize: "0.8125rem", margin: "0.5rem 0 0.75rem" }}>{props.newsletterText}</p>
      <form className="bsb-form" action="/api/storefront/newsletter/subscribe" method="post" style={{ margin: 0 }}>
        <input className="bsb-input" type="email" name="email" required placeholder="Your email" aria-label="Email address" />
        <button className="bsb-btn bsb-btn-primary bsb-btn-sm" type="submit">Subscribe</button>
      </form>
    </div>
  ) : null;

  return (
    <footer className={cx("bsb bs-block-site-footer", `bsb-tone-${props.tone}`, `bsb-fl-${props.layout}`, props.mobileAccordion && "bsb-fl-accordion")}>
      <div className="bsb-w bsb-w-wide bsb-py-lg">
        {props.layout === "columns" ? (
          <div className="bsb-site-footer-grid">
            {brand}
            {columnBlocks}
            {newsletter}
          </div>
        ) : (
          <div className="bsb-site-footer-stack">
            {brand}
            <div className="bsb-site-footer-row">{columnBlocks}</div>
            {newsletter}
          </div>
        )}
        <p className="bsb-muted bsb-align-center" style={{ marginTop: "2.5rem", fontSize: "0.75rem" }}>
          {props.copyright || `© ${year} ${name}. All rights reserved.`}
        </p>
      </div>
    </footer>
  );
}

function Placeholder({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <section className="bsb bs-block-placeholder bsb-py-lg">
      <div className="bsb-w bsb-w-wide">
        {children}
        <p className="bsb-muted bsb-align-center" style={{ fontSize: "0.75rem", marginTop: "1rem" }}>
          <strong>{label}</strong> · {hint}
        </p>
      </div>
    </section>
  );
}

export function ProductInfoTabsView({ props, ctx }: A<R.ProductInfoTabsProps>): ReactNode {
  if (ctx?.renderProductInfoTabs) return <>{ctx.renderProductInfoTabs(props as ProductInfoTabsOptions)}</>;
  return (
    <Placeholder label="Product details tabs" hint="The product's description and the shipping and returns text appear here, beside a picture.">
      <div className="bsb-ph-box" style={{ height: 120 }}>
        <span>
          {props.descriptionLabel} · {props.shippingLabel}
        </span>
      </div>
    </Placeholder>
  );
}

export function ProductCustomFieldView({ props, ctx }: A<R.ProductCustomFieldProps>): ReactNode {
  if (ctx?.renderProductCustomField) return <>{ctx.renderProductCustomField(props as ProductCustomFieldOptions)}</>;
  // Editor and theme previews: a labelled sample, since the real value comes from each product.
  return (
    <Placeholder
      label={props.fieldKey ? `Custom field: ${props.fieldKey}` : "Custom field"}
      hint={props.fieldKey ? "Each product shows its own value here. Nothing is drawn when a product has no value." : "Enter the key of one of your custom fields (Settings > Custom fields)."}
    >
      <div className="bsb-ph-box" style={{ height: 64 }}>
        <span>{props.showLabel ? `${props.label || props.fieldKey || "Field name"}: ` : ""}Value from the product</span>
      </div>
    </Placeholder>
  );
}

export function ProductDetailView({ props, ctx }: A<R.ProductDetailProps>): ReactNode {
  if (ctx?.renderProductDetail) return <>{ctx.renderProductDetail(props as ProductDetailOptions)}</>;
  return <ProductDetailSample props={props} ctx={ctx} />;
}

export function CollectionListingView({ props, ctx }: A<R.CollectionListingProps>): ReactNode {
  if (ctx?.renderCollectionListing) return <>{ctx.renderCollectionListing(props as CollectionListingOptions)}</>;
  const cards = Array.from({ length: Number(props.columns) * 2 }, (_, i) => (
    <div key={i}>
      <div className="bsb-ph-box" style={{ aspectRatio: "4 / 5" }} aria-hidden="true" />
      <p style={{ margin: "0.5rem 0 0.15rem", fontWeight: 600 }}>Sample product {i + 1}</p>
      <p className="bsb-muted" style={{ margin: 0 }}>{money(49900 + i * 10000)}</p>
    </div>
  ));
  return (
    <Placeholder label="Collection page" hint="The collection's own products are listed here.">
      <h1 className="bsb-heading bsb-h-lg">Collection name</h1>
      {props.showDescription ? <p className="bsb-muted" style={{ margin: "0.5rem 0 1rem" }}>The collection description appears here.</p> : null}
      {props.showFilters ? <p className="bsb-muted" style={{ fontSize: "0.8125rem", margin: "0 0 1rem" }}>Sort · In stock only</p> : null}
      <div className="bsb-grid bsb-gap-md" style={{ ["--cols" as string]: props.columns, ["--cols-m" as string]: 2 }}>{cards}</div>
    </Placeholder>
  );
}

export function CollectionProductsView({ props, ctx }: A<R.CollectionProductsProps>): ReactNode {
  if (ctx?.renderCollectionListing) return <>{ctx.renderCollectionListing({ ...props, bare: true } as CollectionListingOptions)}</>;
  const cards = Array.from({ length: Number(props.columns) * 2 }, (_, i) => (
    <div key={i}>
      <div className="bsb-ph-box" style={{ aspectRatio: "4 / 5" }} aria-hidden="true" />
      <p style={{ margin: "0.5rem 0 0.15rem", fontWeight: 600 }}>Sample product {i + 1}</p>
      <p className="bsb-muted" style={{ margin: 0 }}>{money(49900 + i * 10000)}</p>
    </div>
  ));
  return (
    <section className={cx("bsb bs-block-collection-products bsb-lay", `bsb-tone-${props.tone}`)} style={layoutStyle(props.box)}>
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        {props.showTitle ? <h1 className="bsb-heading bsb-h-lg">Collection name</h1> : null}
        {props.showDescription ? <p className="bsb-muted" style={{ margin: "0.5rem 0 1rem" }}>The collection's short description appears here.</p> : null}
        {props.showFilters ? <p className="bsb-muted" style={{ fontSize: "0.8125rem", margin: "0 0 1rem" }}>Sort · In stock only</p> : null}
        <div className="bsb-grid bsb-gap-md" style={{ ["--cols" as string]: props.columns, ["--cols-m" as string]: props.columnsMobile }}>{cards}</div>
        {props.showLongDescription ? <p className="bsb-muted" style={{ marginTop: "1.5rem" }}>The collection's long description appears here, below the products.</p> : null}
        <p className="bsb-muted bsb-align-center" style={{ fontSize: "0.75rem", marginTop: "1rem" }}>
          <strong>Collection products</strong> · This collection's own products are listed here on the storefront.
        </p>
      </div>
    </section>
  );
}

export function CartContentsView({ props, ctx }: A<R.CartContentsProps>): ReactNode {
  if (ctx?.renderCartContents) return <>{ctx.renderCartContents(props as CartContentsOptions)}</>;
  const items = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {[1, 2].map((n) => (
        <div key={n} style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <div className="bsb-ph-box" style={{ width: 88, height: 88, flex: "none" }} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Product {n}</p>
            <p className="bsb-muted" style={{ margin: "0.15rem 0 0" }}>Qty 1 · {money(129900)}</p>
          </div>
        </div>
      ))}
    </div>
  );
  const summary = (
    <div className="bsb-ph-box" style={{ display: "block", padding: "1.25rem", textAlign: "left" }}>
      <p style={{ margin: 0, fontWeight: 700 }}>Order summary</p>
      <p className="bsb-muted" style={{ margin: "0.5rem 0" }}>Subtotal {money(259800)}</p>
      {props.showDiscountCode ? <p className="bsb-muted" style={{ margin: "0.25rem 0" }}>Discount code</p> : null}
      <span className="bsb-btn bsb-btn-primary bsb-btn-lg" style={{ justifyContent: "center", marginTop: "0.75rem", display: "flex" }}>{props.checkoutLabel}</span>
      {props.showTrustPoints ? <p className="bsb-muted" style={{ fontSize: "0.75rem", marginTop: "0.75rem" }}>{props.trustPoints.join(" · ")}</p> : null}
      {props.showShippingEstimator ? <p className="bsb-muted" style={{ fontSize: "0.75rem", marginTop: "0.75rem" }}>Shipping estimator</p> : null}
    </div>
  );
  return (
    <Placeholder label="Cart page" hint="The shopper's own cart, totals and checkout button fill this area.">
      <h1 className="bsb-heading bsb-h-lg" style={{ marginBottom: "1rem" }}>{props.heading}</h1>
      <div className="bsb-ph-two">{props.summaryPosition === "left" ? <>{summary}{items}</> : <>{items}{summary}</>}</div>
    </Placeholder>
  );
}

/* ------------------------------ hero slider ----------------------------- */

const SHADE_HEIGHT = { sm: "35%", md: "55%", lg: "80%" } as const;
const BTN_VARIANT = { dark: "bsb-btn-primary", light: "bsb-btn-secondary", outline: "bsb-btn-outline" } as const;

function slideButton(label: string, href: string, variant: keyof typeof BTN_VARIANT, size: string, custom: boolean, which: "p" | "s"): ReactNode {
  if (!label) return null;
  return (
    <a
      className={cx("bsb-btn", BTN_VARIANT[variant], size !== "auto" && `bsb-btn-${size}`, custom && `bsb-hs-custom-${which}`)}
      href={href || "#"}
      rel={rel(href)}
    >
      {label}
    </a>
  );
}

export function HeroSliderView({ props, ctx }: A<R.HeroSliderProps>): ReactNode {
  const n = props.slides.length;
  const editorPreview = !ctx?.renderHeroSlider;
  const style = {
    "--hs-shade-h": SHADE_HEIGHT[props.shadeHeight],
    "--hs-shade-o": props.shade ? props.shadeStrength / 100 : 0,
    "--hs-dim": props.dim / 100,
    ...(props.primaryBg ? { "--hs-p-bg": props.primaryBg } : null),
    ...(props.primaryText ? { "--hs-p-fg": props.primaryText } : null),
    ...(props.secondaryBg ? { "--hs-s-bg": props.secondaryBg } : null),
    ...(props.secondaryText ? { "--hs-s-fg": props.secondaryText } : null),
    ...(props.mobileTextBg ? { "--hs-m-bg": props.mobileTextBg } : null),
    ...(props.mobileTextColor ? { "--hs-m-fg": props.mobileTextColor } : null),
  } as CSSProperties;
  const customP = Boolean(props.primaryBg || props.primaryText);
  const customS = Boolean(props.secondaryBg || props.secondaryText);

  const markup = (
    <div className={cx("bsb-lay", `bsb-hs-wm-${props.widthMode}`, props.slideRadius.enabled && "bsb-hs-rounded", layoutHasAspectRatio(props.box) && "bsb-hs-ar")} style={{ ...layoutStyle(props.box), ...slideRadiusStyle(props.slideRadius) }}>
    <section
      className={cx(
        "bsb bsb-hs",
        `bsb-hs-h-${props.height}`,
        `bsb-hs-layout-${props.layout}`,
        `bsb-hs-align-${props.align}`,
        `bsb-hs-pos-${props.contentPosition}`,
        `bsb-hs-w-${props.contentWidth}`,
        `bsb-hs-m-${props.mobileLayout}`,
      )}
      style={style}
      data-hs=""
      aria-roledescription="carousel"
      aria-label="Featured"
    >
      <div className="bsb-hs-track" data-hs-track="" tabIndex={n > 1 ? 0 : undefined}>
        {props.slides.map((s, i) => {
          const img = mediaSrc(ctx, s.backgroundMediaId);
          const Title = i === 0 ? props.titleTag : "h2";
          return (
            <div key={i} className="bsb-hs-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} data-hs-slide="">
              <div className="bsb-hs-media">
                {img ? (
                  // The first slide is the page's largest paint: load it eagerly and early; the rest wait until they are near.
                  <img src={img} alt="" decoding="async" loading={i === 0 ? "eager" : "lazy"} {...(i === 0 ? { fetchPriority: "high" as const } : null)} />
                ) : null}
                {s.videoUrl ? (
                  <video
                    muted
                    loop
                    playsInline
                    preload={i === 0 ? "metadata" : "none"}
                    {...(img ? { poster: img } : null)}
                    {...(editorPreview && i === 0 ? { autoPlay: true } : null)}
                    data-hs-video=""
                    aria-hidden="true"
                  >
                    <source src={s.videoUrl} />
                  </video>
                ) : null}
              </div>
              <div className="bsb-hs-shade" aria-hidden="true" />
              <div className="bsb-hs-content">
                <div className="bsb-hs-inner">
                  {s.title || s.subtitle ? (
                    <div className="bsb-hs-text">
                      {s.title ? <Title className={cx("bsb-heading", props.titleSize === "xl" ? "bsb-lvl-h1" : "bsb-lvl-h2")}>{s.title}</Title> : null}
                      {s.subtitle ? <p className="bsb-hs-sub">{s.subtitle}</p> : null}
                    </div>
                  ) : null}
                  {s.primaryLabel || s.secondaryLabel ? (
                    <div className="bsb-hs-actions">
                      {slideButton(s.primaryLabel, s.primaryHref, props.primaryStyle, props.buttonSize, customP, "p")}
                      {slideButton(s.secondaryLabel, s.secondaryHref, props.secondaryStyle, props.buttonSize, customS, "s")}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {n > 1 && props.arrows ? (
        <div className={cx("bsb-hs-arrows", `bsb-hs-arrow-${props.arrowStyle}`, `bsb-hs-arrow-${props.arrowSize}`, `bsb-hs-arrow-c-${props.arrowColor}`, props.arrowsOnMobile && "bsb-hs-arrows-m")}>
          <button type="button" className="bsb-hs-arrow bsb-hs-prev" data-hs-prev="" aria-label="Previous slide">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button type="button" className="bsb-hs-arrow bsb-hs-next" data-hs-next="" aria-label="Next slide">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      ) : null}
      {n > 1 && props.dots ? (
        <div className={cx("bsb-hs-dots", props.arrows && !props.dotsDesktop && "bsb-hs-dots-mobile", `bsb-hs-dots-${props.dotsPosition}`, `bsb-hs-dot-${props.dotsStyle}`, `bsb-hs-dots-${props.dotsSize}`, `bsb-hs-dots-c-${props.dotsColor}`)} role="group" aria-label="Choose slide">
          {props.slides.map((_, i) => (
            <button key={i} type="button" className="bsb-hs-dotbtn" data-hs-dot="" aria-label={`Go to slide ${i + 1}`} {...(i === 0 ? { "aria-current": "true" as const } : null)} />
          ))}
        </div>
      ) : null}
    </section>
    </div>
  );

  const behavior = { autoplay: props.autoplay && n > 1, interval: props.interval, loop: props.loop, pauseOnHover: props.pauseOnHover };
  return ctx?.renderHeroSlider ? <>{ctx.renderHeroSlider({ options: behavior, children: markup })}</> : markup;
}

/* --------------------------- product showcase --------------------------- */

/** The logo's size per device as CSS variables (blocks.css picks the set for the screen, a smaller screen inheriting the larger one). */
function logoSizeStyle(size: LogoSize | undefined): CSSProperties {
  const out: Record<string, string> = {};
  const letter = { desktop: "d", tablet: "t", mobile: "m" } as const;
  for (const device of ["desktop", "tablet", "mobile"] as const) {
    const box = size?.[device];
    if (box?.width) out[`--lg-${letter[device]}-w`] = `${box.width}px`;
    if (box?.height) out[`--lg-${letter[device]}-h`] = `${box.height}px`;
  }
  return out as CSSProperties;
}

const UserIcon = (
  <svg viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const BAG_ICON = (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 7h12l1 13H5L6 7z" />
    <path d="M9 7a3 3 0 0 1 6 0" />
  </svg>
);

function ShowcaseCard({ p, props, ctx, eager }: { p: BlockProduct; props: R.ProductShowcaseProps; ctx: RenderContext | undefined; eager: boolean }): ReactNode {
  const img = p.imageUrl ?? mediaSrc(ctx, p.imageMediaId);
  const href = `/products/${p.slug}`;
  const hasCompare = props.showCompareAt && p.compareAtPriceMin !== undefined && p.compareAtPriceMin > p.priceMin;
  const saving = p.compareAtPriceMin && p.compareAtPriceMin > p.priceMin ? Math.round(((p.compareAtPriceMin - p.priceMin) / p.compareAtPriceMin) * 100) : 0;
  const isRange = p.priceMax !== undefined && p.priceMax > p.priceMin;
  const showFrom = props.startsFrom === "always" || (props.startsFrom === "auto" && isRange);
  const badge = props.badge === "category" ? p.categoryName : props.badge === "brand" ? p.brandName : undefined;
  const link = (children: ReactNode, className?: string, label?: string) =>
    ctx?.renderLink ? ctx.renderLink({ href, ...(className ? { className } : {}), children }) : <a href={href} className={className} {...(label ? { "aria-label": label } : null)}>{children}</a>;

  const rows = props.cardOrder
    .filter((c) => c.show)
    .map((c) => {
      if (c.item === "title") {
        return (
          <h3 key="title" className={cx("bsb-psc-title", `bsb-psc-title-${props.titleSize}`, props.titleLines === "2" && "bsb-psc-lines-2")}>
            {link(p.title)}
          </h3>
        );
      }
      if (c.item === "rating") {
        return Number(p.ratingCount) > 0 ? (
          <div key="rating" className="bsb-psc-rating">
            <Stars value={Number(p.ratingAvg ?? 0)} />
            <span className="bsb-psc-rating-num">{Number(p.ratingAvg ?? 0).toFixed(1)}</span>
            <span className="bsb-muted">({p.ratingCount})</span>
          </div>
        ) : null;
      }
      return (
        <div key="price" className={cx("bsb-psc-price", `bsb-psc-price-${props.priceSize}`)}>
          {showFrom ? <span className="bsb-psc-from">Starts from</span> : null}
          <strong>{money(p.priceMin)}</strong>
          {hasCompare ? <s>{money(p.compareAtPriceMin as number)}</s> : null}
        </div>
      );
    });

  return (
    <article className={cx("bsb-psc-card", `bsb-psc-card-${props.cardStyle}`)}>
      <div className={cx("bsb-psc-media", `bsb-psc-ratio-${props.imageRatio}`)}>
        {link(
          <img src={img ?? PLACEHOLDER_IMAGE_URL} alt={img ? (p.imageAlt ?? p.title) : ""} decoding="async" loading={eager ? "eager" : "lazy"} />,
          "bsb-psc-imglink",
          p.title,
        )}
        {props.showSaleBadge && saving > 0 ? <span className="bsb-psc-badge bsb-psc-badge-r">Save {saving}%</span> : null}
        {props.showAddToCart ? (
          <button
            type="button"
            className="bsb-psc-add"
            data-psc-add=""
            data-href={href}
            {...(p.quickAddVariantId ? { "data-variant": p.quickAddVariantId } : null)}
            aria-label={p.quickAddVariantId ? `Add ${p.title} to cart` : `Choose options for ${p.title}`}
          >
            {BAG_ICON}
          </button>
        ) : null}
      </div>
      {rows.length > 0 || badge ? (
        <div className="bsb-psc-info">
          {badge ? <p className="bsb-psc-cat">{badge}</p> : null}
          {rows}
        </div>
      ) : null}
    </article>
  );
}

export function ProductShowcaseView({ props, ctx, }: A<R.ProductShowcaseProps>): ReactNode {
  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  const tabData = d && d.kind === "product-tabs" ? d.tabs : [];
  const tabs = props.tabs;
  const hasTabs = tabs.length > 1;
  const style = { "--psc-d": props.perViewDesktop, "--psc-t": props.perViewTablet, "--psc-m": props.perViewMobile } as CSSProperties;

  const markup = (
    <section className={cx("bsb bsb-psc", `bsb-tone-${props.tone}`, "bsb-lay", `bsb-psc-gap-${props.gap}`)} style={{ ...style, ...layoutStyle(props.box) }} data-psc="" aria-roledescription="carousel" aria-label={props.title || "Products"}>
      <div className="bsb-w bsb-w-wide">
        {props.title || props.subtitle || hasTabs ? (
          <div className={cx("bsb-psc-head", `bsb-psc-head-${props.headerAlign}`)}>
            <div className="bsb-psc-headtext">
              {props.title ? <h2 className="bsb-heading bsb-lvl-h2">{props.title}</h2> : null}
              {props.subtitle ? <p className="bsb-muted">{props.subtitle}</p> : null}
            </div>
            {hasTabs ? (
              <div className={cx("bsb-psc-tabs", `bsb-psc-tabs-${props.tabsStyle}`)} role="tablist" aria-label="Product groups">
                {tabs.map((t, i) => (
                  <button key={i} type="button" role="tab" className="bsb-psc-tab" data-psc-tab="" aria-selected={i === 0} tabIndex={i === 0 ? 0 : -1}>
                    {t.label || (t.source === "collection" ? t.collectionSlug : t.source === "featured" ? "Featured" : "New arrivals") || `Tab ${i + 1}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {tabs.map((_, ti) => {
          const products = tabData[ti]?.products ?? [];
          return (
            <div key={ti} className="bsb-psc-panel" data-psc-panel="" role="tabpanel" {...(ti > 0 ? { hidden: true } : null)}>
              {products.length === 0 ? (
                <p className="bsb-muted">No products to show yet.</p>
              ) : (
                <div className="bsb-psc-viewport">
                  <div className="bsb-psc-track" data-psc-track="" tabIndex={0}>
                    {products.map((p, i) => (
                      <div key={p.id} className="bsb-psc-item" data-psc-item="">
                        <ShowcaseCard p={p} props={props} ctx={ctx} eager={ti === 0 && i < props.perViewDesktop} />
                      </div>
                    ))}
                  </div>
                  {props.arrows ? (
                    <div className={cx("bsb-hs-arrows", "bsb-psc-arrows", `bsb-hs-arrow-${props.arrowStyle}`, `bsb-hs-arrow-${props.arrowSize}`, `bsb-hs-arrow-c-${props.arrowColor}`, props.arrowsOnMobile && "bsb-hs-arrows-m")}>
                      <button type="button" className="bsb-hs-arrow bsb-hs-prev" data-psc-prev="" aria-label="Previous products">
                        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
                      </button>
                      <button type="button" className="bsb-hs-arrow bsb-hs-next" data-psc-next="" aria-label="Next products">
                        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
              {/* The host fills the dots: how many pages there are depends on the screen. */}
              {props.dots ? <div className={cx("bsb-hs-dots", "bsb-psc-dots", props.arrows && !props.dotsDesktop && "bsb-hs-dots-mobile", `bsb-hs-dots-${props.dotsPosition}`, `bsb-hs-dot-${props.dotsStyle}`, `bsb-hs-dots-${props.dotsSize}`, `bsb-hs-dots-c-${props.dotsColor}`)} data-psc-dots="" role="group" aria-label="Choose page" /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );

  const behavior = { tabs: hasTabs, autoplay: props.autoplay, interval: props.interval, loop: props.loop, pauseOnHover: props.pauseOnHover };
  return ctx?.renderProductShowcase ? <>{ctx.renderProductShowcase({ options: behavior, children: markup })}</> : markup;
}
