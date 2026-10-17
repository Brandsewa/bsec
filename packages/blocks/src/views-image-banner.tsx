/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs } from "./types.ts";
import type * as R from "./registry.ts";
import { mediaImage } from "./media-image.ts";

/**
 * Image banner. Pure view: the picture comes from the media library (`backgroundMediaId`, resolved by the host); the
 * text group is placed with CSS flex on a layer over the picture, so every position is just a pair of classes.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;

export function ImageBannerView({ props, ctx }: A<R.ImageBannerProps>): ReactNode {
  const detail = props.backgroundMediaId ? ctx?.mediaDetails?.(props.backgroundMediaId) : null;
  const url = detail?.url ?? (props.backgroundMediaId ? (ctx?.mediaUrl?.(props.backgroundMediaId) ?? null) : null);
  const img = url
    ? mediaImage(
        detail
          ? { url, width: detail.width, height: detail.height, focalX: detail.focalX, focalY: detail.focalY, dominantColor: detail.dominantColor, derivatives: detail.derivatives }
          : { url },
        { sizes: "(min-width: 1200px) 1200px, 100vw" },
      )
    : null;
  const buttons = [
    { label: props.button1Label, href: props.button1Href, cls: "bsb-btn bsb-btn-primary" },
    { label: props.button2Label, href: props.button2Href, cls: "bsb-btn bsb-btn-outline" },
  ].filter((b) => b.href && b.label);
  const style = {
    ...(props.eyebrowColor ? { "--ib-eyebrow": props.eyebrowColor } : null),
    ...(props.titleColor ? { "--ib-title": props.titleColor } : null),
    ...(props.textColor ? { "--ib-text": props.textColor } : null),
  } as CSSProperties;
  // "Centre" keeps the picture's own focal point (set in the media library); the others pin the crop to an edge.
  const objectPosition = props.imagePosition === "center" ? img?.objectPosition ?? "center" : props.imagePosition;

  return (
    <section className="bsb bs-block-image-banner bsb-py-lg">
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        <div
          className={cx("bsb-ib", `bsb-ib-h-${props.height}`, `bsb-ib-r-${props.radius}`, `bsb-tone-${props.tone}`, props.italic && "bsb-ib-italic", `bsb-ib-v-${props.contentVertical}`, `bsb-ib-hz-${props.contentAlign}`)}
          style={style}
        >
          {img ? (
            <img className={cx("bsb-ib-bg", `bsb-ib-fit-${props.imageFit}`)} src={img.src} srcSet={img.srcSet} sizes={img.sizes} alt="" style={{ objectPosition }} />
          ) : null}
          {props.overlayOpacity > 0 ? <div className="bsb-ib-scrim" style={{ opacity: props.overlayOpacity / 100 }} /> : null}
          <div className="bsb-ib-layer">
            <div className={cx("bsb-ib-copy", `bsb-ib-w-${props.contentWidth}`, `bsb-align-${props.textAlign}`)}>
              {props.eyebrow ? <p className="bsb-ib-eyebrow">{props.eyebrow}</p> : null}
              {props.title ? <h2 className="bsb-heading bsb-h-lg bsb-ib-title">{props.title}</h2> : null}
              {props.description ? <p className="bsb-ib-desc">{props.description}</p> : null}
              {buttons.length > 0 ? (
                <div className={cx("bsb-ib-btns", `bsb-ib-btns-${props.textAlign}`)}>
                  {buttons.map((b) => (
                    <a key={b.cls} className={b.cls} href={b.href}>
                      {b.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
