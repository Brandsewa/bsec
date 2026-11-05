import { useCallback, useState } from "react";
import { toMinorUnits, toMajorUnits } from "@bs/contracts/money";

/**
 * Edit state for the bulk editors. Edits are kept as raw cell values (text as typed, booleans, string lists) keyed
 * `${targetId}|${field}`; a cell whose value equals what is saved holds no edit. Parsing and validation happen when
 * the patch is built, so typing "12." never fights the input. Undo and redo walk snapshots of the edit map.
 */
export type CellValue = string | boolean | string[];
export type Edits = Readonly<Record<string, CellValue>>;

export const editKey = (target: string, field: string) => `${target}|${field}`;

const same = (a: CellValue, b: CellValue) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b);

interface History {
  edits: Edits;
  past: Edits[];
  future: Edits[];
}

/** Applies one change to a copy of the map: set a value, or drop the key when it equals what is saved. */
function applied(cur: Edits, key: string, value: CellValue | undefined, saved: CellValue): Edits {
  const rest = Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key));
  return value === undefined || same(value, saved) ? rest : { ...rest, [key]: value };
}

export function useEdits() {
  const [h, setH] = useState<History>({ edits: {}, past: [], future: [] });
  const { edits } = h;

  const commit = useCallback((fn: (cur: Edits) => Edits) => {
    setH((c) => ({ edits: fn(c.edits), past: [...c.past.slice(-99), c.edits], future: [] }));
  }, []);

  return {
    edits,
    /** Current value of a cell: the edit if there is one, else what is saved. */
    get<T extends CellValue>(target: string, field: string, saved: T): T {
      const v = edits[editKey(target, field)];
      return (v === undefined ? saved : v) as T;
    },
    isDirty: (target: string, field: string) => edits[editKey(target, field)] !== undefined,
    set(target: string, field: string, value: CellValue, saved: CellValue) {
      commit((cur) => applied(cur, editKey(target, field), value, saved));
    },
    /** Set many cells at once (paste, "set all"). Counts as one undo step. */
    setMany(entries: Array<{ target: string; field: string; value: CellValue; saved: CellValue }>) {
      commit((cur) => entries.reduce((acc, e) => applied(acc, editKey(e.target, e.field), e.value, e.saved), cur));
    },
    revert(target: string, field: string) {
      commit((cur) => applied(cur, editKey(target, field), undefined, ""));
    },
    clear() {
      commit(() => ({}));
    },
    /** Keep only the edits of records that failed to save. */
    keepOnly(targets: ReadonlySet<string>) {
      commit((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => targets.has(k.split("|")[0] ?? ""))));
    },
    count: Object.keys(edits).length,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    undo() {
      setH((c) => {
        const prev = c.past[c.past.length - 1];
        return prev ? { edits: prev, past: c.past.slice(0, -1), future: [...c.future, c.edits] } : c;
      });
    },
    redo() {
      setH((c) => {
        const nxt = c.future[c.future.length - 1];
        return nxt ? { edits: nxt, past: [...c.past, c.edits], future: c.future.slice(0, -1) } : c;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** "1,299.50" -> minor units. Empty is `null` (clears an optional price). */
export function parseMoney(text: string, currency: string): Parsed<number | null> {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: "Enter an amount like 499 or 499.50" };
  return { ok: true, value: toMinorUnits(Number(t), currency) };
}

export const formatMoneyText = (minor: number | null | undefined, currency: string) => (minor == null ? "" : String(toMajorUnits(minor, currency)));

export function parseWhole(text: string, max: number): Parsed<number | null> {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, error: "Whole numbers only" };
  const n = Number(t);
  return n > max ? { ok: false, error: `Up to ${max.toLocaleString("en-IN")}` } : { ok: true, value: n };
}

export function parseDecimal(text: string, max: number): Parsed<number | null> {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Numbers only" };
  const n = Number(t);
  return n > max ? { ok: false, error: `Up to ${max}` } : { ok: true, value: n };
}

export const parseTags = (text: string) => [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Plain description stored by the product page: `{ type: "text", text }`. */
export function descriptionText(json: unknown): string {
  if (typeof json === "string") return json;
  if (json && typeof json === "object" && "text" in json && typeof (json as { text: unknown }).text === "string") return (json as { text: string }).text;
  return "";
}

/** Sets or clears a text field, returning the same object shape the API takes. */
export const seoOf = (seo: unknown): { title: string; description: string } => {
  const s = (seo ?? {}) as { title?: string | null; description?: string | null };
  return { title: s.title ?? "", description: s.description ?? "" };
};
