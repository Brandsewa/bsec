import React from "react";
import Link from "next/link";
import type { StorefrontCollectionDetail, StorefrontFacetedResult } from "@bs/domain";
import type { CollectionListingOptions } from "@bs/blocks";
import { ProductCard } from "./ProductCard.tsx";
import { ProductFilterSort } from "./ProductFilterSort.tsx";
import { FacetedFilters } from "./FacetedFilters.tsx";
import { Pagination } from "./Pagination.tsx";

export const DEFAULT_COLLECTION_LISTING_OPTIONS: CollectionListingOptions = {
  columns: "4",
  showFilters: true,
  showDescription: true,
};

// Phone columns come first (1 by default, 2 when the template asks for it), then the desktop count.
const GRID: Record<"1" | "2", Record<CollectionListingOptions["columns"], string>> = {
  "1": {
    "2": "grid-cols-1 gap-6 sm:grid-cols-2",
    "3": "grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
    "4": "grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  },
  "2": {
    "2": "grid-cols-2 gap-3 sm:gap-6",
    "3": "grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3",
    "4": "grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4",
  },
};

/**
 * A collection page body: breadcrumb, title, sort/filter bar, product grid and pagination.
 * A theme's collection page places it through the CollectionListing block; stores without a
 * collection template get it with the defaults.
 */
export function CollectionListingSection({
  collection,
  products,
  page,
  limit,
  rawSort,
  inStockOnly,
  filterData,
  filters,
  options = DEFAULT_COLLECTION_LISTING_OPTIONS,
}: {
  collection: StorefrontCollectionDetail["collection"];
  products: StorefrontCollectionDetail["products"];
  page: number;
  limit: number;
  rawSort: string;
  inStockOnly: boolean;
  filterData?: StorefrontFacetedResult | undefined;
  filters?: Record<string, string | number | boolean | undefined> | undefined;
  options?: CollectionListingOptions | undefined;
}) {
  const totalPages = Math.ceil(products.total / limit);
  const description = (collection as { description?: string | null }).description;

  const hasFacets = Boolean(options.showFilters && filterData && filterData.facets && filterData.facets.length > 0);

  const productGrid = products.items.length > 0 ? (
    <div className={`grid ${GRID[options.columnsMobile ?? "1"][options.columns]}`}>
      {products.items.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          imageRatio={options.imageRatio}
          cardStyle={options.cardStyle}
          showSaleBadge={options.showSaleBadge}
          showRatings={options.showRatings}
        />
      ))}
    </div>
  ) : (
    <div className="mt-8 text-center py-12 rounded-2xl border border-dashed border-border/80 bg-muted/20">
      <h2 className="text-lg font-semibold text-foreground">No products found</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasFacets ? "Try clearing or adjusting your filters to see more products." : "There are currently no products available in this collection."}
      </p>
      <div className="mt-6">
        <Link
          href="/"
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  );

  const pagination = (
    <Pagination
      currentPage={page}
      totalPages={totalPages}
      baseUrl={`/collections/${collection.slug}`}
      searchParams={{
        sort: rawSort !== "created_desc" ? rawSort : undefined,
        inStockOnly: inStockOnly ? "true" : undefined,
        limit: limit !== 24 ? limit : undefined,
        ...filters,
      }}
    />
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {options.showBreadcrumb !== false ? (
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <span>/</span>
          <Link href="/collections" className="hover:text-foreground transition-colors">
            Collections
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none">{collection.title}</span>
        </nav>
      ) : null}

      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl" style={{ fontFamily: "var(--bs-font-heading, inherit)" }}>
          {collection.title}
        </h1>
        {options.showDescription && description ? <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>

      {hasFacets && filterData ? (
        <FacetedFilters
          filterData={filterData}
          currentSort={rawSort}
          totalCount={products.total}
        >
          {productGrid}
          {pagination}
        </FacetedFilters>
      ) : (
        <>
          {options.showFilters ? <ProductFilterSort currentSort={rawSort} inStockOnly={inStockOnly} totalCount={products.total} /> : null}
          <div className="mt-8">{productGrid}</div>
          {pagination}
        </>
      )}
    </div>
  );
}
