/**
 * Pure rules for the variant builder (owner request 2026-10-17): which option sets are allowed and which variants
 * they produce. Kept free of database access so it can be tested on its own.
 */

export const MAX_PRODUCT_OPTIONS = 3;
export const MAX_VALUES_PER_OPTION = 30;
export const MAX_VARIANTS_PER_PRODUCT = 250;
const MAX_NAME_LENGTH = 40;

export interface OptionInput {
  name: string;
  values: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Trims, removes empty and duplicate (case-insensitive) values, and enforces the limits: at most 3 options, 30 values
 * per option and 250 resulting variants. Throws a "Bad Request" error with a plain message otherwise.
 */
export function normalizeOptions(options: OptionInput[]): OptionInput[] {
  if (options.length > MAX_PRODUCT_OPTIONS) {
    throw new Error(`Bad Request: a product can have at most ${MAX_PRODUCT_OPTIONS} options`);
  }
  const seenNames = new Set<string>();
  const out: OptionInput[] = [];
  for (const raw of options) {
    const name = clean(raw.name);
    if (!name) throw new Error("Bad Request: every option needs a name");
    if (name.length > MAX_NAME_LENGTH) throw new Error(`Bad Request: option names can be at most ${MAX_NAME_LENGTH} characters`);
    if (seenNames.has(name.toLowerCase())) throw new Error(`Bad Request: the option "${name}" is listed twice`);
    seenNames.add(name.toLowerCase());

    const seenValues = new Set<string>();
    const values: string[] = [];
    for (const v of raw.values) {
      const value = clean(v);
      if (!value) continue;
      if (value.length > MAX_NAME_LENGTH) throw new Error(`Bad Request: option values can be at most ${MAX_NAME_LENGTH} characters`);
      if (seenValues.has(value.toLowerCase())) continue;
      seenValues.add(value.toLowerCase());
      values.push(value);
    }
    if (values.length === 0) throw new Error(`Bad Request: the option "${name}" needs at least one value`);
    if (values.length > MAX_VALUES_PER_OPTION) throw new Error(`Bad Request: "${name}" can have at most ${MAX_VALUES_PER_OPTION} values`);
    out.push({ name, values });
  }
  const total = out.reduce((n, o) => n * o.values.length, out.length > 0 ? 1 : 0);
  if (total > MAX_VARIANTS_PER_PRODUCT) {
    throw new Error(`Bad Request: these options make ${total} variants, but a product can have at most ${MAX_VARIANTS_PER_PRODUCT}`);
  }
  return out;
}

/** Every combination of option values, first option varying slowest: [{Size:S,Color:Red},{Size:S,Color:Blue},...]. */
export function optionCombinations(options: OptionInput[]): Array<Record<string, string>> {
  if (options.length === 0) return [];
  let combos: Array<Record<string, string>> = [{}];
  for (const opt of options) {
    const next: Array<Record<string, string>> = [];
    for (const base of combos) {
      for (const value of opt.values) next.push({ ...base, [opt.name]: value });
    }
    combos = next;
  }
  return combos;
}

/** "Small / Red": the variant title for a combination, in option order. */
export function comboTitle(combo: Record<string, string>, options: OptionInput[]): string {
  return options.map((o) => combo[o.name]).filter((v): v is string => Boolean(v)).join(" / ");
}

/** True when both describe exactly the same option values (names and values compared as written). */
export function sameCombo(a: Record<string, string> | null | undefined, b: Record<string, string> | null | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a as Record<string, string>)[k] === (b as Record<string, string> | undefined)?.[k]);
}

/** Next free SKU "<base>-<n>" that is not in `taken` (compared case-insensitively). */
export function nextSku(base: string, taken: Set<string>): string {
  const root = base.trim() || "SKU";
  let n = 1;
  let candidate = `${root}-${n}`;
  while (taken.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
