/**
 * Client-side preview of what the variant builder will do (the server decides, see
 * packages/domain/src/catalog/variant-options.ts). Used to show "this will add N variants" before applying.
 */
export const MAX_OPTIONS = 3;
export const MAX_VALUES = 30;
export const MAX_VARIANTS = 250;

export interface DraftOption {
  name: string;
  values: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Same cleaning the server applies: trim, drop empty and case-insensitive duplicate values. */
export function cleanOptions(options: DraftOption[]): DraftOption[] {
  return options.map((o) => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const raw of o.values) {
      const v = clean(raw);
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      values.push(v);
    }
    return { name: clean(o.name), values };
  });
}

export function optionCombinations(options: DraftOption[]): Array<Record<string, string>> {
  if (options.length === 0) return [];
  let combos: Array<Record<string, string>> = [{}];
  for (const opt of options) {
    const next: Array<Record<string, string>> = [];
    for (const base of combos) for (const value of opt.values) next.push({ ...base, [opt.name]: value });
    combos = next;
  }
  return combos;
}

export function sameCombo(a: Record<string, string> | null | undefined, b: Record<string, string> | null | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a as Record<string, string>)[k] === (b as Record<string, string> | undefined)?.[k]);
}

export interface GridPreview {
  error: string | null;
  total: number;
  /** Variants the apply step will add. */
  toCreate: number;
}

/** What applying these options would do to a product that currently has `existing` variants. */
export function previewGrid(options: DraftOption[], existing: Array<{ optionValues?: Record<string, string> | null | undefined }>): GridPreview {
  const cleaned = cleanOptions(options);
  if (cleaned.length > MAX_OPTIONS) return { error: `At most ${MAX_OPTIONS} options`, total: 0, toCreate: 0 };
  const names = new Set<string>();
  for (const o of cleaned) {
    if (!o.name) return { error: "Every option needs a name", total: 0, toCreate: 0 };
    if (names.has(o.name.toLowerCase())) return { error: `"${o.name}" is listed twice`, total: 0, toCreate: 0 };
    names.add(o.name.toLowerCase());
    if (o.values.length === 0) return { error: `"${o.name}" needs at least one value`, total: 0, toCreate: 0 };
    if (o.values.length > MAX_VALUES) return { error: `"${o.name}" can have at most ${MAX_VALUES} values`, total: 0, toCreate: 0 };
  }
  const combos = optionCombinations(cleaned);
  if (combos.length > MAX_VARIANTS) return { error: `That makes ${combos.length} variants; the limit is ${MAX_VARIANTS}`, total: combos.length, toCreate: 0 };

  const matched = new Set<number>();
  let unmatchedCombos = 0;
  for (const combo of combos) {
    const idx = existing.findIndex((v, i) => !matched.has(i) && sameCombo(v.optionValues ?? null, combo));
    if (idx >= 0) matched.add(idx);
    else unmatchedCombos += 1;
  }
  const hadNoOptions = existing.every((v) => !v.optionValues || Object.keys(v.optionValues).length === 0);
  if (combos.length > 0 && hadNoOptions && existing.length === 1 && unmatchedCombos > 0) unmatchedCombos -= 1; // the one variant is reused
  if (existing.length + unmatchedCombos > MAX_VARIANTS) return { error: `That would give the product more than ${MAX_VARIANTS} variants`, total: combos.length, toCreate: unmatchedCombos };
  return { error: null, total: combos.length, toCreate: unmatchedCombos };
}
