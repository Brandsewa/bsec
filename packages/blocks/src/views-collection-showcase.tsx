/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs, RenderContext } from "./types.ts";
import { PLACEHOLDER_IMAGE_URL } from "./media.ts";
import type * as R from "./registry.ts";

/**
 * Collection showcase: the Collection grid with a movable heading, a button link, more cards per row on desktop
 * (extra collections wrap into more rows) and a carousel option for tablets and phones. Pure CSS, no script.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;
const mediaSrc = (ctx: RenderContext | undefined, id: string | undefined): string | null => (id ? (ctx?.mediaUrl?.(id) ?? null) : null);

export function CollectionShowcaseView({ props, ctx }: A<R.CollectionShowcaseProps>): ReactNode {
  const d = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  const collections = d && d.kind === "collections" ? d.collections : [];
  const hasHead = Boolean(props.title || props.subtitle);
  const button = props.buttonHref && props.buttonLabel ? (
    <a className="bsb-link bsb-cs-btn" href={props.buttonHref}>
      {props.buttonLabel} →
    </a>
  ) : null;
  const vars = {
    "--cols": Number(props.columns),
    "--cols-t": Number(props.columnsTablet),
    "--cols-m": Number(props.columnsMobile),
  } as CSSProperties;

  return (
    <section className={cx("bsb bs-block-collection-showcase bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className="bsb-w bsb-w-wide">
        {hasHead || button ? (
          <div className={cx("bsb-cs-head", `bsb-cs-head-${props.headerAlign}`)}>
            {hasHead ? (
              <div className="bsb-cs-headtext">
                {props.title ? <h2 className="bsb-heading bsb-h-lg">{props.title}</h2> : null}
                {props.subtitle ? <p className="bsb-muted" style={{ margin: "0.4rem 0 0" }}>{props.subtitle}</p> : null}
              </div>
            ) : null}
            {button}
          </div>
        ) : null}
        {collections.length === 0 ? (
          <p className="bsb-muted">{props.source === "categories" ? "No categories selected yet." : "No collections selected yet."}</p>
        ) : (
          <div className={cx("bsb-cs", `bsb-cs-t-${props.tabletLayout}`, `bsb-cs-m-${props.mobileLayout}`)} style={vars} role="list">
            {collections.map((c) => {
              const img = mediaSrc(ctx, c.imageMediaId);
              return (
                <a key={c.slug} className="bsb-ccard bsb-cs-card" href={`/${props.source === "categories" ? "categories" : "collections"}/${c.slug}`} role="listitem">
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
