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

export const alignSchema = z.enum(["left", "center", "right"]);
export const toneSchema = z.enum(["default", "surface", "primary"]);
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
] as const;
export type IconName = (typeof ICON_NAMES)[number];
