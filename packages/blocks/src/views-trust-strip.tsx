/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import type { BlockRenderArgs } from "./types.ts";
import { SvgIcon } from "./svg-icon.tsx";
import { TRUST_DESKTOP_DEFAULTS, type TrustDeviceStyle, type TrustStripProps } from "./registry.ts";

/**
 * Trust strip: icon, heading and text per item. Every look setting is chosen per device; a tablet or phone value left
 * empty follows the larger screen. The resolved values become CSS variables per device (-d, -t, -m) and the stylesheet
 * picks the set for the screen, so the page needs no script (the slider is plain scroll-snap).
 */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

type Colours = "sectionBg" | "cardBg" | "iconColor" | "headingColor" | "textColor";
type Filled = Omit<TrustDeviceStyle, Colours>;
type Resolved = { [K in keyof Filled]-?: NonNullable<Filled[K]> } & { [K in Colours]?: string | undefined };

/** Drops unset keys so they never overwrite the value inherited from the larger screen. */
function strip<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function resolve(styles: TrustStripProps["styles"]): { d: Resolved; t: Resolved; m: Resolved } {
  const d = { ...TRUST_DESKTOP_DEFAULTS, ...strip(styles.desktop) } as Resolved;
  const t = { ...d, ...strip(styles.tablet) } as Resolved;
  const m = { ...t, ...strip(styles.mobile) } as Resolved;
  return { d, t, m };
}

function deviceVars(r: Resolved, k: "d" | "t" | "m"): Record<string, string> {
  const slider = r.layout === "slider";
  const card = r.look === "card";
  const gap = `${r.gap}px`;
  const centered = r.iconPosition === "top" && r.align === "center";
  return {
    [`--ts-sp-${k}`]: `${r.sectionPad}px`,
    [`--ts-sbg-${k}`]: r.sectionBg ?? "transparent",
    [`--ts-gap-${k}`]: gap,
    [`--ts-cp-${k}`]: `${r.cardPad}px`,
    [`--ts-cb-${k}`]: card ? (r.cardBg ?? "transparent") : "transparent",
    [`--ts-bw-${k}`]: card ? "1px" : "0px",
    [`--ts-rad-${k}`]: card ? `${r.radius}px` : "0px",
    [`--ts-ic-${k}`]: `${r.iconSize}px`,
    [`--ts-hs-${k}`]: `${r.headingSize}px`,
    [`--ts-ts-${k}`]: `${r.textSize}px`,
    [`--ts-fd-${k}`]: r.iconPosition === "left" ? "row" : "column",
    [`--ts-ta-${k}`]: centered ? "center" : "left",
    [`--ts-ai-${k}`]: r.iconPosition === "left" ? { start: "flex-start", center: "center", end: "flex-end" }[r.valign] : centered ? "center" : "flex-start",
    [`--ts-icc-${k}`]: r.iconColor ?? "var(--bs-ic, var(--bs-icon-color-light, var(--p)))",
    [`--ts-hc-${k}`]: r.headingColor ?? "inherit",
    [`--ts-tc-${k}`]: r.textColor ?? "var(--m)",
    // grid: n equal columns. slider: one row of n visible items, scrolling sideways.
    [`--ts-gtc-${k}`]: slider ? "none" : `repeat(${r.perRow}, minmax(0, 1fr))`,
    [`--ts-gaf-${k}`]: slider ? "column" : "row",
    [`--ts-gac-${k}`]: slider ? `calc((100% - ${r.perRow - 1} * ${gap}) / ${r.perRow})` : "auto",
    [`--ts-ox-${k}`]: slider ? "auto" : "visible",
    [`--ts-pb-${k}`]: slider ? "6px" : "0px",
    [`--ts-snap-${k}`]: slider ? "x mandatory" : "none",
  };
}

export function TrustStripView({ props }: BlockRenderArgs<TrustStripProps>): ReactNode {
  const { d, t, m } = resolve(props.styles);
  const vars = { ...deviceVars(d, "d"), ...deviceVars(t, "t"), ...deviceVars(m, "m") } as CSSProperties;
  return (
    <section className="bsb bs-block-trust-strip bsb-ts" style={vars}>
      <div className={cx("bsb-w", `bsb-w-${props.width}`)}>
        <ul className="bsb-ts-list" role="list">
          {props.items.map((it, i) => (
            <li key={i} className="bsb-ts-item">
              <span className="bsb-ts-icon" aria-hidden="true">
                <SvgIcon name={it.icon} px={28} />
              </span>
              <div className="bsb-ts-text">
                {it.title ? <p className="bsb-ts-title">{it.title}</p> : null}
                {it.description ? <p className="bsb-ts-desc">{it.description}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
