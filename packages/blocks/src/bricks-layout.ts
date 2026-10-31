import { z } from "zod";
import type { CSSProperties } from "react";
import { isValidLayoutValue, type LayoutDevice, LAYOUT_DEVICES, type Corner, CORNERS } from "./layout.ts";
import { isDarkColor } from "./theme-vars.ts";
import { hexColorSchema, bgVideoUrlSchema, httpsImageUrlSchema } from "./common.ts";

/**
 * Bricks-inspired Layout & Style specifications for Section, Container, and Block.
 */

export const BRICKS_DISPLAY_OPTIONS = [
  "flex",
  "inline-flex",
  "grid",
  "block",
  "inline-block",
  "none",
] as const;
export type BricksDisplay = (typeof BRICKS_DISPLAY_OPTIONS)[number];

export const BRICKS_FLEX_WRAP_OPTIONS = ["nowrap", "wrap", "wrap-reverse"] as const;
export type BricksFlexWrap = (typeof BRICKS_FLEX_WRAP_OPTIONS)[number];

export const BRICKS_DIRECTION_OPTIONS = [
  "row",
  "row-reverse",
  "column",
  "column-reverse",
] as const;
export type BricksDirection = (typeof BRICKS_DIRECTION_OPTIONS)[number];

export const BRICKS_ALIGN_SELF_OPTIONS = [
  "auto",
  "flex-start",
  "center",
  "flex-end",
  "stretch",
] as const;
export type BricksAlignSelf = (typeof BRICKS_ALIGN_SELF_OPTIONS)[number];

export const BRICKS_ALIGN_MAIN_OPTIONS = [
  "flex-start",
  "center",
  "flex-end",
  "space-between",
  "space-around",
  "space-evenly",
] as const;
export type BricksAlignMain = (typeof BRICKS_ALIGN_MAIN_OPTIONS)[number];

export const BRICKS_ALIGN_CROSS_OPTIONS = [
  "flex-start",
  "center",
  "flex-end",
  "stretch",
  "baseline",
] as const;
export type BricksAlignCross = (typeof BRICKS_ALIGN_CROSS_OPTIONS)[number];

export const BRICKS_OBJECT_FIT_OPTIONS = [
  "cover",
  "contain",
  "fill",
  "scale-down",
  "none",
] as const;
export type BricksObjectFit = (typeof BRICKS_OBJECT_FIT_OPTIONS)[number];

export const BRICKS_OBJECT_POSITION_OPTIONS = [
  "center center",
  "top center",
  "bottom center",
  "center left",
  "center right",
  "top left",
  "top right",
  "bottom left",
  "bottom right",
] as const;
export type BricksObjectPosition = (typeof BRICKS_OBJECT_POSITION_OPTIONS)[number];

export const BRICKS_BORDER_STYLE_OPTIONS = [
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
] as const;
export type BricksBorderStyle = (typeof BRICKS_BORDER_STYLE_OPTIONS)[number];

export { LAYOUT_DEVICES, type LayoutDevice, CORNERS, type Corner };

export function normalizeLengthValue(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const str = String(value).trim();
  if (str === "") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return `${str}px`;
  }
  return str;
}

const lengthValue = (key: Parameters<typeof isValidLayoutValue>[0] = "width") =>
  z
    .union([z.string(), z.number()])
    .transform((v) => normalizeLengthValue(v))
    .refine((v) => v === undefined || v === "" || isValidLayoutValue(key, v), {
      message: "Invalid size (use number with px, rem, em, % or keyword like auto/none)",
    })
    .optional();

const spacingQuad = z.object({
  top: lengthValue("paddingTop"),
  right: lengthValue("paddingRight"),
  bottom: lengthValue("paddingBottom"),
  left: lengthValue("paddingLeft"),
});

const cornersQuad = z.object({
  topLeft: lengthValue("radius"),
  topRight: lengthValue("radius"),
  bottomRight: lengthValue("radius"),
  bottomLeft: lengthValue("radius"),
});

const sizingSchema = z.object({
  width: lengthValue("width"),
  minWidth: lengthValue("minWidth"),
  maxWidth: lengthValue("maxWidth"),
  height: lengthValue("height"),
  minHeight: lengthValue("minHeight"),
  maxHeight: lengthValue("maxHeight"),
  aspectRatio: z.string().max(16).regex(/^(\d{1,3}(\.\d{1,3})?(\s*\/\s*\d{1,3}(\.\d{1,3})?)?)?$/).optional(),
});

