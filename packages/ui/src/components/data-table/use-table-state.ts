import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import { PAGE_SIZES } from "./pagination.tsx";

export interface SearchStateAdapter {
  useSearch: () => Record<string, unknown>;
  useNavigate: () => (patch: Record<string, unknown>) => void;
}

const SearchStateContext = createContext<SearchStateAdapter | null>(null);

export const SearchStateProvider = SearchStateContext.Provider;

/**
 * Table state that lives in the URL (?q=…&page=2) so back/forward, reloads and shared links keep it.
 * Pass the page's own `parse` so raw search params are always coerced to a valid shape.
 * If a custom `adapter` is passed or provided via SearchStateProvider, it is used instead of window.location.
 */
export function useUrlTableState<S extends object>(
  parse: (raw: Record<string, unknown>) => S,
  customAdapter?: SearchStateAdapter
) {
  const contextAdapter = useContext(SearchStateContext);
  const adapter = customAdapter || contextAdapter;

  // Fallback to browser URL search params if no adapter (e.g. TanStack Router or Next.js) is provided
  const [browserParams, setBrowserParams] = useState<Record<string, unknown>>(() => {
    if (typeof window === "undefined") return {};
    return Object.fromEntries(new URLSearchParams(window.location.search).entries());
  });

  useEffect(() => {
    if (adapter) return;
    const onPopState = () => {
      setBrowserParams(Object.fromEntries(new URLSearchParams(window.location.search).entries()));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [adapter]);

  const raw = adapter ? adapter.useSearch() : browserParams;
  const navigateFn = adapter ? adapter.useNavigate() : null;
  const state = useMemo(() => parse(raw), [raw, parse]);

  const update = useCallback(
    (patch: Partial<Record<keyof S, unknown>>) => {
      if (navigateFn) {
        navigateFn(patch as Record<string, unknown>);
        return;
      }
      if (typeof window === "undefined") return;
      const current = Object.fromEntries(new URLSearchParams(window.location.search).entries());
      const next = Object.fromEntries(
        Object.entries({ ...current, ...patch }).filter(
          ([, v]) => v !== undefined && v !== "" && (v as unknown) !== false
        )
      );
      const url = new URL(window.location.href);
      url.search = new URLSearchParams(next as Record<string, string>).toString();
      window.history.replaceState({}, "", url.toString());
      setBrowserParams(next);
    },
    [navigateFn]
  );

  return [state, update] as const;
}

/** Search box that updates after a short pause so each keystroke is not a server request. */
export function useDebouncedValue(value: string, onCommit: (v: string) => void, delay = 300) {
  const [text, setText] = useState(value);
  // Follow external changes (Clear filters, back button) without an effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onCommit(text), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return [text, setText] as const;
}

/** Which optional columns are shown, remembered per table in localStorage. */
export function useColumnVisibility(tableId: string, optional: ReadonlyArray<{ id: string; defaultHidden?: boolean }>) {
  const key = `table:${tableId}:hidden`;
  const defaults = useMemo(() => optional.filter((c) => c.defaultHidden).map((c) => c.id), [optional]);
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? (JSON.parse(saved) as string[]) : defaults;
    } catch {
      return defaults;
    }
  });
  const persist = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode: keep it in memory */
    }
  };
  return {
    isVisible: (id: string) => !hidden.includes(id),
    toggle: (id: string) => persist(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]),
    reset: () => persist(defaults),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers for turning raw address-bar values into valid table state
// ---------------------------------------------------------------------------------------------------------------

export const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
export const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** yyyy-MM-dd or nothing. */
export const day = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
export const flag = (v: unknown): true | undefined => (v === true || v === "true" || v === 1 || v === "1" ? true : undefined);

/** `page` (1-based) and `size` (one of the allowed page sizes) with safe defaults. */
export function parsePaging(raw: Record<string, unknown>): { page: number; size: number } {
  const page = Math.floor(Number(raw["page"]));
  const size = Number(raw["size"]);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
  };
}

/** Local midnight at the start of a yyyy-MM-dd day, as an ISO string for the API. */
export const dayStartIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
/** Local midnight at the start of the day AFTER yyyy-MM-dd (an exclusive upper bound that includes the whole day). */
export const dayAfterIso = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return x.toISOString();
};

/** Drops empty values and the defaults so URLs stay short (used by each page's validateSearch). */
export function compactSearch<S extends object>(s: S, defaults: Partial<Record<keyof S, unknown>>): Partial<S> {
  return Object.fromEntries(
    Object.entries(s).filter(([k, v]) => v !== undefined && v !== "" && v !== false && v !== defaults[k as keyof S]),
  ) as Partial<S>;
}
