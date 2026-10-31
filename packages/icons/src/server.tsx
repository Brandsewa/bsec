import type { ReactElement } from "react";
import { LUCIDE_DATA } from "./generated/data.ts";
import { resolveIconName, strokeOf } from "./index.ts";
import { drawIcon, type IconSvgProps } from "./render.tsx";

/**
 * Draws a Lucide icon as an inline SVG. Server components: this imports the whole icon table (~90 KB gzip), so the
 * package maps the "browser" condition of this entry to ./lazy.tsx and no client bundle ever contains the table.
 * A name that is not in the generated allowlist renders nothing, so stored strings can never become markup.
 */
export function IconSvg({ name, ...rest }: IconSvgProps): ReactElement | null {
  const resolved = resolveIconName(name);
  const node = resolved ? LUCIDE_DATA[resolved] : undefined;
  return node ? drawIcon(node, { ...rest, strokeWidth: rest.strokeWidth ?? strokeOf(name) }) : null;
}
