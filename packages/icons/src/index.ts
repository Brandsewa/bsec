import { LUCIDE_NAMES } from "./generated/names.ts";

/**
 * Lightweight half of @bs/icons: the allowlist of Lucide icon names and name resolution. It never imports the
 * SVG data, so schemas, the editor and client code can validate a name for ~8 KB gzip. Drawing is in ./server,
 * the searchable picker catalog in ./catalog.
 */
export const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NAME_SET: ReadonlySet<string> = new Set(LUCIDE_NAMES);

/** Names stored by documents written before Lucide (the old hand-drawn set) and the PascalCase names of seeded pages. */
const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  returns: "rotate-ccw",
  support: "headphones",
  cart: "shopping-cart",
  cup: "coffee",
  help: "circle-question-mark",
};

/** Stroke weights a merchant can pick (ADR-041). Stored as a suffix on the icon name ("truck:bold"); no suffix means regular. */
export const ICON_WEIGHTS = { thin: 1.25, regular: 1.75, bold: 2.25 } as const;
export type IconWeight = keyof typeof ICON_WEIGHTS;

/** Splits a stored value into its icon part and weight. An unknown suffix counts as regular. */
export function splitIconValue(value: string): { icon: string; weight: IconWeight } {
  const i = value.lastIndexOf(":");
  if (i < 0) return { icon: value, weight: "regular" };
  const w = value.slice(i + 1);
  return { icon: value.slice(0, i), weight: w === "thin" || w === "bold" ? w : "regular" };
}

/** Weight "theme" stores no suffix: the icon then follows the theme's icon weight. Any other weight is an explicit choice. */
export const formatIconValue = (name: string, weight: IconWeight | "theme"): string => (weight === "theme" ? name : `${name}:${weight}`);

/** Stroke width stored on the value, or undefined when it follows the theme. */
export function strokeOf(value: string): number | undefined {
  const i = value.lastIndexOf(":");
  if (i < 0) return undefined;
  const w = value.slice(i + 1);
  return w === "thin" || w === "bold" || w === "regular" ? ICON_WEIGHTS[w] : undefined;
}

/** Maps any stored icon string (legacy, PascalCase or Lucide kebab-case) to a Lucide name, or null if it is not one. */
export function resolveIconName(value: string | undefined | null): string | null {
  if (!value || value.length > 64) return null;
  const kebab = splitIconValue(value.trim()).icon.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  // A real Lucide name always wins over a legacy alias (e.g. "shield" is now Lucide's plain shield).
  if (NAME_SET.has(kebab)) return kebab;
  const legacy = Object.hasOwn(LEGACY_ALIASES, kebab) ? LEGACY_ALIASES[kebab] : undefined;
  return legacy && NAME_SET.has(legacy) ? legacy : null;
}

export function isIconName(value: unknown): value is string {
  return typeof value === "string" && resolveIconName(value) !== null;
}

export const ICON_COUNT = LUCIDE_NAMES.length;
export { LUCIDE_NAMES };
