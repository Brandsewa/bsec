import type { ProductStatePricing } from "@bs/contracts";
import { toCsv } from "./csv.ts";

/** The most state columns shown inline; further states open in a popup per variant. */
export const MAX_INLINE_STATES = 10;

export interface StateOption {
  code: string;
  name: string;
}

/** What the merchant typed ("1,299.50", "₹ 900") as paise, or null when empty or not a positive amount with at most 2 decimals. */
export function toMinor(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, "");
  if (clean === "" || !/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const n = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Paise as the text shown in a cell: 90000 -> "900", 95050 -> "950.5". */
export function toMajor(minor: number): string {
  return String(minor / 100);
}

/** null when the cell text is fine (empty means "no state price"), otherwise the problem. */
export function cellProblem(text: string): string | null {
  if (text.trim() === "") return null;
  return toMinor(text) === null ? "Enter an amount above zero, with at most 2 decimals" : null;
}

export const editKey = (variantId: string, state: string) => `${variantId}:${state}`;

/** The saved text for a cell (empty when the state follows the default price). */
export function savedText(prices: Record<string, { price: number }>, state: string): string {
  const p = prices[state];
  return p ? toMajor(p.price) : "";
}

export interface PendingChange {
  variantId: string;
  state: string;
  /** null removes the state price. */
  price: number | null;
}

/**
 * Turns the edits into changes to send. `known` holds the saved prices of every variant the user has seen; an edit for a
 * variant that was never loaded (a CSV import) is always sent. Returns the first invalid cell instead when one exists.
 */
export function buildChanges(
  edits: Readonly<Record<string, string>>,
  known: ReadonlyMap<string, Record<string, { price: number }>>,
): { changes: PendingChange[]; invalid: string | null } {
  const changes: PendingChange[] = [];
  for (const [key, text] of Object.entries(edits)) {
    const [variantId, state] = key.split(":") as [string, string];
    const saved = known.get(variantId);
    if (saved && savedText(saved, state) === text.trim()) continue;
    if (text.trim() === "") {
      if (saved && !saved[state]) continue;
      changes.push({ variantId, state, price: null });
      continue;
    }
    const minor = toMinor(text);
    if (minor === null) return { changes: [], invalid: key };
    if (saved && saved[state]?.price === minor) continue;
    changes.push({ variantId, state, price: minor });
  }
  return { changes, invalid: null };
}

/** The Excel-style sheet: SKU, Product Name, Variant, Default Price, then one column per state. */
export function buildExportCsv(products: ProductStatePricing[], states: StateOption[], stateCodes: string[]): string {
  const names = stateCodes.map((c) => states.find((s) => s.code === c)?.name ?? c);
  const rows = products.flatMap((p) =>
    p.variants.map((v) => [v.sku ?? "", p.productTitle, v.title, toMajor(v.basePrice), ...stateCodes.map((c) => savedText(v.prices, c))]),
  );
  return toCsv(["SKU", "Product Name", "Variant", "Default Price", ...names], rows);
}

export interface ImportPlan {
  /** Edits ready to merge into the grid: key (variantId:state) -> text. */
  edits: Record<string, string>;
  /** State codes the file has columns for. */
  stateCodes: string[];
  rowsMatched: number;
  unmatchedSkus: string[];
  /** Cells that are not a valid price, as "SKU / State". */
  badCells: string[];
  ignoredColumns: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

/**
 * Reads an uploaded sheet (rows from parseCsv). Needs a SKU column; every other column whose header is a state name
 * becomes that state. Default Price, Product Name and Variant are ignored (the default price is edited in the catalog).
 * An empty cell leaves the state as it is; to remove a state price, clear the cell in the grid.
 */
export function planImport(rows: string[][], states: StateOption[], skuToVariantId: ReadonlyMap<string, string>): ImportPlan {
  const header = (rows[0] ?? []).map((h) => h.trim());
  const skuCol = header.findIndex((h) => norm(h) === "sku");
  if (skuCol < 0) throw new Error("The first row needs a SKU column");
  const byName = new Map(states.map((s) => [norm(s.name), s.code]));
  const cols: { index: number; code: string }[] = [];
  const ignoredColumns: string[] = [];
  header.forEach((h, index) => {
    if (index === skuCol || h === "") return;
    const code = byName.get(norm(h));
    if (code) cols.push({ index, code });
    else ignoredColumns.push(h);
  });
  const edits: Record<string, string> = {};
  const unmatched = new Set<string>();
  const bad: string[] = [];
  let rowsMatched = 0;
  for (const row of rows.slice(1)) {
    const sku = (row[skuCol] ?? "").trim();
    if (!sku) continue;
    const variantId = skuToVariantId.get(sku);
    if (!variantId) {
      unmatched.add(sku);
      continue;
    }
    rowsMatched += 1;
    for (const { index, code } of cols) {
      const text = (row[index] ?? "").trim();
      if (text === "") continue;
      if (toMinor(text) === null) bad.push(`${sku} / ${code}`);
      else edits[editKey(variantId, code)] = text;
    }
  }
  return { edits, stateCodes: cols.map((c) => c.code), rowsMatched, unmatchedSkus: [...unmatched], badCells: bad, ignoredColumns };
}
