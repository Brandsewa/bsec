"use client";

import React, { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** The hard cap the listing query accepts (see getStorefrontCollection). */
const MAX_LIMIT = 100;

/**
 * "Showing 12 of 57 products" with a Load more button. Loading more raises `limit` in the address and re-renders the
 * list in place (no scroll jump), so the page stays shareable and works with filters and sort.
 */
export function LoadMore({ shown, total, step, limit, page }: { shown: number; total: number; step: number; limit: number; page: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (total === 0) return null;
  const done = shown >= total;
  const atCap = !done && page * limit >= MAX_LIMIT;
  const percent = Math.min(100, Math.round((shown / total) * 100));

  const loadMore = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("page");
    params.set("limit", String(Math.min(MAX_LIMIT, page * limit + step)));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4" data-testid="load-more">
      {!done && !atCap ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="inline-flex h-11 min-w-40 items-center justify-center rounded-lg border border-foreground px-6 text-sm font-semibold transition-colors hover:bg-foreground hover:text-background disabled:opacity-60"
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      ) : null}
      <div className="ml-auto flex flex-col items-end gap-2 text-right">
        <p className="text-sm text-muted-foreground" role="status">
          Showing <strong className="text-foreground">{shown}</strong> of <strong className="text-foreground">{total}</strong> {total === 1 ? "product" : "products"}
        </p>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
