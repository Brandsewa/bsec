/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs, BlockReview } from "./types.ts";
import type * as R from "./registry.ts";
import { formatBlogDate } from "./views-blog.tsx";

/**
 * Floating reviews widget. Pure view: the reviews come from the server-resolved render data (published product
 * reviews). The list is drawn twice inside one track that slides up by half its height, so the loop has no jump;
 * hovering or focusing the column pauses it, and reduced-motion users get a plain scrollable column.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;

const SAMPLE_REVIEWS: BlockReview[] = [
  { id: "s1", rating: 5, title: "Worth every rupee", body: "Beautifully made and it arrived earlier than promised. I have already ordered a second one as a gift.", reviewerName: "Aarav Sharma", verified: true, productTitle: "Sample product 1", createdAt: "2026-01-15T00:00:00Z" },
  { id: "s2", rating: 5, title: "Exactly as described", body: "The quality is excellent and the packaging was lovely. Customer support answered my question within minutes.", reviewerName: "Meera Iyer", verified: true, productTitle: "Sample product 2", createdAt: "2026-01-10T00:00:00Z" },
  { id: "s3", rating: 4, title: "Very happy", body: "Great value for the price. Would love a few more colour options, but I am very happy with my order.", reviewerName: "Rohan Gupta", verified: false, productTitle: "Sample product 3", createdAt: "2026-01-04T00:00:00Z" },
  { id: "s4", rating: 5, title: "My new favourite", body: "I use it every day. It feels premium and has held up perfectly after weeks of use.", reviewerName: "Isha Verma", verified: true, productTitle: "Sample product 4", createdAt: "2025-12-28T00:00:00Z" },
];

function Stars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="bsb-stars" role="img" aria-label={`${v} out of 5 stars`}>
      {"★".repeat(v)}
      {"☆".repeat(5 - v)}
    </span>
  );
}

const TICK = (
  <svg className="bsb-rm-tick" viewBox="0 0 24 24" width="1em" height="1em" role="img" aria-label="Verified buyer">
    <title>Verified buyer</title>
    <circle cx="12" cy="12" r="11" fill="currentColor" />
    <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function ReviewBody({ r, props, popup }: { r: BlockReview; props: R.ReviewsMarqueeProps; popup: boolean }): ReactNode {
  const meta = [
    props.showProduct && r.productTitle ? `on ${r.productTitle}` : "",
    props.showDate ? formatBlogDate(r.createdAt) : "",
  ].filter(Boolean);
  return (
    <>
      <Stars value={r.rating} />
      {props.showTitle && r.title ? <h3 className="bsb-rm-title">{r.title}</h3> : null}
      <blockquote className={cx("bsb-rm-body", popup && "bsb-rm-body-full")}>{r.body}</blockquote>
      <figcaption className="bsb-rm-who">
        <span className="bsb-rm-avatar" aria-hidden="true">{r.reviewerName.trim().charAt(0).toUpperCase() || "?"}</span>
        <span className="bsb-rm-who-text">
          <span className="bsb-rm-name">
            <strong>{r.reviewerName}</strong>
            {props.showVerified && r.verified ? TICK : null}
          </span>
          {meta.length > 0 ? <span className="bsb-muted bsb-rm-meta">{meta.join(" · ")}</span> : null}
        </span>
      </figcaption>
    </>
  );
}

/** The card is a label for its review's hidden checkbox: ticking it opens the pop-up (no script needed). */
function ReviewCard({ r, props, hidden, uid }: { r: BlockReview; props: R.ReviewsMarqueeProps; hidden: boolean; uid: string }): ReactNode {
  return (
    <label className="bsb-rm-card" htmlFor={uid} {...(hidden ? { "aria-hidden": true } : null)}>
      <figure className="bsb-rm-fig">
        <ReviewBody r={r} props={props} popup={false} />
      </figure>
    </label>
  );
}

