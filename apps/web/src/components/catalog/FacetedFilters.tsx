"use client";

import React, { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { StorefrontFacetedResult, StorefrontFacet } from "@bs/domain";

export interface FacetedFiltersProps {
  filterData: StorefrontFacetedResult;
  currentSort?: string | undefined;
  totalCount?: number | undefined;
  children?: React.ReactNode;
}

const SORT_OPTIONS = [
  { value: "created_desc", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "title_asc", label: "Alphabetical A-Z" },
];

export function FacetedFilters({
  filterData,
  currentSort = "created_desc",
  totalCount,
  children,
}: FacetedFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Price range local state for inputs
  const priceFacet = filterData.facets.find((f) => f.kind === "price");
  const [priceMinInput, setPriceMinInput] = useState<string>(
    priceFacet?.range?.currentMin !== undefined ? String(priceFacet.range.currentMin) : ""
  );
  const [priceMaxInput, setPriceMaxInput] = useState<string>(
    priceFacet?.range?.currentMax !== undefined ? String(priceFacet.range.currentMax) : ""
  );

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (newSort === "created_desc") {
      params.delete("sort");
    } else {
      params.set("sort", newSort);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const toggleFacetValue = (paramKey: string, value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const current = params.get(paramKey)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const exists = current.includes(value);
    const next = exists ? current.filter((v) => v !== value) : [...current, value];

    if (next.length === 0) {
      params.delete(paramKey);
    } else {
      params.set(paramKey, next.join(","));
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const toggleInStock = (checked: boolean) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (checked) {
      params.set("in_stock", "1");
    } else {
      params.delete("in_stock");
      params.delete("inStockOnly");
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const applyPriceRange = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const minVal = priceMinInput.trim() !== "" ? Math.max(0, Number(priceMinInput)) : undefined;
    const maxVal = priceMaxInput.trim() !== "" ? Math.max(0, Number(priceMaxInput)) : undefined;

    if (minVal !== undefined || maxVal !== undefined) {
      const minStr = minVal !== undefined && !Number.isNaN(minVal) ? String(minVal) : "";
      const maxStr = maxVal !== undefined && !Number.isNaN(maxVal) ? String(maxVal) : "";
      params.set("price", `${minStr}-${maxStr}`);
    } else {
      params.delete("price");
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    const params = new URLSearchParams();
    const sortVal = searchParams.get("sort");
    if (sortVal) params.set("sort", sortVal);
    setPriceMinInput("");
    setPriceMaxInput("");
    startTransition(() => {
      router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    });
  };

  const renderFacet = (facet: StorefrontFacet) => {
    if (facet.kind === "availability") {
      const isSelected = facet.values?.[0]?.selected ?? false;
      const count = facet.values?.[0]?.count;

      return (
        <div key={facet.id} className="py-4 border-b border-border/60">
          <label className="flex items-center justify-between text-sm cursor-pointer select-none">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => toggleInStock(e.target.checked)}
                disabled={isPending}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background"
              />
              <span className="font-medium text-foreground">{facet.label}</span>
            </div>
            {count !== undefined ? <span className="text-xs text-muted-foreground">({count})</span> : null}
          </label>
        </div>
      );
    }

    if (facet.kind === "price") {
      return (
        <details key={facet.id} open={!facet.collapsed} className="group py-4 border-b border-border/60">
          <summary className="flex items-center justify-between text-sm font-medium text-foreground cursor-pointer select-none list-none">
            <span>{facet.label}</span>
            <span className="transition-transform group-open:rotate-180 text-muted-foreground text-xs">▼</span>
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">Min (₹)</label>
                <input
                  type="number"
                  min="0"
                  placeholder={String(facet.range?.min ?? 0)}
                  value={priceMinInput}
                  onChange={(e) => setPriceMinInput(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-sm text-foreground focus:border-primary focus:outline-hidden"
                />
              </div>
              <span className="text-muted-foreground mt-5">-</span>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">Max (₹)</label>
                <input
                  type="number"
                  min="0"
                  placeholder={String(facet.range?.max ?? 0)}
                  value={priceMaxInput}
                  onChange={(e) => setPriceMaxInput(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-sm text-foreground focus:border-primary focus:outline-hidden"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={applyPriceRange}
              disabled={isPending}
              className="w-full rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              Apply Price
            </button>
          </div>
        </details>
      );
    }

    const paramKey = facet.kind === "option" && facet.optionName ? facet.optionName.toLowerCase() : facet.kind;
    const values = facet.values ?? [];

    if (values.length === 0) return null;

    if (facet.display === "swatch") {
      return (
        <details key={facet.id} open={!facet.collapsed} className="group py-4 border-b border-border/60">
          <summary className="flex items-center justify-between text-sm font-medium text-foreground cursor-pointer select-none list-none">
            <span>{facet.label}</span>
            <span className="transition-transform group-open:rotate-180 text-muted-foreground text-xs">▼</span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {values.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => toggleFacetValue(paramKey, v.value)}
                disabled={isPending}
                aria-pressed={v.selected}
                rel="nofollow"
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  v.selected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                <span>{v.label}</span>
                <span className={v.selected ? "opacity-80" : "text-muted-foreground"}>({v.count})</span>
              </button>
            ))}
          </div>
        </details>
      );
    }

    // Default checkbox list
    return (
      <details key={facet.id} open={!facet.collapsed} className="group py-4 border-b border-border/60">
        <summary className="flex items-center justify-between text-sm font-medium text-foreground cursor-pointer select-none list-none">
          <span>{facet.label}</span>
          <span className="transition-transform group-open:rotate-180 text-muted-foreground text-xs">▼</span>
        </summary>
        <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
          {values.map((v) => (
            <label
              key={v.value}
              className="flex items-center justify-between text-sm cursor-pointer select-none hover:text-foreground"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.selected}
                  onChange={() => toggleFacetValue(paramKey, v.value)}
                  disabled={isPending}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background"
                />
                <span className="text-foreground">{v.label}</span>
              </div>
              <span className="text-xs text-muted-foreground">({v.count})</span>
            </label>
          ))}
        </div>
      </details>
    );
  };

  return (
    <>
      {/* Top Bar: Count, Mobile Filter Trigger, Desktop Sort */}
      <div className="flex items-center justify-between py-4 border-b border-border/60">
        {/* Count */}
        <div className="text-sm text-muted-foreground">
          {totalCount !== undefined ? (
            <span>
              Showing <strong className="text-foreground">{totalCount}</strong> products
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {/* Mobile Filter Button */}
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            className="lg:hidden inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Filters</span>
            {filterData.activeFilterCount > 0 ? (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
                {filterData.activeFilterCount}
              </span>
            ) : null}
          </button>

          {/* Sort Select */}
          <div className="flex items-center gap-2">
            <label htmlFor="catalog-sort" className="text-sm text-muted-foreground whitespace-nowrap hidden sm:inline">
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

      {/* Main Body */}
      {children ? (
        <div className="mt-8 flex flex-col lg:flex-row gap-8 items-start">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block w-64 shrink-0 sticky top-20">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Filters</h2>
              {filterData.activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  disabled={isPending}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Clear all ({filterData.activeFilterCount})
                </button>
              ) : null}
            </div>
            <div>{filterData.facets.map(renderFacet)}</div>
          </aside>

          {/* Children (Product grid and Pagination) */}
          <div className="flex-1 min-w-0 w-full">{children}</div>
        </div>
      ) : (
        <div className="hidden lg:block mt-8">
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Filters</h2>
            {filterData.activeFilterCount > 0 ? (
              <button
                type="button"
                onClick={clearAllFilters}
                disabled={isPending}
                className="text-xs text-primary hover:underline font-medium"
              >
                Clear all ({filterData.activeFilterCount})
              </button>
            ) : null}
          </div>
          <div>{filterData.facets.map(renderFacet)}</div>
        </div>
      )}

      {/* Mobile Drawer / Bottom Sheet */}
      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileOpen(false)}
          />

          {/* Sheet Content */}
          <div className="relative z-10 max-h-[85vh] w-full rounded-t-2xl bg-background shadow-xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Filters</h2>
                {filterData.activeFilterCount > 0 ? (
                  <span className="inline-flex items-center justify-center rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {filterData.activeFilterCount}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setIsMobileOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Filters */}
            <div className="overflow-y-auto px-6 py-2 flex-1 divide-y divide-border/60">
              {filterData.facets.map(renderFacet)}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center gap-3 px-6 py-4 border-t border-border bg-background">
              {filterData.activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    clearAllFilters();
                  }}
                  disabled={isPending}
                  className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Clear all
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIsMobileOpen(false)}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
