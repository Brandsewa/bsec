import type { CSSProperties } from "react";
import { z } from "zod";

/**
 * Per-widget layout: margin, padding and sizing, set separately for desktop, tablet and phone (the same
 * model as a page builder's layout panel). A value is a validated CSS length ("24px", "1.5rem", "2em", "80%"),
 * never free-form CSS, so it can only ever be a size. Desktop is the base; a tablet value overrides desktop
 * on tablets and phones, and a phone value overrides both on phones, so a device only needs the values that
 * differ. blocks.css reads the values as --l-d-* / --l-t-* / --l-m-* variables (see .bsb-lay).
 */

export const LAYOUT_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type LayoutDevice = (typeof LAYOUT_DEVICES)[number];

/** Breakpoints (px) at which tablet and phone values start to apply (they apply at this width and below). */
export const LAYOUT_BREAKPOINTS = { tablet: 1023, mobile: 767 } as const;

export const LAYOUT_KEYS = [
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "width",
  "minWidth",
  "maxWidth",
  "height",
  "minHeight",
  "maxHeight",
  "aspectRatio",
] as const;
export type LayoutKey = (typeof LAYOUT_KEYS)[number];
export type LayoutValues = { [K in LayoutKey]?: string | undefined };
export type Layout = { [D in LayoutDevice]?: LayoutValues | undefined };

/** Short names used in the CSS variables: --l-d-mt is the desktop margin-top. */
export const LAYOUT_VAR: Record<LayoutKey, string> = {
  marginTop: "mt",
  marginRight: "mr",
  marginBottom: "mb",
  marginLeft: "ml",
  paddingTop: "pt",
  paddingRight: "pr",
  paddingBottom: "pb",
  paddingLeft: "pl",
  width: "w",
  minWidth: "mnw",
  maxWidth: "mxw",
  height: "h",
  minHeight: "mnh",
  maxHeight: "mxh",
  aspectRatio: "ar",
};
const DEVICE_LETTER: Record<LayoutDevice, string> = { desktop: "d", tablet: "t", mobile: "m" };

/** What a field accepts: the units, a negative number, and the keywords. */
export const LAYOUT_RULES: Record<LayoutKey, { units: readonly string[]; negative?: boolean; keywords: readonly string[] }> = {
  marginTop: { units: ["px", "rem", "em"], negative: true, keywords: ["auto"] },
  marginRight: { units: ["px", "rem", "em"], negative: true, keywords: ["auto"] },
  marginBottom: { units: ["px", "rem", "em"], negative: true, keywords: ["auto"] },
  marginLeft: { units: ["px", "rem", "em"], negative: true, keywords: ["auto"] },
  paddingTop: { units: ["px", "rem", "em"], keywords: [] },
  paddingRight: { units: ["px", "rem", "em"], keywords: [] },
  paddingBottom: { units: ["px", "rem", "em"], keywords: [] },
  paddingLeft: { units: ["px", "rem", "em"], keywords: [] },
  width: { units: ["px", "%", "rem", "em"], keywords: ["auto"] },
  minWidth: { units: ["px", "%", "rem", "em"], keywords: [] },
  maxWidth: { units: ["px", "%", "rem", "em"], keywords: ["none"] },
  height: { units: ["px", "rem", "em"], keywords: ["auto"] },
  minHeight: { units: ["px", "rem", "em"], keywords: [] },
  maxHeight: { units: ["px", "rem", "em"], keywords: ["none"] },
  aspectRatio: { units: [], keywords: [] },
};

const ASPECT = /^\d{1,3}(\.\d{1,3})?(\s*\/\s*\d{1,3}(\.\d{1,3})?)?$/;

export function isValidLayoutValue(key: LayoutKey, value: string): boolean {
  if (key === "aspectRatio") return ASPECT.test(value);
  const rule = LAYOUT_RULES[key];
  if (rule.keywords.includes(value)) return true;
  const m = /^(-?)(\d{1,5}(?:\.\d{1,3})?)(px|rem|em|%)$/.exec(value);
  if (!m) return false;
  if (m[1] && !rule.negative) return false;
  return rule.units.includes(m[3] as string);
}

const valueSchema = (key: LayoutKey) =>
  z
    .string()
    .max(24)
    .refine((v) => isValidLayoutValue(key, v), { message: `Not a valid ${key} (use a number with px, rem, em or %, or a keyword)` })
    .optional();

export const layoutValuesSchema = z.object(Object.fromEntries(LAYOUT_KEYS.map((k) => [k, valueSchema(k)])) as Record<LayoutKey, ReturnType<typeof valueSchema>>);

export const layoutSchema = z.object({
  desktop: layoutValuesSchema.optional(),
  tablet: layoutValuesSchema.optional(),
  mobile: layoutValuesSchema.optional(),
});

/** The CSS variables for a layout; only the values that are set. */
export function layoutStyle(layout: Layout | undefined): CSSProperties {
  const out: Record<string, string> = {};
  for (const device of LAYOUT_DEVICES) {
    const values = layout?.[device];
    if (!values) continue;
    for (const key of LAYOUT_KEYS) {
      const v = values[key];
      if (v) out[`--l-${DEVICE_LETTER[device]}-${LAYOUT_VAR[key]}`] = key === "aspectRatio" ? v.replace(/\s+/g, " ") : v;
    }
  }
  return out as CSSProperties;
}

/** True when any device sets an aspect ratio (the widget's own height must then give way to it). */
export function layoutHasAspectRatio(layout: Layout | undefined): boolean {
  return LAYOUT_DEVICES.some((d) => Boolean(layout?.[d]?.aspectRatio));
}

/** The value a device shows when it sets nothing: what it inherits from the larger devices. */
export function inheritedLayoutValue(layout: Layout | undefined, device: LayoutDevice, key: LayoutKey): string | undefined {
  const order: LayoutDevice[] = device === "mobile" ? ["tablet", "desktop"] : device === "tablet" ? ["desktop"] : [];
  for (const d of order) {
    const v = layout?.[d]?.[key];
    if (v) return v;
  }
  return undefined;
}
