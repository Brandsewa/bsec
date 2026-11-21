import type { PuckItem } from "@bs/blocks";

/**
 * The builder's section clipboard. It holds one copied element (a Section, Container or any widget) with
 * everything inside it, as plain JSON: the stored props are the whole element (content, styles, responsive
 * settings), so a paste rebuilds it exactly rather than copying how it looks. It lives at module level so it
 * survives switching pages in a multi-page workspace, and is mirrored to localStorage so a reload keeps it.
 */

const STORAGE_KEY = "bs:builder-clipboard:v2";

/**
 * What is on the clipboard: one element ("item", from a section's own Copy button or the context menu) or every
 * top-level section of a page ("page", from the Outline's Copy-all button). Both are lists of elements so paste
 * treats them alike.
 */
export interface Clip {
  kind: "item" | "page";
  items: PuckItem[];
}

let current: Clip | null = readStored();
const listeners = new Set<() => void>();

const isEl = (v: unknown): v is PuckItem => {
  if (!v || typeof v !== "object") return false;
  const o = v as { type?: unknown; props?: unknown };
  return typeof o.type === "string" && !!o.props && typeof (o.props as { id?: unknown }).id === "string";
};

function readStored(): Clip | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Clip;
    return parsed && (parsed.kind === "item" || parsed.kind === "page") && Array.isArray(parsed.items) && parsed.items.length > 0 && parsed.items.every(isEl) ? parsed : null;
  } catch {
    return null;
  }
}

export function getClipboard(): Clip | null {
  return current;
}

export function subscribeClipboard(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setClipboard(clip: Clip | null): void {
  current = clip && clip.items.length > 0 ? (JSON.parse(JSON.stringify(clip)) as Clip) : null;
  try {
    if (current) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be blocked: the in-memory copy still works */
  }
  listeners.forEach((l) => l());
}

const defaultId = (type: string) => `${type}-${globalThis.crypto.randomUUID()}`;

/**
 * A deep copy of an element in which it, and every element nested inside it, gets a new unique id (Puck keys the
 * canvas, the outline and the selection by these ids, so a duplicate would collide). Everything else is copied as is.
 */
export function cloneWithNewIds<T>(value: T, makeId: (type: string) => string = defaultId): T {
  if (Array.isArray(value)) return value.map((v) => cloneWithNewIds(v, makeId)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneWithNewIds(v, makeId);
    if (isEl(value)) (out.props as Record<string, unknown>).id = makeId(value.type);
    return out as T;
  }
  return value;
}

/** How many elements are nested inside `item` (not counting itself). */
export function countNested(item: unknown): number {
  let n = 0;
  const walk = (v: unknown, root: boolean) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, false));
    if (v && typeof v === "object") {
      if (!root && isEl(v)) n += 1;
      Object.values(v as Record<string, unknown>).forEach((x) => walk(x, false));
    }
  };
  walk(item, true);
  return n;
}

const ROOT = "root:default-zone";

/**
 * Returns `content` (a page's element list) with `item` inserted at `index` of `zone`. A zone is Puck's key for a
 * list of elements: the page itself ("root:default-zone") or a slot of an element ("<element id>:<prop name>").
 * Pure, so it can be tested without the editor; returns null when the zone does not exist.
 */
export function insertIntoZone(content: PuckItem[], zone: string, index: number, item: PuckItem): PuckItem[] | null {
  if (zone === ROOT) {
    const next = content.slice();
    next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
    return next;
  }
  const sep = zone.lastIndexOf(":");
  const parentId = zone.slice(0, sep);
  const prop = zone.slice(sep + 1);
  let found = false;
  const walk = (items: PuckItem[]): PuckItem[] =>
    items.map((it) => {
      if (it.props.id === parentId) {
        const list = it.props[prop];
        if (!Array.isArray(list)) return it;
        found = true;
        const next = (list as PuckItem[]).slice();
        next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
        return { ...it, props: { ...it.props, [prop]: next } };
      }
      const props: Record<string, unknown> = { ...it.props };
      let changed = false;
      for (const [k, v] of Object.entries(it.props)) {
        if (Array.isArray(v) && v.length > 0 && v.every(isEl)) {
          const inner = walk(v as PuckItem[]);
          if (inner.some((x, i) => x !== v[i])) {
            props[k] = inner;
            changed = true;
          }
        }
      }
      return changed ? ({ ...it, props } as PuckItem) : it;
    });
  const next = walk(content);
  return found ? next : null;
}

/** The element with this id anywhere in the page (any depth), or null. */
export function findById(content: PuckItem[], id: string): PuckItem | null {
  let hit: PuckItem | null = null;
  const walk = (v: unknown) => {
    if (hit) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      if (isEl(v) && v.props.id === id) {
        hit = v;
        return;
      }
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(content);
  return hit;
}

/**
 * Where a pasted list of sections goes on the page level: right after the top-level section that holds the
 * selection (the selection itself when it is top level), or the end of the page when nothing is selected.
 */
export function topLevelInsertIndex(content: PuckItem[], selection: { zone: string; index: number } | null): number {
  if (!selection) return content.length;
  if (selection.zone === ROOT) return Math.min(selection.index + 1, content.length);
  const parentId = selection.zone.slice(0, selection.zone.lastIndexOf(":"));
  const at = content.findIndex((top) => findById([top], parentId));
  return at === -1 ? content.length : at + 1;
}
