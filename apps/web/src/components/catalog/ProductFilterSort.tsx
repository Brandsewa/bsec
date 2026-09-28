"use client";

import React, { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export interface ProductFilterSortProps {
  currentSort?: string | undefined;
  inStockOnly?: boolean | undefined;
  totalCount?: number | undefined;
}

const SORT_OPTIONS = [
  { value: "created_desc", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "title_asc", label: "Alphabetical A-Z" },
];

export function ProductFilterSort({
  currentSort = "created_desc",
  inStockOnly = false,
  totalCount,
}: ProductFilterSortProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (newSort === "created_desc") {
      params.delete("sort");
    } else {
      params.set("sort", newSort);
    }
    params.delete("page"); // Reset to page 1 on sort change
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleInStockToggle = (checked: boolean) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (checked) {
      params.set("inStockOnly", "true");
    } else {
      params.delete("inStockOnly");
    }
    params.delete("page"); // Reset to page 1
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60">
      {/* Product count */}
      <div className="text-sm text-muted-foreground">
        {totalCount !== undefined ? (
          <span>
            Showing <strong className="text-foreground">{totalCount}</strong> products
          </span>
        ) : null}
      </div>

      {/* Filter and Sort controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* In-stock toggle */}
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => handleInStockToggle(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background"
          />
          <span>In-stock only</span>
        </label>

        {/* Sort Select */}
        <div className="flex items-center gap-2">
          <label htmlFor="catalog-sort" className="text-sm text-muted-foreground whitespace-nowrap">
            Sort by:
          </label>
          <select
            id="catalog-sort"
            value={currentSort}
            onChange={(e) => handleSortChange(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
