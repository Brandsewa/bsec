import { useMemo, useState } from "react";

/**
 * Row selection for a server-paged table.
 * - Ticked rows are remembered across pages (as whole rows, so they can be exported later).
 * - "All results" means every row matching the current filters, not just the ones loaded.
 * - Selection resets by itself when `resetKey` changes (i.e. the filters changed and the result set is different).
 */
export function useTableSelection<T>({
  rows,
  getId,
  total,
  resetKey,
}: {
  rows: T[];
  getId: (row: T) => string;
  total: number;
  resetKey: string;
}) {
  const [picked, setPicked] = useState<Map<string, T>>(new Map());
  const [allResults, setAllResults] = useState(false);

  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setPicked(new Map());
    setAllResults(false);
  }

  const selectedIds = useMemo(() => new Set(allResults ? rows.map(getId) : picked.keys()), [allResults, rows, picked, getId]);
  const pageFullySelected = rows.length > 0 && rows.every((r) => selectedIds.has(getId(r)));

  function toggleRow(row: T, on: boolean) {
    // Leaving "all results" keeps exactly the rows that were ticked on screen.
    const base = allResults ? new Map(rows.map((r) => [getId(r), r] as const)) : new Map(picked);
    if (on) base.set(getId(row), row);
    else base.delete(getId(row));
    setAllResults(false);
    setPicked(base);
  }

  function togglePage(pageRows: T[], on: boolean) {
    const base = allResults ? new Map<string, T>() : new Map(picked);
    for (const r of pageRows) {
      if (on) base.set(getId(r), r);
      else base.delete(getId(r));
    }
    setAllResults(false);
    setPicked(base);
  }

  return {
    selectedIds,
    /** The ticked rows (empty in "all results" mode, where only the filters are known). */
    picked: [...picked.values()],
    count: allResults ? total : picked.size,
    allResults,
    selectAllResults: () => setAllResults(true),
    pageFullySelected,
    toggleRow,
    togglePage,
    clear: () => {
      setPicked(new Map());
      setAllResults(false);
    },
    /** Drop rows whose action succeeded so only the failures stay ticked. */
    release: (ids: Iterable<string>) =>
      setPicked((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      }),
  };
}