const backgroundSchema = z.object({
  color: hexColorSchema.optional().or(z.literal("")),
  textColor: hexColorSchema.optional().or(z.literal("")),
  mediaId: z.string().optional(),
  imageUrl: httpsImageUrlSchema.optional().or(z.literal("")),
  imageSize: z.string().optional(), // 'cover' | 'contain' | 'auto' | custom
  imagePosition: z.string().optional(), // 'center center' | 'top center' | ...
  videoUrl: bgVideoUrlSchema.optional().or(z.literal("")),
  videoPosterId: z.string().optional(),
  videoFit: z.string().optional(), // 'cover' | 'contain' | ...
  videoPosition: z.string().optional(), // 'center center' | ...
});

const borderSchema = z.object({
  width: lengthValue("paddingTop"),
  style: z.enum(BRICKS_BORDER_STYLE_OPTIONS).optional(),
  color: hexColorSchema.optional().or(z.literal("")),
  radius: lengthValue("radius"),
  radiusCorners: cornersQuad.optional(),
});

const boxShadowSchema = z.object({
  x: z.number().int().min(-100).max(100).optional(),
  y: z.number().int().min(-100).max(100).optional(),
  blur: z.number().int().min(0).max(100).optional(),
  spread: z.number().int().min(-100).max(100).optional(),
  color: hexColorSchema.optional().or(z.literal("")),
  inset: z.boolean().optional(),
});

export const typographySchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: lengthValue("width"),
  fontWeight: z.string().optional(),
  lineHeight: lengthValue("width"),
  letterSpacing: lengthValue("width"),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
});
export type TypographyValues = z.infer<typeof typographySchema>;

// Base style values for layout & styling
export const baseStyleSchema = z.object({
  // Content Tab
  display: z.enum(BRICKS_DISPLAY_OPTIONS).optional(),
  gap: lengthValue("width"),
  colGap: lengthValue("width"),
  rowGap: lengthValue("width"),
  flexWrap: z.enum(BRICKS_FLEX_WRAP_OPTIONS).optional(),
  direction: z.enum(BRICKS_DIRECTION_OPTIONS).optional(),
  alignSelf: z.enum(BRICKS_ALIGN_SELF_OPTIONS).optional(),
  alignMainAxis: z.enum(BRICKS_ALIGN_MAIN_OPTIONS).optional(),
  alignCrossAxis: z.enum(BRICKS_ALIGN_CROSS_OPTIONS).optional(),
  order: z.number().int().min(-999).max(999).optional(),

  // Style Tab - Layout
  margin: spacingQuad.optional(),
  padding: spacingQuad.optional(),
  sizing: sizingSchema.optional(),

  // Style Tab - Typography
  typography: typographySchema.optional(),

  // Style Tab - Background
  background: backgroundSchema.optional(),

  // Style Tab - Border & Shadow
  border: borderSchema.optional(),
  boxShadow: boxShadowSchema.optional(),
});
export type BaseStyleValues = z.infer<typeof baseStyleSchema>;

// Single responsive device style values with element-specific overrides
export const responsiveStyleSchema = baseStyleSchema
  .extend({
    // Media & Element-specific settings (Image, Video, Heading, Text, etc.)
    mediaId: z.string().optional(),
    imageUrl: z.string().optional(),
    alt: z.string().optional(),
    ratio: z.string().optional(),
    objectFit: z.string().optional(),
    objectPosition: z.string().optional(),
    videoType: z.string().optional(),
    videoUrl: z.string().optional(),
    posterMediaId: z.string().optional(),
    text: z.string().optional(),
    title: z.string().optional(),
    size: z.string().optional(),
    level: z.string().optional(),
    align: z.string().optional(),
  })
  .passthrough();
export type ResponsiveStyleValues = z.infer<typeof responsiveStyleSchema>;

export const bricksLayoutSchema = baseStyleSchema.extend({
  // Responsive overrides per device
  responsive: z
    .object({
      desktop: responsiveStyleSchema.optional(),
      tablet: responsiveStyleSchema.optional(),
      mobile: responsiveStyleSchema.optional(),
    })
    .optional(),
});

