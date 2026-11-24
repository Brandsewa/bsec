/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs } from "./types.ts";
import type * as R from "./registry.ts";
import { SvgIcon } from "./svg-icon.tsx";
import { parseMarkdownToHtml } from "./markdown.ts";
import { TabsBehavior } from "./views-tabs-client.tsx";

/**
 * Tabs. One copy of every body: the titles sit in a tablist, and each panel also carries an accordion header that is
 * only visible when the phone layout is "accordion". The server renders the first state (open tab, open first row);
 * `TabsBehavior` only flips data attributes on click, so there is no hydration state to mismatch.
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type A<P> = BlockRenderArgs<P>;

export function TabsSectionView({ props, ctx }: A<R.TabsSectionProps>): ReactNode {
  const uid = `tb-${(ctx?.blockId ?? "w").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const current = Math.min(props.items.length, Math.max(1, props.defaultTab)) - 1;
  const hasHead = Boolean(props.title || props.description);

  const vars: Record<string, string | number> = {
    "--tb-gap": `${props.titleBodyGap}px`,
    "--tb-fs": `${props.titleFontSize}px`,
    "--tb-fw": props.titleWeight,
    "--tb-px": `${props.titlePaddingX}px`,
    "--tb-py": `${props.titlePaddingY}px`,
    "--tb-tgap": `${props.titleGap}px`,
    "--tb-radius": `${props.cardRadius}px`,
    "--tb-icon": `${props.iconSize}px`,
    "--tb-body-py": `${props.bodyPaddingY}px`,
    "--tb-body-px": `${props.bodyPaddingX}px`,
    "--tb-body-bw": `${props.bodyBorderWidth}px`,
    "--tb-body-radius": `${props.bodyRadius}px`,
    "--tb-body-fs": `${props.bodyFontSize}px`,
  };
  if (props.titleColor) vars["--tb-c"] = props.titleColor;
  if (props.titleActiveColor) vars["--tb-c-on"] = props.titleActiveColor;
  if (props.titleBg) vars["--tb-bg"] = props.titleBg;
  if (props.titleActiveBg) vars["--tb-bg-on"] = props.titleActiveBg;
  if (props.titleBorderColor) vars["--tb-bc"] = props.titleBorderColor;
  if (props.bodyBg) vars["--tb-body-bg"] = props.bodyBg;
  if (props.bodyTextColor) vars["--tb-body-c"] = props.bodyTextColor;
  if (props.bodyBorderColor) vars["--tb-body-bc"] = props.bodyBorderColor;

  return (
    <section className={cx("bsb bs-block-tabs bsb-py-lg", `bsb-tone-${props.tone}`)}>
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        {hasHead ? (
          <div className={cx("bsb-tb-head", `bsb-align-${props.headingAlign}`)}>
            {props.title ? <h2 className="bsb-heading bsb-h-lg">{props.title}</h2> : null}
            {props.description ? <p className="bsb-muted">{props.description}</p> : null}
          </div>
        ) : null}
        <TabsBehavior>
          <div
            className={cx(
              "bsb-tb",
              `bsb-tb-pos-${props.tabsPosition}`,
              `bsb-tb-align-${props.tabsAlign}`,
              `bsb-tb-style-${props.titleStyle}`,
              `bsb-tb-icon-${props.iconPosition}`,
              `bsb-tb-mobile-${props.mobileMode}`,
              `bsb-tb-accicon-${props.accordionIcon}`,
              `bsb-align-${props.bodyAlign}`,
            )}
            style={vars as CSSProperties}
            data-tb=""
            data-tb-single={props.accordionSingleOpen ? "" : undefined}
          >
            <div className="bsb-tb-list" role="tablist" aria-orientation={props.tabsPosition === "top" ? "horizontal" : "vertical"}>
              {props.items.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  id={`${uid}-t${i}`}
                  aria-controls={`${uid}-p${i}`}
                  aria-selected={i === current}
                  tabIndex={i === current ? 0 : -1}
                  className="bsb-tb-tab"
                  data-tb-tab=""
                >
                  {it.icon ? <SvgIcon name={it.icon} px={props.iconSize} /> : null}
                  <span>{it.title}</span>
                </button>
              ))}
            </div>
            <div className="bsb-tb-panels">
              {props.items.map((it, i) => (
                <div
                  key={i}
                  className="bsb-tb-item"
                  data-tb-item=""
                  {...(i === current ? { "data-current": "" } : null)}
                  {...(props.accordionOpenFirst && i === 0 ? { "data-open": "" } : null)}
                >
                  <button
                    type="button"
                    className="bsb-tb-acc"
                    aria-expanded={props.accordionOpenFirst && i === 0}
                    aria-controls={`${uid}-p${i}`}
                    data-tb-acc=""
                  >
                    {it.icon ? <SvgIcon name={it.icon} px={props.iconSize} /> : null}
                    <span className="bsb-tb-acc-text">{it.title}</span>
                    <span className="bsb-tb-acc-icon" aria-hidden="true" />
                  </button>
                  <div
                    className="bsb-tb-panel"
                    role="tabpanel"
                    id={`${uid}-p${i}`}
                    aria-labelledby={`${uid}-t${i}`}
                    tabIndex={0}
                  >
                    <div className="bsb-tb-body" dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(it.content) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsBehavior>
      </div>
    </section>
  );
}
