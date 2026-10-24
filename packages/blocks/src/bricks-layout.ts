import { z } from "zod";
import type { CSSProperties } from "react";
import { isValidLayoutValue, type LayoutDevice, LAYOUT_DEVICES, type Corner, CORNERS } from "./layout.ts";
import { hexColorSchema, bgVideoUrlSchema } from "./common.ts";

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
  mediaId: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
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
  if (bgc_d) style["--brx-d-bg-c"] = bgc_d;
  if (bgc_t) style["--brx-t-bg-c"] = bgc_t;
  if (bgc_m) style["--brx-m-bg-c"] = bgc_m;

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

  // Border
  if (props.border?.style && props.border.style !== "none") {
    style.borderStyle = props.border.style;
    style.borderWidth = props.border.width || "1px";
    if (props.border.color) style.borderColor = props.border.color;
  } else if (props.border?.width) {
    style.borderWidth = props.border.width;
    style.borderStyle = "solid";
    if (props.border.color) style.borderColor = props.border.color;
  }

  if (props.border?.radiusCorners) {
    const rc = props.border.radiusCorners;
    if (rc.topLeft) style.borderTopLeftRadius = rc.topLeft;
    if (rc.topRight) style.borderTopRightRadius = rc.topRight;
    if (rc.bottomRight) style.borderBottomRightRadius = rc.bottomRight;
    if (rc.bottomLeft) style.borderBottomLeftRadius = rc.bottomLeft;
  } else if (props.border?.radius) {
    style.borderRadius = props.border.radius;
  }

  // Box Shadow
  if (props.boxShadow && (props.boxShadow.x !== undefined || props.boxShadow.y !== undefined || props.boxShadow.blur !== undefined)) {
    const x = `${props.boxShadow.x ?? 0}px`;
    const y = `${props.boxShadow.y ?? 0}px`;
    const blur = `${props.boxShadow.blur ?? 0}px`;
    const spread = `${props.boxShadow.spread ?? 0}px`;
    const color = props.boxShadow.color || "rgba(0,0,0,0.15)";
    const inset = props.boxShadow.inset ? "inset " : "";
    style.boxShadow = `${inset}${x} ${y} ${blur} ${spread} ${color}`;
  }

  return style;
}
