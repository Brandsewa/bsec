import { createElement, type CSSProperties, type ReactElement } from "react";
import type { IconNode } from "./generated/data.ts";

export interface IconSvgProps {
  name: string;
  /** Fixed size in px: a widget's own size, which wins over the theme. */
  px?: number | undefined;
  /** Size in px used only when the theme sets none; the icon otherwise follows the theme's icon size (--bs-icon-size). */
  themePx?: number | undefined;
  /** Fixed stroke width; overrides both the weight stored on the name and the theme. */
  strokeWidth?: number | undefined;
  className?: string | undefined;
}

/** The theme's default stroke weight when neither the widget nor the stored name sets one. */
export const THEME_STROKE = "var(--bs-icon-weight, 1.75)";

/** Builds the <svg> from an allowlisted node table entry. React elements only, never raw HTML. */
export function drawIcon(node: IconNode, { px, themePx, strokeWidth, className }: Omit<IconSvgProps, "name">): ReactElement {
  // Inline styles beat the stylesheet, so a widget's own value always wins over the theme's.
  const size = px !== undefined ? `${px}px` : `var(--bs-icon-size, ${themePx ?? 24}px)`;
  const style: CSSProperties = { width: size, height: size, strokeWidth: strokeWidth ?? THEME_STROKE };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden>
      {node.map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
}