export type BricksLayoutProps = z.infer<typeof bricksLayoutSchema> & {
  align?: string | undefined;
};

/**
 * Computes inline CSS styles and responsive CSS variables for a Bricks layout element.
 */
export function bricksElementStyle(props: BricksLayoutProps, options?: { defaultWidth?: string | undefined; defaultDisplay?: string | undefined }): CSSProperties {
  const style: CSSProperties & Record<string, string | number | undefined> = {};

  const d = props;
  const t = props.responsive?.tablet;
  const m = props.responsive?.mobile;

  // Responsive CSS Variables for flex / layout properties with desktop -> tablet -> mobile inheritance
  const dir_d = d.direction;
  const dir_t = t?.direction ?? dir_d;
  const dir_m = m?.direction ?? dir_t;
  if (dir_d) style["--brx-d-dir"] = dir_d;
  if (dir_t) style["--brx-t-dir"] = dir_t;
  if (dir_m) style["--brx-m-dir"] = dir_m;

  const jc_d = d.alignMainAxis;
  const jc_t = t?.alignMainAxis ?? jc_d;
  const jc_m = m?.alignMainAxis ?? jc_t;
  if (jc_d) style["--brx-d-jc"] = jc_d;
  if (jc_t) style["--brx-t-jc"] = jc_t;
  if (jc_m) style["--brx-m-jc"] = jc_m;

  const ai_d = d.alignCrossAxis;
  const ai_t = t?.alignCrossAxis ?? ai_d;
  const ai_m = m?.alignCrossAxis ?? ai_t;
  if (ai_d) style["--brx-d-ai"] = ai_d;
  if (ai_t) style["--brx-t-ai"] = ai_t;
  if (ai_m) style["--brx-m-ai"] = ai_m;

  const wrap_d = d.flexWrap;
  const wrap_t = t?.flexWrap ?? wrap_d;
  const wrap_m = m?.flexWrap ?? wrap_t;
  if (wrap_d) style["--brx-d-wrap"] = wrap_d;
  if (wrap_t) style["--brx-t-wrap"] = wrap_t;
  if (wrap_m) style["--brx-m-wrap"] = wrap_m;

  const gap_d = normalizeLengthValue(d.gap);
  const gap_t = normalizeLengthValue(t?.gap) ?? gap_d;
  const gap_m = normalizeLengthValue(m?.gap) ?? gap_t;
  if (gap_d) style["--brx-d-gap"] = gap_d;
  if (gap_t) style["--brx-t-gap"] = gap_t;
  if (gap_m) style["--brx-m-gap"] = gap_m;

  const cg_d = normalizeLengthValue(d.colGap);
  const cg_t = normalizeLengthValue(t?.colGap) ?? cg_d;
  const cg_m = normalizeLengthValue(m?.colGap) ?? cg_t;
  if (cg_d) style["--brx-d-cg"] = cg_d;
  if (cg_t) style["--brx-t-cg"] = cg_t;
  if (cg_m) style["--brx-m-cg"] = cg_m;

  const rg_d = normalizeLengthValue(d.rowGap);
  const rg_t = normalizeLengthValue(t?.rowGap) ?? rg_d;
  const rg_m = normalizeLengthValue(m?.rowGap) ?? rg_t;
  if (rg_d) style["--brx-d-rg"] = rg_d;
  if (rg_t) style["--brx-t-rg"] = rg_t;
  if (rg_m) style["--brx-m-rg"] = rg_m;

  // Padding
  const pt_d = normalizeLengthValue(d.padding?.top);
  const pt_t = normalizeLengthValue(t?.padding?.top) ?? pt_d;
  const pt_m = normalizeLengthValue(m?.padding?.top) ?? pt_t;
  if (pt_d) style["--brx-d-pt"] = pt_d;
  if (pt_t) style["--brx-t-pt"] = pt_t;
  if (pt_m) style["--brx-m-pt"] = pt_m;

  const pr_d = normalizeLengthValue(d.padding?.right);
  const pr_t = normalizeLengthValue(t?.padding?.right) ?? pr_d;
  const pr_m = normalizeLengthValue(m?.padding?.right) ?? pr_t;
  if (pr_d) style["--brx-d-pr"] = pr_d;
  if (pr_t) style["--brx-t-pr"] = pr_t;
  if (pr_m) style["--brx-m-pr"] = pr_m;

  const pb_d = normalizeLengthValue(d.padding?.bottom);
  const pb_t = normalizeLengthValue(t?.padding?.bottom) ?? pb_d;
  const pb_m = normalizeLengthValue(m?.padding?.bottom) ?? pb_t;
  if (pb_d) style["--brx-d-pb"] = pb_d;
  if (pb_t) style["--brx-t-pb"] = pb_t;
  if (pb_m) style["--brx-m-pb"] = pb_m;

  const pl_d = normalizeLengthValue(d.padding?.left);
  const pl_t = normalizeLengthValue(t?.padding?.left) ?? pl_d;
  const pl_m = normalizeLengthValue(m?.padding?.left) ?? pl_t;
  if (pl_d) style["--brx-d-pl"] = pl_d;
  if (pl_t) style["--brx-t-pl"] = pl_t;
  if (pl_m) style["--brx-m-pl"] = pl_m;

  // Margin
  const mt_d = normalizeLengthValue(d.margin?.top);
  const mt_t = normalizeLengthValue(t?.margin?.top) ?? mt_d;
  const mt_m = normalizeLengthValue(m?.margin?.top) ?? mt_t;
  if (mt_d) style["--brx-d-mt"] = mt_d;
  if (mt_t) style["--brx-t-mt"] = mt_t;
  if (mt_m) style["--brx-m-mt"] = mt_m;

  const mr_d = normalizeLengthValue(d.margin?.right);
  const mr_t = normalizeLengthValue(t?.margin?.right) ?? mr_d;
  const mr_m = normalizeLengthValue(m?.margin?.right) ?? mr_t;
  if (mr_d) style["--brx-d-mr"] = mr_d;
  if (mr_t) style["--brx-t-mr"] = mr_t;
  if (mr_m) style["--brx-m-mr"] = mr_m;

  const mb_d = normalizeLengthValue(d.margin?.bottom);
  const mb_t = normalizeLengthValue(t?.margin?.bottom) ?? mb_d;
  const mb_m = normalizeLengthValue(m?.margin?.bottom) ?? mb_t;
  if (mb_d) style["--brx-d-mb"] = mb_d;
  if (mb_t) style["--brx-t-mb"] = mb_t;
  if (mb_m) style["--brx-m-mb"] = mb_m;

  const ml_d = normalizeLengthValue(d.margin?.left);
  const ml_t = normalizeLengthValue(t?.margin?.left) ?? ml_d;
  const ml_m = normalizeLengthValue(m?.margin?.left) ?? ml_t;
  if (ml_d) style["--brx-d-ml"] = ml_d;
  if (ml_t) style["--brx-t-ml"] = ml_t;
  if (ml_m) style["--brx-m-ml"] = ml_m;

  // Sizing
  const w_d = normalizeLengthValue(d.sizing?.width);
  const w_t = normalizeLengthValue(t?.sizing?.width) ?? w_d;
  const w_m = normalizeLengthValue(m?.sizing?.width) ?? w_t;
  if (w_d) style["--brx-d-w"] = w_d;
  if (w_t) style["--brx-t-w"] = w_t;
  if (w_m) style["--brx-m-w"] = w_m;

  const mnw_d = normalizeLengthValue(d.sizing?.minWidth);
  const mnw_t = normalizeLengthValue(t?.sizing?.minWidth) ?? mnw_d;
  const mnw_m = normalizeLengthValue(m?.sizing?.minWidth) ?? mnw_t;
  if (mnw_d) style["--brx-d-mnw"] = mnw_d;
  if (mnw_t) style["--brx-t-mnw"] = mnw_t;
  if (mnw_m) style["--brx-m-mnw"] = mnw_m;

  const mxw_d = normalizeLengthValue(d.sizing?.maxWidth);
  const mxw_t = normalizeLengthValue(t?.sizing?.maxWidth) ?? mxw_d;
  const mxw_m = normalizeLengthValue(m?.sizing?.maxWidth) ?? mxw_t;
  if (mxw_d) style["--brx-d-mxw"] = mxw_d;
  if (mxw_t) style["--brx-t-mxw"] = mxw_t;
  if (mxw_m) style["--brx-m-mxw"] = mxw_m;

  const h_d = normalizeLengthValue(d.sizing?.height);
  const h_t = normalizeLengthValue(t?.sizing?.height) ?? h_d;
  const h_m = normalizeLengthValue(m?.sizing?.height) ?? h_t;
  if (h_d) style["--brx-d-h"] = h_d;
  if (h_t) style["--brx-t-h"] = h_t;
  if (h_m) style["--brx-m-h"] = h_m;

  const mnh_d = normalizeLengthValue(d.sizing?.minHeight);
  const mnh_t = normalizeLengthValue(t?.sizing?.minHeight) ?? mnh_d;
  const mnh_m = normalizeLengthValue(m?.sizing?.minHeight) ?? mnh_t;
  if (mnh_d) style["--brx-d-mnh"] = mnh_d;
  if (mnh_t) style["--brx-t-mnh"] = mnh_t;
  if (mnh_m) style["--brx-m-mnh"] = mnh_m;

  const mxh_d = normalizeLengthValue(d.sizing?.maxHeight);
  const mxh_t = normalizeLengthValue(t?.sizing?.maxHeight) ?? mxh_d;
  const mxh_m = normalizeLengthValue(m?.sizing?.maxHeight) ?? mxh_t;
  if (mxh_d) style["--brx-d-mxh"] = mxh_d;
  if (mxh_t) style["--brx-t-mxh"] = mxh_t;
  if (mxh_m) style["--brx-m-mxh"] = mxh_m;

  const ar_d = d.sizing?.aspectRatio?.replace(/\s+/g, " ");
  const ar_t = t?.sizing?.aspectRatio?.replace(/\s+/g, " ") ?? ar_d;
  const ar_m = m?.sizing?.aspectRatio?.replace(/\s+/g, " ") ?? ar_t;
  if (ar_d) style["--brx-d-ar"] = ar_d;
  if (ar_t) style["--brx-t-ar"] = ar_t;
  if (ar_m) style["--brx-m-ar"] = ar_m;

  // Text / Content Alignment
  const ta_d = d.align;
  const ta_t = t?.align ?? ta_d;
  const ta_m = m?.align ?? ta_t;
  if (ta_d) style["--brx-d-ta"] = ta_d;
  if (ta_t) style["--brx-t-ta"] = ta_t;
  if (ta_m) style["--brx-m-ta"] = ta_m;

  // Background color
  const bgc_d = d.background?.color;
  const bgc_t = t?.background?.color ?? bgc_d;
  const bgc_m = m?.background?.color ?? bgc_t;
  // Icon colour for the background this element paints: the theme's dark or light icon colour, chosen from the
  // colour's brightness per device (ADR-041). Used with the brx-ic class (see bricksIconToneClass).
  const icon = (c: string | undefined) => {
    const dark = isDarkColor(c);
    return dark === undefined ? undefined : dark ? "var(--bs-icon-color-dark, currentColor)" : "var(--bs-icon-color-light, var(--p))";
  };
  const ic_d = icon(bgc_d);
  const ic_t = icon(bgc_t);
  const ic_m = icon(bgc_m);
  if (ic_d) style["--brx-d-ic"] = ic_d;
  if (ic_t) style["--brx-t-ic"] = ic_t;
  if (ic_m) style["--brx-m-ic"] = ic_m;
  if (bgc_d) style["--brx-d-bg-c"] = bgc_d;
  if (bgc_t) style["--brx-t-bg-c"] = bgc_t;
  if (bgc_m) style["--brx-m-bg-c"] = bgc_m;

  // Text color
  const tc_d = d.background?.textColor;
  const tc_t = t?.background?.textColor ?? tc_d;
  const tc_m = m?.background?.textColor ?? tc_t;
  if (tc_d) style["--brx-d-c"] = tc_d;
  if (tc_t) style["--brx-t-c"] = tc_t;
  if (tc_m) style["--brx-m-c"] = tc_m;

  // Border Radius (per-corner with uniform radius fallback and D -> T -> M cascade)
  const getCornerRadius = (
    devBorder: z.infer<typeof borderSchema> | undefined,
    corner: "topLeft" | "topRight" | "bottomRight" | "bottomLeft"
  ): string | undefined => {
    if (!devBorder) return undefined;
    const cornerVal = devBorder.radiusCorners?.[corner];
    if (cornerVal !== undefined && cornerVal !== "") return normalizeLengthValue(cornerVal);
    if (devBorder.radius !== undefined && devBorder.radius !== "") return normalizeLengthValue(devBorder.radius);
    return undefined;
  };

  const rtl_d = getCornerRadius(d.border, "topLeft");
  const rtl_t = getCornerRadius(t?.border, "topLeft") ?? rtl_d;
  const rtl_m = getCornerRadius(m?.border, "topLeft") ?? rtl_t;
  if (rtl_d) style["--brx-d-rtl"] = rtl_d;
  if (rtl_t) style["--brx-t-rtl"] = rtl_t;
  if (rtl_m) style["--brx-m-rtl"] = rtl_m;

  const rtr_d = getCornerRadius(d.border, "topRight");
  const rtr_t = getCornerRadius(t?.border, "topRight") ?? rtr_d;
  const rtr_m = getCornerRadius(m?.border, "topRight") ?? rtr_t;
  if (rtr_d) style["--brx-d-rtr"] = rtr_d;
  if (rtr_t) style["--brx-t-rtr"] = rtr_t;
  if (rtr_m) style["--brx-m-rtr"] = rtr_m;

  const rbr_d = getCornerRadius(d.border, "bottomRight");
  const rbr_t = getCornerRadius(t?.border, "bottomRight") ?? rbr_d;
  const rbr_m = getCornerRadius(m?.border, "bottomRight") ?? rbr_t;
  if (rbr_d) style["--brx-d-rbr"] = rbr_d;
  if (rbr_t) style["--brx-t-rbr"] = rbr_t;
  if (rbr_m) style["--brx-m-rbr"] = rbr_m;

  const rbl_d = getCornerRadius(d.border, "bottomLeft");
  const rbl_t = getCornerRadius(t?.border, "bottomLeft") ?? rbl_d;
  const rbl_m = getCornerRadius(m?.border, "bottomLeft") ?? rbl_t;
  if (rbl_d) style["--brx-d-rbl"] = rbl_d;
  if (rbl_t) style["--brx-t-rbl"] = rbl_t;
  if (rbl_m) style["--brx-m-rbl"] = rbl_m;

  // Border Width, Style, Color (D -> T -> M cascade)
  const bw_d = normalizeLengthValue(d.border?.width);
  const bw_t = normalizeLengthValue(t?.border?.width) ?? bw_d;
  const bw_m = normalizeLengthValue(m?.border?.width) ?? bw_t;
  if (bw_d) style["--brx-d-bw"] = bw_d;
  if (bw_t) style["--brx-t-bw"] = bw_t;
  if (bw_m) style["--brx-m-bw"] = bw_m;

  const bs_d = d.border?.style;
  const bs_t = t?.border?.style ?? bs_d;
  const bs_m = m?.border?.style ?? bs_t;
  if (bs_d) style["--brx-d-bs"] = bs_d;
  if (bs_t) style["--brx-t-bs"] = bs_t;
  if (bs_m) style["--brx-m-bs"] = bs_m;

  const bc_d = d.border?.color;
  const bc_t = t?.border?.color ?? bc_d;
  const bc_m = m?.border?.color ?? bc_t;
  if (bc_d) style["--brx-d-bc"] = bc_d;
  if (bc_t) style["--brx-t-bc"] = bc_t;
  if (bc_m) style["--brx-m-bc"] = bc_m;

  // Box Shadow
  const formatBoxShadow = (s: z.infer<typeof boxShadowSchema> | undefined): string | undefined => {
    if (!s || (s.x === undefined && s.y === undefined && s.blur === undefined && s.spread === undefined)) return undefined;
    const x = `${s.x ?? 0}px`;
    const y = `${s.y ?? 0}px`;
    const blur = `${s.blur ?? 0}px`;
    const spread = `${s.spread ?? 0}px`;
    const color = s.color || "rgba(0,0,0,0.15)";
    const inset = s.inset ? "inset " : "";
    return `${inset}${x} ${y} ${blur} ${spread} ${color}`;
  };

  const bsh_d = formatBoxShadow(d.boxShadow);
  const bsh_t = formatBoxShadow(t?.boxShadow) ?? bsh_d;
  const bsh_m = formatBoxShadow(m?.boxShadow) ?? bsh_t;
  if (bsh_d) style["--brx-d-bsh"] = bsh_d;
  if (bsh_t) style["--brx-t-bsh"] = bsh_t;
  if (bsh_m) style["--brx-m-bsh"] = bsh_m;

  // Typography (D -> T -> M cascade)
  const fs_d = normalizeLengthValue(d.typography?.fontSize);
  const fs_t = normalizeLengthValue(t?.typography?.fontSize) ?? fs_d;
  const fs_m = normalizeLengthValue(m?.typography?.fontSize) ?? fs_t;
  if (fs_d) style["--brx-d-fs"] = fs_d;
  if (fs_t) style["--brx-t-fs"] = fs_t;
  if (fs_m) style["--brx-m-fs"] = fs_m;

  const fw_d = d.typography?.fontWeight;
  const fw_t = t?.typography?.fontWeight ?? fw_d;
  const fw_m = m?.typography?.fontWeight ?? fw_t;
  if (fw_d) style["--brx-d-fw"] = fw_d;
  if (fw_t) style["--brx-t-fw"] = fw_t;
  if (fw_m) style["--brx-m-fw"] = fw_m;

  const ff_d = d.typography?.fontFamily;
  const ff_t = t?.typography?.fontFamily ?? ff_d;
  const ff_m = m?.typography?.fontFamily ?? ff_t;
  if (ff_d) style["--brx-d-ff"] = ff_d;
  if (ff_t) style["--brx-t-ff"] = ff_t;
  if (ff_m) style["--brx-m-ff"] = ff_m;

  const lh_d = normalizeLengthValue(d.typography?.lineHeight);
  const lh_t = normalizeLengthValue(t?.typography?.lineHeight) ?? lh_d;
  const lh_m = normalizeLengthValue(m?.typography?.lineHeight) ?? lh_t;
  if (lh_d) style["--brx-d-lh"] = lh_d;
  if (lh_t) style["--brx-t-lh"] = lh_t;
  if (lh_m) style["--brx-m-lh"] = lh_m;

  const ls_d = normalizeLengthValue(d.typography?.letterSpacing);
  const ls_t = normalizeLengthValue(t?.typography?.letterSpacing) ?? ls_d;
  const ls_m = normalizeLengthValue(m?.typography?.letterSpacing) ?? ls_t;
  if (ls_d) style["--brx-d-ls"] = ls_d;
  if (ls_t) style["--brx-t-ls"] = ls_t;
  if (ls_m) style["--brx-m-ls"] = ls_m;

  const tt_d = d.typography?.textTransform;
  const tt_t = t?.typography?.textTransform ?? tt_d;
  const tt_m = m?.typography?.textTransform ?? tt_t;
  if (tt_d) style["--brx-d-tt"] = tt_d;
  if (tt_t) style["--brx-t-tt"] = tt_t;
  if (tt_m) style["--brx-m-tt"] = tt_m;

  // Display
  const display = props.display || options?.defaultDisplay;
  if (display && display !== "none") {
    style.display = display;
  }

  // Base styles for SSR / desktop
  if (display === "flex" || display === "inline-flex") {
    if (props.direction) style.flexDirection = props.direction;
    if (props.flexWrap) style.flexWrap = props.flexWrap;
    if (props.alignMainAxis) style.justifyContent = props.alignMainAxis;
    if (props.alignCrossAxis) style.alignItems = props.alignCrossAxis;
  }

  if (props.alignSelf && props.alignSelf !== "auto") {
    style.alignSelf = props.alignSelf;
  }

  if (props.order !== undefined) {
    style.order = props.order;
  }

  // Gap
  if (props.gap) style.gap = normalizeLengthValue(props.gap);
  if (props.colGap) style.columnGap = normalizeLengthValue(props.colGap);
  if (props.rowGap) style.rowGap = normalizeLengthValue(props.rowGap);

  // Margin
  if (props.margin?.top) style.marginTop = normalizeLengthValue(props.margin.top);
  if (props.margin?.right) style.marginRight = normalizeLengthValue(props.margin.right);
  if (props.margin?.bottom) style.marginBottom = normalizeLengthValue(props.margin.bottom);
  if (props.margin?.left) style.marginLeft = normalizeLengthValue(props.margin.left);

  // Padding
  if (props.padding?.top) style.paddingTop = normalizeLengthValue(props.padding.top);
  if (props.padding?.right) style.paddingRight = normalizeLengthValue(props.padding.right);
  if (props.padding?.bottom) style.paddingBottom = normalizeLengthValue(props.padding.bottom);
  if (props.padding?.left) style.paddingLeft = normalizeLengthValue(props.padding.left);

  // Sizing
  if (props.sizing?.width) {
    style.width = normalizeLengthValue(props.sizing.width);
  } else if (options?.defaultWidth) {
    style.width = options.defaultWidth;
  }

  if (props.sizing?.minWidth) style.minWidth = normalizeLengthValue(props.sizing.minWidth);
  if (props.sizing?.maxWidth) style.maxWidth = normalizeLengthValue(props.sizing.maxWidth);
  if (props.sizing?.height) style.height = normalizeLengthValue(props.sizing.height);
  if (props.sizing?.minHeight) style.minHeight = normalizeLengthValue(props.sizing.minHeight);
  if (props.sizing?.maxHeight) style.maxHeight = normalizeLengthValue(props.sizing.maxHeight);
  if (props.sizing?.aspectRatio) style.aspectRatio = props.sizing.aspectRatio.replace(/\s+/g, " ");

  // Text alignment
  if (props.align) {
    style.textAlign = props.align as CSSProperties["textAlign"];
  }

  // Background
  if (props.background?.color) {
    style.backgroundColor = props.background.color;
  }
  if (props.background?.textColor) {
    style.color = props.background.textColor;
  }

  // Border (desktop base / SSR)
  if (bs_d && bs_d !== "none") {
    style.borderStyle = bs_d;
    style.borderWidth = bw_d || "1px";
    if (bc_d) style.borderColor = bc_d;
  } else if (bw_d) {
    style.borderWidth = bw_d;
    style.borderStyle = "solid";
    if (bc_d) style.borderColor = bc_d;
  }

  // Border Radius (desktop base / SSR, normalized)
  if (rtl_d) style.borderTopLeftRadius = rtl_d;
  if (rtr_d) style.borderTopRightRadius = rtr_d;
  if (rbr_d) style.borderBottomRightRadius = rbr_d;
  if (rbl_d) style.borderBottomLeftRadius = rbl_d;

  // Box Shadow (desktop base / SSR)
  if (bsh_d) {
    style.boxShadow = bsh_d;
  }

  // Typography (desktop base / SSR)
  if (fs_d) style.fontSize = fs_d;
  if (fw_d) style.fontWeight = fw_d;
  if (ff_d) style.fontFamily = ff_d;
  if (lh_d) style.lineHeight = lh_d;
  if (ls_d) style.letterSpacing = ls_d;
  if (tt_d) style.textTransform = tt_d;

  return style;
}

/**
 * Per-device flex-basis for the children of a layout slot: `0%` while the slot is a row (siblings share it), `auto` once
 * it stacks. The editor wraps every child in its own element, so its stylesheet needs this to size those wrappers; it is
 * emitted as variables rather than read back from the inline style text.
 */
/** "brx-ic" when this element paints its own background colour, so icons inside pick the dark or light icon colour automatically. */
export function bricksIconToneClass(props: BricksLayoutProps): string | undefined {
  const any = props.background?.color || props.responsive?.tablet?.background?.color || props.responsive?.mobile?.background?.color;
  return any ? "brx-ic" : undefined;
}

export function slotBasisVars(props: BricksLayoutProps): Record<string, string> {
  const stacked = (v: string | undefined) => (v === "column" || v === "column-reverse" ? "auto" : "0%");
  const d = props.direction ?? "column";
  const t = props.responsive?.tablet?.direction ?? d;
  const m = props.responsive?.mobile?.direction ?? t;
  return { "--slot-fb-d": stacked(d), "--slot-fb-t": stacked(t), "--slot-fb-m": stacked(m) };
}
