/**
 * How a product's existing variants line up with a new set of options (the variant builder). Pure, so the server
 * (`setProductOptions`) and the admin preview ("N new will be added") use the same rules and never disagree.
 */

export interface GridOption {
  name: string;
  values: string[];
}

export interface GridVariant {
  optionValues?: Record<string, string> | null | undefined;
}

export interface VariantGridPlan {
  /** Existing variants (by index) that take a combination. `changed` means their option values must be rewritten. */
  assigned: Array<{ index: number; combo: Record<string, string>; changed: boolean }>;
  /** Combinations no existing variant takes: new variants. */
  toCreate: Array<Record<string, string>>;
}

/** Every combination of option values, first option varying slowest: [{Size:S,Color:Red},{Size:S,Color:Blue},...]. */
export function gridCombinations(options: GridOption[]): Array<Record<string, string>> {
  if (options.length === 0) return [];
  let combos: Array<Record<string, string>> = [{}];
  for (const opt of options) {
    const next: Array<Record<string, string>> = [];
    for (const base of combos) for (const value of opt.values) next.push({ ...base, [opt.name]: value });
    combos = next;
  }
  return combos;
}

/** True when both describe exactly the same option values (names and values compared as written). */
export function sameGridCombo(a: Record<string, string> | null | undefined, b: Record<string, string> | null | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a as Record<string, string>)[k] === (b as Record<string, string> | undefined)?.[k]);
}

/**
 * 1. A variant whose values are exactly a combination keeps it.
 * 2. A product that had no options and one variant: that variant becomes the first combination.
 * 3. A variant that agrees with a free combination on every option it has a value for takes it. This is what happens
 *    when an option is added (Colour, then Size): "Red" becomes "Red / S" instead of being left behind next to a new
 *    "Red / S". Left behind, it matches no picker on the storefront, which then has to fall back to one combined list
 *    (apps/web/src/lib/buy-model.ts). A variant with a value that is no longer offered is never moved to another value.
 * 4. Combinations nobody took become new variants. Variants that took nothing are left alone (never deleted here).
 */
export function planVariantGrid(options: GridOption[], existing: GridVariant[]): VariantGridPlan {
  const combos = gridCombinations(options);
  const taken = new Set<number>(); // combo indexes
  const used = new Set<number>(); // variant indexes
  const assigned: VariantGridPlan["assigned"] = [];
  const take = (index: number, ci: number, changed: boolean) => {
    taken.add(ci);
    used.add(index);
    assigned.push({ index, combo: combos[ci] as Record<string, string>, changed });
  };

  combos.forEach((combo, ci) => {
    const index = existing.findIndex((v, i) => !used.has(i) && sameGridCombo(v.optionValues, combo));
    if (index >= 0) take(index, ci, false);
  });

  const hadNoOptions = existing.every((v) => !v.optionValues || Object.keys(v.optionValues).length === 0);
  if (hadNoOptions && existing.length === 1 && !used.has(0)) {
    const ci = combos.findIndex((_, i) => !taken.has(i));
    if (ci >= 0) take(0, ci, true);
  }

  existing.forEach((v, index) => {
    if (used.has(index)) return;
    const values = v.optionValues ?? {};
    const fixed: Record<string, string> = {};
    for (const o of options) {
      const value = values[o.name];
      if (value === undefined) continue; // an option the variant has no value for yet (just added)
      if (!o.values.includes(value)) return; // its value is no longer offered: leave it outside the grid
      fixed[o.name] = value;
    }
    if (Object.keys(fixed).length === 0) return;
    const ci = combos.findIndex((c, i) => !taken.has(i) && Object.entries(fixed).every(([k, val]) => c[k] === val));
    if (ci >= 0) take(index, ci, true);
  });

  return { assigned, toCreate: combos.filter((_, i) => !taken.has(i)) };
}
