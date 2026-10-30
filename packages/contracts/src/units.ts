/**
 * Weight units (ADR-040). Weight is stored as integer grams (`variants.weight_grams`, shipping weight tiers).
 * The unit system only changes how weight is entered and shown; convert at the edge, never store a display unit.
 */

export const UNIT_SYSTEMS = ["metric", "imperial"] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export const WEIGHT_UNITS = ["g", "kg", "oz", "lb"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

const GRAMS_PER_UNIT: Readonly<Record<WeightUnit, number>> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/** Decimal places kept when a person types a value (grams are whole numbers). */
const INPUT_DECIMALS: Readonly<Record<WeightUnit, number>> = { g: 0, kg: 3, oz: 2, lb: 3 };

export function unitsForSystem(system: UnitSystem): readonly WeightUnit[] {
  return system === "imperial" ? ["oz", "lb"] : ["g", "kg"];
}

export function defaultWeightUnit(system: UnitSystem): WeightUnit {
  return system === "imperial" ? "lb" : "kg";
}

export function isWeightUnit(value: unknown): value is WeightUnit {
  return typeof value === "string" && (WEIGHT_UNITS as readonly string[]).includes(value);
}

export function systemOfUnit(unit: WeightUnit): UnitSystem {
  return unit === "oz" || unit === "lb" ? "imperial" : "metric";
}

/** Grams to a number in `unit`, rounded to what a person would type (kg 3 dp, lb 3 dp, oz 2 dp, g whole). */
export function gramsToUnit(grams: number, unit: WeightUnit): number {
  const decimals = INPUT_DECIMALS[unit];
  const value = grams / GRAMS_PER_UNIT[unit];
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** A value typed in `unit` to whole grams, which is what we store. */
export function unitToGrams(value: number, unit: WeightUnit): number {
  return Math.round(value * GRAMS_PER_UNIT[unit]);
}

/** "1.5 kg", "3.31 lb". Trims trailing zeros. */
export function formatWeight(grams: number, unit: WeightUnit, locale = "en-US"): string {
  const n = gramsToUnit(grams, unit);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: INPUT_DECIMALS[unit] }).format(n)} ${unit}`;
}

/**
 * Pick a sensible unit to show: metric shows g under 1 kg and kg above; imperial shows oz under 1 lb and lb above.
 * Used for read-only displays (cart weight, shipping tier labels). Forms use the store's chosen unit.
 */
export function autoWeightUnit(grams: number, system: UnitSystem): WeightUnit {
  if (system === "imperial") return grams < GRAMS_PER_UNIT.lb ? "oz" : "lb";
  return grams < 1000 ? "g" : "kg";
}
