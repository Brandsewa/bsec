"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Review } from "@bs/contracts";
import { CloseButton, Overlay, ReviewCard } from "./reviews-shared.tsx";

const PAGE_SIZE = 10;

const SORTS = [
  { value: "latest", label: "Latest" },
  { value: "oldest", label: "Oldest" },
  { value: "highest", label: "Highest rated" },
  { value: "lowest", label: "Lowest rated" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

interface Page {
  items: Review[];
  matching: number;
}

/**
 * Every review in a side drawer, with sorting (latest, oldest, highest or lowest rated) and a star filter. Both are applied by the
 * server, so "Load more" pages keep one consistent order. Changing either starts again from page 1.
 */
export function ReviewsDrawer({ productId, ratingAvg, total, onClose }: { productId: string; ratingAvg: number; total: number; onClose: () => void }) {
  const [sort, setSort] = useState<Sort>("latest");
  const [stars, setStars] = useState(0);
  const [items, setItems] = useState<Review[]>([]);
  const [matching, setMatching] = useState(total);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Which request is current: a slow answer for an older sort or filter must not overwrite a newer one.
  const latest = useRef(0);

  const fetchPage = useCallback(
    async (n: number, s: Sort, st: number): Promise<Page | null> => {
      const q = new URLSearchParams({ page: String(n), limit: String(PAGE_SIZE), sort: s, ...(st ? { rating: String(st) } : {}) });
      const res = await fetch(`/api/storefront/products/${encodeURIComponent(productId)}/reviews?${q}`);
      return res.ok ? ((await res.json()) as Page) : null;
    },
    [productId],
  );

  /** First page for a sort and filter (page 1 again whenever either changes). */
  const firstPage = useCallback(
    (s: Sort, st: number) => {
      const id = ++latest.current;
      return fetchPage(1, s, st)
        .then((data) => {
          if (id !== latest.current) return;
          if (!data) return setFailed(true);
          setFailed(false);
          setItems(data.items);
          setMatching(data.matching);
          setPage(2);
        })
        .catch(() => id === latest.current && setFailed(true))
        .finally(() => id === latest.current && setLoading(false));
    },
    [fetchPage],
  );

  useEffect(() => {
    void firstPage("latest", 0);
  }, [firstPage]);

  const change = (s: Sort, st: number) => {
    setSort(s);
    setStars(st);
    setLoading(true);
    void firstPage(s, st);
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      const data = await fetchPage(page, sort, stars);
      if (data) {
        setItems((prev) => [...prev, ...data.items.filter((n) => !prev.some((p) => p.id === n.id))]);
        setPage(page + 1);
      }
    } catch {
      /* the button stays, so it can be tried again */
    } finally {
      setLoading(false);
    }
  };

  const select = "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground";

  return (
    <Overlay side="right" label="All customer reviews" onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">All reviews</h3>
          <p className="text-xs text-muted-foreground">
            {ratingAvg.toFixed(1)} out of 5 · {total} {total === 1 ? "review" : "reviews"}
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sort by
          <select className={select} value={sort} onChange={(e) => change(e.target.value as Sort, stars)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Show
          <select className={select} value={stars} onChange={(e) => change(sort, Number(e.target.value))}>
            <option value={0}>All stars</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "star" : "stars"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-busy={loading}>
        {failed ? <p className="text-sm text-muted-foreground">Could not load reviews. Please try again.</p> : null}
        {!failed && !loading && items.length === 0 ? <p className="text-sm text-muted-foreground">No reviews match this filter.</p> : null}
        {items.map((rev) => (
          <ReviewCard key={rev.id} rev={rev} full />
        ))}
        {items.length < matching ? (
          <button type="button" onClick={() => void loadMore()} disabled={loading} className="w-full rounded-lg border border-input px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50">
            {loading ? "Loading..." : "Load more reviews"}
          </button>
        ) : null}
      </div>
    </Overlay>
  );
}
