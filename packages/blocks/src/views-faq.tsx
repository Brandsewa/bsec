/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties as _Css, ReactNode } from "react";
import type { BlockRenderArgs } from "./types.ts";
import type * as R from "./registry.ts";

/**
 * FAQ accordion: native <details> items (no script). The open/close icon is drawn with CSS, so it can sit before or
 * after the question; `singleOpen` uses the shared `name` attribute so the browser closes the others.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;

export function FaqSectionView({ props, ctx }: A<R.FaqSectionProps>): ReactNode {
  const group = props.singleOpen ? `faq-${ctx?.blockId ?? "w"}` : undefined;
  const hasHead = Boolean(props.eyebrow || props.title || props.description);
  const head = hasHead ? (
    <div className={cx("bsb-fq-head", props.layout === "stacked" && `bsb-align-${props.headingAlign}`)}>
      {props.eyebrow ? <p className="bsb-fq-eyebrow">{props.eyebrow}</p> : null}
      {props.title ? <h2 className="bsb-heading bsb-h-lg">{props.title}</h2> : null}
      {props.description ? <p className="bsb-muted">{props.description}</p> : null}
    </div>
  ) : null;
  const list = (
    <div
      className={cx("bsb-fq-list", `bsb-fq-${props.style}`, `bsb-fq-icon-${props.iconPosition}`)}
      style={{ "--fq-icon": `${props.iconSize}px`, "--fq-py": `${props.rowPadding}px` } as _Css}
    >
      {props.items.map((it, i) => (
        <details key={i} className="bsb-fq-item" {...(group ? { name: group } : null)} {...(props.openFirst && i === 0 ? { open: true } : null)}>
          <summary className="bsb-fq-q">
            <span className="bsb-fq-text">{it.question}</span>
            <span className={cx("bsb-fq-icon", `bsb-fq-${props.iconStyle}icon`)} aria-hidden="true" />
          </summary>
          <p className="bsb-fq-a">{it.answer}</p>
        </details>
      ))}
    </div>
  );

  return (
    <section className={cx("bsb bs-block-faq-section bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        {props.layout === "split" ? (
          <div className={cx("bsb-fq", "bsb-fq-split", `bsb-fq-side-${props.textSide}`, `bsb-fq-pos-${props.textPosition}`)}>
            {head}
            {list}
          </div>
        ) : (
          <div className={cx("bsb-fq", "bsb-fq-stacked", props.headingAlign !== "left" && `bsb-align-${props.headingAlign}`)}>
            {head}
            {list}
          </div>
        )}
      </div>
    </section>
  );
}
