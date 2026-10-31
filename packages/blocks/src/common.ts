import { isIconName } from "@bs/icons";
import { z } from "zod";

/**
 * Shared prop vocabulary (ADR-010): merchants pick from enumerated options, never raw CSS/HTML.
 * Every enum maps to a class in blocks.css.
 */

// Internal paths, anchors, https URLs, mailto and tel. No javascript:, data:, or protocol-relative.
const SAFE_HREF = /^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i;
export const isSafeHref = (v: string): boolean => v === "" || SAFE_HREF.test(v);

export const hrefSchema = z
  .string()
  .max(2000)
  .refine(isSafeHref, { message: "Link must start with /, #, https://, mailto: or tel:" });

// Video: YouTube, Vimeo or a direct .mp4/.webm on https.
const SAFE_VIDEO =
  /^https:\/\/((www\.)?youtube\.com\/watch\?v=[\w-]{6,20}|youtu\.be\/[\w-]{6,20}|vimeo\.com\/\d+|[^\s]+\.(mp4|webm)(\?[^\s]*)?)$/i;
export const videoUrlSchema = z
  .string()
  .max(2000)
  .refine((v) => v === "" || SAFE_VIDEO.test(v), {
    message: "Use a YouTube, Vimeo or direct .mp4/.webm https link",
  });

// Background video: a direct .mp4 / .webm file on https (YouTube and Vimeo cannot autoplay silently as a background).
const SAFE_BG_VIDEO = /^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i;
export const bgVideoUrlSchema = z
  .string()
  .max(2000)
  .refine((v) => v === "" || SAFE_BG_VIDEO.test(v), { message: "Use a direct .mp4 or .webm https link" });

/** A colour as #rrggbb. Used where a block lets a merchant override a theme colour; never free-form CSS. */
/** Logo width and height in pixels for each device (empty = the theme default: up to 40px tall, natural width). */
const logoBoxSchema = z.object({
  width: z.number().int().min(16).max(600).optional(),
  height: z.number().int().min(12).max(300).optional(),
});
export const logoSizeSchema = z
  .object({ desktop: logoBoxSchema.default({}), tablet: logoBoxSchema.default({}), mobile: logoBoxSchema.default({}) })
  .default({ desktop: {}, tablet: {}, mobile: {} });
export type LogoSize = z.infer<typeof logoSizeSchema>;

/** An external image link. https only: no javascript:, data: or plain http (mixed content, ADR-010). */
export const httpsImageUrlSchema = z
  .string()
  .max(2000)
  .refine((v) => /^https:\/\/[^\s]+$/i.test(v), { message: "Use an https:// image link" });

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1f3a5f");

export const alignSchema = z.enum(["left", "center", "right"]);
export const toneSchema = z.enum(["default", "surface", "primary", "dark"]);
export const spacingSchema = z.enum(["none", "sm", "md", "lg", "xl"]);
export const gapSchema = z.enum(["none", "sm", "md", "lg"]);
export const widthSchema = z.enum(["narrow", "default", "wide", "full"]);
export const itemsSchema = z.enum(["start", "center", "end", "stretch"]);
export const justifySchema = z.enum(["start", "center", "end", "between"]);

/** Child blocks of a layout block. Validated recursively by document.ts, not by zod. */
export const slotSchema = z.array(z.unknown()).default([]);

export const ICON_NAMES = [
  "check",
  "star",
  "heart",
  "truck",
  "shield",
  "leaf",
  "gift",
  "phone",
  "mail",
  "award",
  "returns",
  "support",
  "clipboard",
  "cup",
  "help",
  "info",
  "package",
  "droplet",
  "arrow-right",
  "arrow-left",
  "chevron-right",
  "chevron-left",
  "cart",
  "external-link",
  "plus",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Any Lucide icon (@bs/icons allowlist, ADR-041) or a name stored before Lucide. Widening the old enum keeps every saved document valid. */
export const iconNameSchema = z.string().max(64).refine(isIconName, "Unknown icon");
