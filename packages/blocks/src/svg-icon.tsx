import { IconSvg } from "@bs/icons/server";

/** The block library's icon: any Lucide icon by name (ADR-041), drawn as inline SVG on the server. Unknown names render nothing. */
export function SvgIcon({ name, px, themed = false }: { name: string; px: number; themed?: boolean }) {
  // themed: px is only the fallback and the icon follows the theme's icon size; otherwise px is the widget's own size.
  return themed ? <IconSvg name={name} themePx={px} /> : <IconSvg name={name} px={px} />;
}