function ReviewPopup({ r, props, uid }: { r: BlockReview; props: R.ReviewsMarqueeProps; uid: string }): ReactNode {
  return (
    <div className="bsb-rm-pop">
      <input type="checkbox" id={uid} className="bsb-rm-pop-toggle" aria-label={`Open review by ${r.reviewerName}`} />
      <div className="bsb-rm-pop-layer" role="dialog" aria-label={`Review by ${r.reviewerName}`}>
        <label htmlFor={uid} className="bsb-rm-pop-back" aria-label="Close" />
        <figure className="bsb-rm-pop-card">
          <label htmlFor={uid} className="bsb-rm-pop-x" aria-label="Close">×</label>
          <ReviewBody r={r} props={props} popup />
          {props.showProduct && r.productSlug ? (
            <a className="bsb-link bsb-rm-pop-link" href={`/products/${r.productSlug}`}>View product →</a>
          ) : null}
        </figure>
      </div>
    </div>
  );
}

export function ReviewsMarqueeView({ props, ctx }: A<R.ReviewsMarqueeProps>): ReactNode {
  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  // No data at all means a host with no store (the theme editor): show labelled samples. Real data may be empty.
  const reviews = d && d.kind === "reviews" ? d.reviews : d ? [] : SAMPLE_REVIEWS;
  if (reviews.length === 0 && props.hideWhenEmpty) return null;

  const cols = Number(props.columns);
  // Two columns split the reviews alternately; the second drifts at a slightly different pace so they never line up.
  const lanes: BlockReview[][] = cols === 2 && reviews.length >= 4 ? [reviews.filter((_, i) => i % 2 === 0), reviews.filter((_, i) => i % 2 === 1)] : [reviews];
  const base = props.speed === "fast" ? 22 : props.speed === "medium" ? 36 : 54;

  const uidOf = (r: BlockReview) => `rm-${ctx?.blockId ?? "w"}-${r.id}`;
  const buttons = [
    { label: props.button1Label, href: props.button1Href, cls: "bsb-btn bsb-btn-primary" },
    { label: props.button2Label, href: props.button2Href, cls: "bsb-btn bsb-btn-outline" },
  ].filter((b) => b.href && b.label);
  const head = (
    <div className={cx("bsb-rm-head", `bsb-rm-pos-${props.textPosition}`)}>
      {props.title || props.eyebrow ? (
        <div className="bsb-rm-titleblock">
          {props.eyebrow ? <p className="bsb-rm-eyebrow">{props.eyebrow}</p> : null}
          {props.title ? <h2 className="bsb-heading bsb-h-lg">{props.title}</h2> : null}
        </div>
      ) : null}
      {props.description || buttons.length > 0 ? (
        <div className="bsb-rm-lower">
          {props.description ? <p className="bsb-muted bsb-rm-desc">{props.description}</p> : null}
          {buttons.length > 0 ? (
            <div className="bsb-rm-btns">
              {buttons.map((b) => <a key={b.cls} className={b.cls} href={b.href}>{b.label}</a>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  const wall =
    reviews.length === 0 ? (
      <p className="bsb-muted">No reviews to show yet.</p>
    ) : (
      <div className={cx("bsb-rm-wall", lanes.length === 2 && "bsb-rm-two")} role="region" aria-label="Customer reviews" tabIndex={0}>
        {lanes.map((lane, li) => (
          <div key={li} className="bsb-rm-lane">
            <div className="bsb-rm-track" style={{ "--rm-dur": `${Math.round(base * (1 + li * 0.25) * Math.max(1, lane.length / 4))}s` } as CSSProperties}>
              {lane.map((r) => <ReviewCard key={r.id} r={r} props={props} hidden={false} uid={uidOf(r)} />)}
              {lane.map((r) => <ReviewCard key={`${r.id}-dup`} r={r} props={props} hidden uid={uidOf(r)} />)}
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <section className={cx("bsb bs-block-reviews-marquee bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide">
        <div className={cx("bsb-rm", `bsb-rm-h-${props.height}`, props.textSide === "left" && "bsb-rm-flip")}>
          {wall}
          {head}
          {reviews.map((r) => <ReviewPopup key={r.id} r={r} props={props} uid={uidOf(r)} />)}
        </div>
      </div>
    </section>
  );
}
