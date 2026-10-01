/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import { sanitizeRichText } from "./sanitize.ts";
import type {
  BlockProduct,
  CollectionListingOptions,
  ProductDetailOptions,
  BlockRenderArgs,
  RenderContext,
  SlotRender,
} from "./types.ts";
import type * as R from "./registry.ts";

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
  const bg = mediaSrc(ctx, props.backgroundMediaId);
  const ctaText = props.ctaText ?? props.buttonText;
  const ctaLink = props.ctaLink ?? props.buttonUrl;
  return (
    <section className={cx("bsb bs-block-hero bsb-hero", !bg && `bsb-tone-${props.tone}`)}>
      {bg ? (
        <>
          <img className="bsb-hero-bg" src={bg} alt="" />
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

export function BannerView({ props }: A<R.BannerProps>): ReactNode {
  return (
    <div className="bsb bs-block-banner bsb-tone-primary bsb-align-center" style={{ padding: "0.6rem 1rem", fontSize: "0.875rem", fontWeight: 500 }}>
      {props.link ? (
        <a href={props.link} style={{ color: "inherit", textDecoration: "underline" }}>
          {props.text}
        </a>
      ) : (
        props.text
      )}
    </div>
  );
}

function defaultCard(p: BlockProduct, o: { showPrice: boolean; showRating: boolean }, ctx?: RenderContext): ReactNode {
  const img = p.imageUrl ?? mediaSrc(ctx, p.imageMediaId);
  return (
    <a className="bsb-card" href={`/products/${p.slug}`}>
      <div className="bsb-card-media">
        {img ? <img src={img} alt={p.imageAlt ?? p.title} loading="lazy" /> : null}
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
            {money(p.priceMin)}
            {p.compareAtPriceMin && p.compareAtPriceMin > p.priceMin ? <s>{money(p.compareAtPriceMin)}</s> : null}
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
        <SectionHead title={props.title} subtitle={props.subtitle} align="center" />
        {collections.length === 0 ? (
          <p className="bsb-muted bsb-align-center">No collections selected yet.</p>
        ) : (
          <div className="bsb-grid bsb-gap-md" style={{ "--cols": Number(props.columns), "--cols-m": 1 } as CSSProperties}>
            {collections.map((c) => {
              const img = mediaSrc(ctx, c.imageMediaId);
              return (
                <a key={c.slug} className="bsb-card" href={`/collections/${c.slug}`}>
                  <div className="bsb-card-media">
                    {img ? <img src={img} alt="" loading="lazy" /> : null}
                  </div>
                  <div className="bsb-card-body">
                    <h3 className="bsb-card-title">{c.title}</h3>
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
  return (
    <section
      className={cx("bsb bs-block-richtext bsb-py-lg bsb-w bsb-w-default bsb-richtext", `bsb-align-${props.alignment}`)}
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
            const src = mediaSrc(ctx, im.mediaId);
            if (!src) return null;
            const img = <img className="bsb-img bsb-ratio-square bsb-rounded" src={src} alt={im.caption ?? ""} loading="lazy" />;
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

const ICON_PATHS: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  truck: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </>
  ),
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </>
  ),
  returns: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  support: <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />,
};
const ICON_ALIASES: Record<string, string> = { shieldcheck: "shield", rotateccw: "returns", headphones: "support" };

function SvgIcon({ name, px }: { name: string; px: number }) {
  const key = name.toLowerCase();
  const path = ICON_PATHS[ICON_ALIASES[key] ?? key];
  if (!path) return null;
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
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
  const bg = mediaSrc(ctx, props.backgroundMediaId);
  return (
    <section className={cx("bsb", !bg && `bsb-tone-${props.tone}`, `bsb-py-${props.paddingY}`)} style={{ position: "relative", overflow: "hidden" }}>
      {bg ? (
        <>
          <img className="bsb-hero-bg" src={bg} alt="" loading="lazy" />
          <div className="bsb-hero-scrim" style={{ opacity: props.overlayOpacity / 100 }} />
        </>
      ) : null}
      <Slot className={cx("bsb-w", `bsb-w-${props.width}`)} style={{ position: "relative" }}>{children}</Slot>
    </section>
  );
}

export function ContainerView({ props, children }: A<R.ContainerProps>): ReactNode {
  return (
    <div className={cx("bsb", `bsb-tone-${props.tone}`, `bsb-py-${props.paddingY}`, `bsb-align-${props.align}`)}>
      <Slot className={cx("bsb-w", `bsb-w-${props.width}`)}>{children}</Slot>
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
  const Tag = props.level;
  return (
    <div className={cx("bsb", `bsb-align-${props.align}`)}>
      <Tag className={cx("bsb-heading", `bsb-h-${props.size}`)}>{props.text}</Tag>
    </div>
  );
}

export function TextView({ props }: A<R.TextProps>): ReactNode {
  return (
    <div className={cx("bsb", `bsb-align-${props.align}`, props.muted && "bsb-muted")}>
      {props.text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="bsb-text" style={{ whiteSpace: "pre-line" }}>{para}</p>
      ))}
    </div>
  );
}

const RATIO_CLASS = { auto: "", square: "bsb-ratio-square", "4-3": "bsb-ratio-4-3", "16-9": "bsb-ratio-16-9" } as const;

export function ImageView({ props, ctx }: A<R.ImageProps>): ReactNode {
  const src = mediaSrc(ctx, props.mediaId);
  if (!src) return <div className="bsb bsb-placeholder">Add an image</div>;
  const img = <img className={cx("bsb-img", RATIO_CLASS[props.ratio], props.rounded && "bsb-rounded")} src={src} alt={props.alt} loading="lazy" />;
  return <div className="bsb">{props.href ? <a href={props.href}>{img}</a> : img}</div>;
}

function embed(url: string): { kind: "iframe" | "video"; src: string } | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get("v"))
      return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${u.searchParams.get("v")}` };
    if (u.hostname === "youtu.be") return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed${u.pathname}` };
    if (u.hostname === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video${u.pathname}` };
    if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: "video", src: url };
  } catch {
    /* invalid URL: placeholder below */
  }
  return null;
}

export function VideoView({ props }: A<R.VideoProps>): ReactNode {
  const e = props.url ? embed(props.url) : null;
  if (!e) return <div className="bsb bsb-placeholder">Add a YouTube, Vimeo or .mp4 link</div>;
  return (
    <div className="bsb">
      {e.kind === "video" ? (
        <video className="bsb-video" src={e.src} controls preload="none" playsInline />
      ) : (
        <iframe className="bsb-video" src={e.src} loading="lazy" allowFullScreen title="Video" referrerPolicy="strict-origin-when-cross-origin" />
      )}
    </div>
  );
}

export function ButtonView({ props }: A<R.ButtonProps>): ReactNode {
  return (
    <div className={cx("bsb", `bsb-align-${props.align}`)}>
      <a
        href={props.href}
        className={cx("bsb-btn", `bsb-btn-${props.variant}`, props.size !== "md" && `bsb-btn-${props.size}`, props.fullWidth && "bsb-btn-block")}
      >
        {props.label}
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
  return (
    <header className={cx("bsb bs-block-site-header bsb-site-header", `bsb-tone-${props.tone}`, props.sticky && "bsb-sticky", props.layout === "center" && "bsb-site-header-center")}>
      <div className="bsb-w bsb-w-wide bsb-site-header-row">
        <NavLink ctx={ctx} href="/" className="bsb-site-logo">
          {ctx?.logoUrl && !props.logoText ? <img src={ctx.logoUrl} alt={name} style={{ maxHeight: 40, width: "auto" }} /> : <span>{name}</span>}
        </NavLink>
        <nav className="bsb-site-nav" aria-label="Main">
          {props.links.map((l, i) => (
            <NavLink key={`${l.href}-${i}`} ctx={ctx} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="bsb-site-actions">
          {props.showSearch ? (
            <NavLink ctx={ctx} href="/search" className="bsb-site-icon">
              <span className="bsb-sr">Search</span>
              {SearchIcon}
            </NavLink>
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

export function SiteFooterView({ props, ctx }: A<R.SiteFooterProps>): ReactNode {
  const name = ctx?.storeName || "Your store";
  const year = new Date().getFullYear();
  return (
    <footer className={cx("bsb bs-block-site-footer", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide bsb-py-lg">
        <div className="bsb-site-footer-grid">
          <div>
            <p className="bsb-heading bsb-h-sm">{name}</p>
            {props.about ? <p className="bsb-muted" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>{props.about}</p> : null}
          </div>
          {props.columns.map((c, i) => (
            <div key={`${c.title}-${i}`}>
              <p className="bsb-site-footer-title">{c.title}</p>
              <ul className="bsb-site-footer-links">
                {c.links.map((l, j) => (
                  <li key={`${l.href}-${j}`}>
                    <NavLink ctx={ctx} href={l.href}>
                      {l.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {props.showNewsletter ? (
            <div>
              <p className="bsb-site-footer-title">{props.newsletterTitle}</p>
              <p className="bsb-muted" style={{ fontSize: "0.8125rem", margin: "0.5rem 0 0.75rem" }}>{props.newsletterText}</p>
              <form className="bsb-form" action="/api/storefront/newsletter/subscribe" method="post" style={{ margin: 0 }}>
                <input className="bsb-input" type="email" name="email" required placeholder="Your email" aria-label="Email address" />
                <button className="bsb-btn bsb-btn-primary bsb-btn-sm" type="submit">Subscribe</button>
              </form>
            </div>
          ) : null}
        </div>
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

export function ProductDetailView({ props, ctx }: A<R.ProductDetailProps>): ReactNode {
  if (ctx?.renderProductDetail) return <>{ctx.renderProductDetail(props as ProductDetailOptions)}</>;
  const gallery = (
    <div className="bsb-ph-box" style={{ aspectRatio: "1 / 1" }} aria-hidden="true">
      <span>Product images</span>
    </div>
  );
  const info = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1 className="bsb-heading bsb-h-lg">Product name</h1>
      {props.showRating ? <Stars value={4} /> : null}
      <p style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>{money(129900)}</p>
      {props.showDescription ? <p className="bsb-muted">A short product description appears here, written by the store for each product.</p> : null}
      <div className="bsb-ph-box" style={{ height: 44 }}><span>Variant options</span></div>
      <span className="bsb-btn bsb-btn-primary bsb-btn-lg" style={{ justifyContent: "center" }}>Add to cart</span>
      {props.showTags ? <p className="bsb-muted" style={{ fontSize: "0.75rem" }}>#tag #another</p> : null}
    </div>
  );
  return (
    <Placeholder label="Product page" hint="Each product's own images, price and options fill this area.">
      {props.showBreadcrumb ? <p className="bsb-muted" style={{ fontSize: "0.8125rem", marginBottom: "1rem" }}>Home / Products / Product name</p> : null}
      <div className="bsb-ph-two">{props.galleryPosition === "left" ? <>{gallery}{info}</> : <>{info}{gallery}</>}</div>
    </Placeholder>
  );
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
