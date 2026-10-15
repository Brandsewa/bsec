"use client";

import React, { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { StorefrontFacetedResult, StorefrontFacet } from "@bs/domain";
import { ViewToggle, ProductsSkeleton } from "./ListingView.tsx";
import { PriceSlider } from "./PriceSlider.tsx";

export interface FacetedFiltersProps {
  filterData: StorefrontFacetedResult;
  currentSort?: string | undefined;
  totalCount?: number | undefined;
  children?: React.ReactNode;
  /** Lets shoppers hide the filter sidebar on desktop. */
  collapsible?: boolean | undefined;
  showViewToggle?: boolean | undefined;
}

const SORT_OPTIONS = [
  { value: "created_desc", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "title_asc", label: "Alphabetical A-Z" },
];

const BAR_BUTTON = "items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors";
const BADGE = "ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground";
const FILTER_ICON = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export function FacetedFilters({
  filterData,
  currentSort = "created_desc",
  totalCount,
  children,
  collapsible = true,
  showViewToggle = true,
}: FacetedFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const hasFacets = filterData.facets.length > 0;

  const [isSortOpen, setIsSortOpen] = useState(false);

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (newSort === "created_desc") {
      params.delete("sort");
    } else {
      params.set("sort", newSort);
    }
    params.delete("page");
    params.delete("limit");
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
    params.delete("limit");
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
    params.delete("limit");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // The slider works in whole rupees; the address and the query use paise. Dragging back to the full range removes the filter.
  const commitPrice = (loRupees: number, hiRupees: number, fullMinPaise: number, fullMaxPaise: number) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const lo = loRupees * 100;
    const hi = hiRupees * 100;
    if (lo <= fullMinPaise && hi >= fullMaxPaise) {
      if (!params.has("price")) return;
      params.delete("price");
    } else {
      const next = `${lo <= fullMinPaise ? "" : lo}-${hi >= fullMaxPaise ? "" : hi}`;
      if (params.get("price") === next) return;
      params.set("price", next);
    }
    params.delete("page");
    params.delete("limit");
    params.delete("limit");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const clearAllFilters = () => {
    const params = new URLSearchParams();
    const sortVal = searchParams.get("sort");
    if (sortVal) params.set("sort", sortVal);
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
      const rng = facet.range;
      return (
        <details key={facet.id} open={!facet.collapsed} className="group py-4 border-b border-border/60">
          <summary className="flex items-center justify-between text-sm font-medium text-foreground cursor-pointer select-none list-none">
            <span>{facet.label}</span>
            <span className="transition-transform group-open:rotate-180 text-muted-foreground text-xs">▼</span>
          </summary>
          {rng ? (
            <PriceSlider
              key={`${rng.min}-${rng.max}-${rng.currentMin ?? ""}-${rng.currentMax ?? ""}`}
              min={Math.floor(rng.min / 100)}
              max={Math.ceil(rng.max / 100)}
              valueMin={Math.floor((rng.currentMin ?? rng.min) / 100)}
              valueMax={Math.ceil((rng.currentMax ?? rng.max) / 100)}
              disabled={isPending}
              onCommit={(lo, hi) => commitPrice(lo, hi, rng.min, rng.max)}
            />
          ) : null}
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
      {/* Top bar: Filters, product total, then sort and view on the right */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-4 border-b border-border/60">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Phone and tablet: opens the filter sheet */}
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            className={`${hasFacets ? "lg:hidden inline-flex" : "hidden"} ${BAR_BUTTON}`}
          >
            {FILTER_ICON}
            <span>Filters</span>
            {filterData.activeFilterCount > 0 ? <span className={BADGE}>{filterData.activeFilterCount}</span> : null}
          </button>

          {/* Desktop: hides or shows the sidebar */}
          {hasFacets && collapsible ? (
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-expanded={sidebarOpen}
              aria-controls="bs-filter-sidebar"
              className={`hidden lg:inline-flex ${BAR_BUTTON}`}
            >
              {FILTER_ICON}
              <span>{sidebarOpen ? "Hide filters" : "Show filters"}</span>
              {!sidebarOpen && filterData.activeFilterCount > 0 ? <span className={BADGE}>{filterData.activeFilterCount}</span> : null}
            </button>
          ) : null}

          {totalCount !== undefined ? (
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              <strong className="text-foreground">{totalCount}</strong> {totalCount === 1 ? "product" : "products"}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Phone: a button like Filters that opens the sort sheet */}
          <button type="button" onClick={() => setIsSortOpen(true)} className={`inline-flex md:hidden ${BAR_BUTTON}`} aria-haspopup="dialog">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M6 12h12M10 18h4" />
            </svg>
            <span>Sort</span>
          </button>

          {/* Tablet and desktop: a select */}
          <div className="hidden md:flex items-center gap-2">
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

          {showViewToggle ? <ViewToggle /> : null}
        </div>
      </div>

      {/* Main Body */}
      {children ? (
        <div className="mt-8 flex flex-col lg:flex-row gap-8 lg:gap-x-[52px] items-start">
          {/* Desktop Sidebar */}
          {hasFacets ? (
          <aside id="bs-filter-sidebar" className={`${sidebarOpen ? "hidden lg:block" : "hidden"} w-64 shrink-0 sticky top-20`}>
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
          ) : null}

          {/* Children (Product grid and Pagination) */}
          <div className="flex-1 min-w-0 w-full" aria-busy={isPending}>
            {isPending ? <ProductsSkeleton /> : children}
          </div>
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

      {/* Phone sort sheet */}
      {isSortOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden" role="dialog" aria-modal="true" aria-label="Sort products">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setIsSortOpen(false)} />
          <div className="relative z-10 w-full rounded-t-2xl bg-background shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Sort by</h2>
              <button type="button" onClick={() => setIsSortOpen(false)} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted transition-colors" aria-label="Close sort">
                ✕
              </button>
            </div>
            <ul className="px-2 py-2" role="radiogroup" aria-label="Sort by">
              {SORT_OPTIONS.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={currentSort === opt.value}
                    onClick={() => {
                      setIsSortOpen(false);
                      if (opt.value !== currentSort) handleSortChange(opt.value);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm text-foreground hover:bg-muted"
                  >
                    <span className={currentSort === opt.value ? "font-semibold" : ""}>{opt.label}</span>
                    {currentSort === opt.value ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
