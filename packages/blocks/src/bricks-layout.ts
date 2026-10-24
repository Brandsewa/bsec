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

const lengthValue = (key: Parameters<typeof isValidLayoutValue>[0] = "width") =>
  z
    .string()
    .max(32)
    .refine((v) => v === "" || isValidLayoutValue(key, v), {
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

  // Responsive CSS Variables for flex / layout properties
  if (d.direction) style["--brx-d-dir"] = d.direction;
  if (t?.direction) style["--brx-t-dir"] = t.direction;
  if (m?.direction) style["--brx-m-dir"] = m.direction;

  if (d.alignMainAxis) style["--brx-d-jc"] = d.alignMainAxis;
  if (t?.alignMainAxis) style["--brx-t-jc"] = t.alignMainAxis;
  if (m?.alignMainAxis) style["--brx-m-jc"] = m.alignMainAxis;

  if (d.alignCrossAxis) style["--brx-d-ai"] = d.alignCrossAxis;
  if (t?.alignCrossAxis) style["--brx-t-ai"] = t.alignCrossAxis;
  if (m?.alignCrossAxis) style["--brx-m-ai"] = m.alignCrossAxis;

  if (d.flexWrap) style["--brx-d-wrap"] = d.flexWrap;
  if (t?.flexWrap) style["--brx-t-wrap"] = t.flexWrap;
  if (m?.flexWrap) style["--brx-m-wrap"] = m.flexWrap;

  if (d.gap) style["--brx-d-gap"] = d.gap;
  if (t?.gap) style["--brx-t-gap"] = t.gap;
  if (m?.gap) style["--brx-m-gap"] = m.gap;

  if (d.colGap) style["--brx-d-cg"] = d.colGap;
  if (t?.colGap) style["--brx-t-cg"] = t.colGap;
  if (m?.colGap) style["--brx-m-cg"] = m.colGap;

  if (d.rowGap) style["--brx-d-rg"] = d.rowGap;
  if (t?.rowGap) style["--brx-t-rg"] = t.rowGap;
  if (m?.rowGap) style["--brx-m-rg"] = m.rowGap;

  // Padding
  if (d.padding?.top) style["--brx-d-pt"] = d.padding.top;
  if (d.padding?.right) style["--brx-d-pr"] = d.padding.right;
  if (d.padding?.bottom) style["--brx-d-pb"] = d.padding.bottom;
  if (d.padding?.left) style["--brx-d-pl"] = d.padding.left;

  if (t?.padding?.top) style["--brx-t-pt"] = t.padding.top;
  if (t?.padding?.right) style["--brx-t-pr"] = t.padding.right;
  if (t?.padding?.bottom) style["--brx-t-pb"] = t.padding.bottom;
  if (t?.padding?.left) style["--brx-t-pl"] = t.padding.left;

  if (m?.padding?.top) style["--brx-m-pt"] = m.padding.top;
  if (m?.padding?.right) style["--brx-m-pr"] = m.padding.right;
  if (m?.padding?.bottom) style["--brx-m-pb"] = m.padding.bottom;
  if (m?.padding?.left) style["--brx-m-pl"] = m.padding.left;

  // Margin
  if (d.margin?.top) style["--brx-d-mt"] = d.margin.top;
  if (d.margin?.right) style["--brx-d-mr"] = d.margin.right;
  if (d.margin?.bottom) style["--brx-d-mb"] = d.margin.bottom;
  if (d.margin?.left) style["--brx-d-ml"] = d.margin.left;

  if (t?.margin?.top) style["--brx-t-mt"] = t.margin.top;
  if (t?.margin?.right) style["--brx-t-mr"] = t.margin.right;
  if (t?.margin?.bottom) style["--brx-t-mb"] = t.margin.bottom;
  if (t?.margin?.left) style["--brx-t-ml"] = t.margin.left;

  if (m?.margin?.top) style["--brx-m-mt"] = m.margin.top;
  if (m?.margin?.right) style["--brx-m-mr"] = m.margin.right;
  if (m?.margin?.bottom) style["--brx-m-mb"] = m.margin.bottom;
  if (m?.margin?.left) style["--brx-m-ml"] = m.margin.left;

  // Sizing
  if (d.sizing?.width) style["--brx-d-w"] = d.sizing.width;
  if (t?.sizing?.width) style["--brx-t-w"] = t.sizing.width;
  if (m?.sizing?.width) style["--brx-m-w"] = m.sizing.width;

  if (d.sizing?.minWidth) style["--brx-d-mnw"] = d.sizing.minWidth;
  if (t?.sizing?.minWidth) style["--brx-t-mnw"] = t.sizing.minWidth;
  if (m?.sizing?.minWidth) style["--brx-m-mnw"] = m.sizing.minWidth;

  if (d.sizing?.maxWidth) style["--brx-d-mxw"] = d.sizing.maxWidth;
  if (t?.sizing?.maxWidth) style["--brx-t-mxw"] = t.sizing.maxWidth;
  if (m?.sizing?.maxWidth) style["--brx-m-mxw"] = m.sizing.maxWidth;

  if (d.sizing?.height) style["--brx-d-h"] = d.sizing.height;
  if (t?.sizing?.height) style["--brx-t-h"] = t.sizing.height;
  if (m?.sizing?.height) style["--brx-m-h"] = m.sizing.height;

  if (d.sizing?.minHeight) style["--brx-d-mnh"] = d.sizing.minHeight;
  if (t?.sizing?.minHeight) style["--brx-t-mnh"] = t.sizing.minHeight;
  if (m?.sizing?.minHeight) style["--brx-m-mnh"] = m.sizing.minHeight;

  if (d.sizing?.maxHeight) style["--brx-d-mxh"] = d.sizing.maxHeight;
  if (t?.sizing?.maxHeight) style["--brx-t-mxh"] = t.sizing.maxHeight;
  if (m?.sizing?.maxHeight) style["--brx-m-mxh"] = m.sizing.maxHeight;

  if (d.sizing?.aspectRatio) style["--brx-d-ar"] = d.sizing.aspectRatio.replace(/\s+/g, " ");
  if (t?.sizing?.aspectRatio) style["--brx-t-ar"] = t.sizing.aspectRatio.replace(/\s+/g, " ");
  if (m?.sizing?.aspectRatio) style["--brx-m-ar"] = m.sizing.aspectRatio.replace(/\s+/g, " ");

  // Text / Content Alignment
  if (d.align) style["--brx-d-ta"] = d.align;
  if (t?.align) style["--brx-t-ta"] = t.align;
  if (m?.align) style["--brx-m-ta"] = m.align;

  // Background color
  if (d.background?.color) style["--brx-d-bg-c"] = d.background.color;
  if (t?.background?.color) style["--brx-t-bg-c"] = t.background.color;
  if (m?.background?.color) style["--brx-m-bg-c"] = m.background.color;

  // Display
  const display = props.display || options?.defaultDisplay || "flex";
  if (display !== "none") {
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
  if (props.gap) style.gap = props.gap;
  if (props.colGap) style.columnGap = props.colGap;
  if (props.rowGap) style.rowGap = props.rowGap;

  // Margin
  if (props.margin?.top) style.marginTop = props.margin.top;
  if (props.margin?.right) style.marginRight = props.margin.right;
  if (props.margin?.bottom) style.marginBottom = props.margin.bottom;
  if (props.margin?.left) style.marginLeft = props.margin.left;

  // Padding
  if (props.padding?.top) style.paddingTop = props.padding.top;
  if (props.padding?.right) style.paddingRight = props.padding.right;
  if (props.padding?.bottom) style.paddingBottom = props.padding.bottom;
  if (props.padding?.left) style.paddingLeft = props.padding.left;

  // Sizing
  if (props.sizing?.width) {
    style.width = props.sizing.width;
  } else if (options?.defaultWidth) {
    style.width = options.defaultWidth;
  }

  if (props.sizing?.minWidth) style.minWidth = props.sizing.minWidth;
  if (props.sizing?.maxWidth) style.maxWidth = props.sizing.maxWidth;
  if (props.sizing?.height) style.height = props.sizing.height;
  if (props.sizing?.minHeight) style.minHeight = props.sizing.minHeight;
  if (props.sizing?.maxHeight) style.maxHeight = props.sizing.maxHeight;
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
