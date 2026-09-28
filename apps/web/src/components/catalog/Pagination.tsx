import React from "react";
import Link from "next/link";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  searchParams?: Record<string, string | number | boolean | undefined> | undefined;
}

export function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  searchParams = {},
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const buildPageUrl = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && key !== "page") {
        params.set(key, String(value));
      }
    }
    params.set("page", String(page));
    const query = params.toString();
    return query ? `${baseUrl}?${query}` : baseUrl;
  };

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Compute page numbers to display
  const pages: number[] = [];
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className="flex items-center justify-center gap-2 py-8"
    >
      {/* Previous button */}
      {hasPrev ? (
        <Link
          href={buildPageUrl(currentPage - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground/60 cursor-not-allowed select-none"
        >
          Previous
        </span>
      )}

      {/* Page Numbers */}
      <div className="flex items-center gap-1">
        {pages.map((p) => {
          const isCurrent = p === currentPage;
          return isCurrent ? (
            <span
              key={p}
              aria-current="page"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >
              {p}
            </span>
          ) : (
            <Link
              key={p}
              href={buildPageUrl(p)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              {p}
            </Link>
          );
        })}
      </div>

      {/* Screen-reader summary */}
      <span className="sr-only">
        Page {currentPage} of {totalPages}
      </span>

      {/* Next button */}
      {hasNext ? (
        <Link
          href={buildPageUrl(currentPage + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          rel="next"
        >
          Next
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground/60 cursor-not-allowed select-none"
        >
          Next
        </span>
      )}
    </nav>
  );
}
