import React from "react";
import Link from "next/link";
import type { StorefrontCollectionDetail, StorefrontFacetedResult } from "@bs/domain";
import type { CollectionListingOptions } from "@bs/blocks";
import { ProductCard } from "./ProductCard.tsx";
import { FacetedFilters } from "./FacetedFilters.tsx";
import { Pagination } from "./Pagination.tsx";
import { LoadMore } from "./LoadMore.tsx";
import { ListingViewProvider, ProductsContainer } from "./ListingView.tsx";
import { RichBlocks } from "@/components/storefront/RichBlocks.tsx";
import { layoutStyle } from "@bs/blocks";

export const DEFAULT_COLLECTION_LISTING_OPTIONS: CollectionListingOptions = {
  columns: "4",
  columnsTablet: "2",
  columnsMobile: "1",
  showFilters: true,
  showDescription: true,
  showBreadcrumb: false,
  cardStyle: "borderless",
  imageRatio: "square",
  defaultView: "grid",
  showViewToggle: true,
  pageSize: "12",
  filtersCollapsible: true,
  showSaleBadge: true,
  showCategoryBadge: true,
  showRatings: true,
  showAddToCart: true,
  showQuickAdd: true,
  showViewProduct: true,
  hoverSecondImage: true,
};

const NO_FACETS: StorefrontFacetedResult = { menuHandle: "", facets: [], activeFilterCount: 0 };

/**
 * A collection page body: title and description, sort / view bar with the collapsible filter sidebar, the product grid or list,
 * and "Load more" with the total. A theme's collection page places it through the CollectionListing block; stores without a
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
  basePath,
  archive = { href: "/collections", label: "Collections" },
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
  /** Where numbered pages link; a category page passes its own path so it can share this template. */
  basePath?: string | undefined;
  archive?: { href: string; label: string } | undefined;
}) {
  const o = { ...DEFAULT_COLLECTION_LISTING_OPTIONS, ...options };
  const totalPages = Math.ceil(products.total / limit);
  const description = collection.description;
  const step = Number(o.pageSize ?? "12");
  const shown = Math.min(products.total, (page - 1) * limit + products.items.length);

  const bare = Boolean(o.bare);
  const hasFacets = Boolean(o.showFilters && filterData && filterData.facets && filterData.facets.length > 0);

  const productGrid =
    products.items.length > 0 ? (
      <ProductsContainer cols={Number(o.columns)} colsTablet={Number(o.columnsTablet ?? "2")} colsMobile={Number(o.columnsMobile ?? "1")}>
        {products.items.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product}
            imageRatio={o.imageRatio}
            cardStyle={o.cardStyle}
            showSaleBadge={o.showSaleBadge}
            showRatings={o.showRatings}
            showCategoryBadge={o.showCategoryBadge}
            showAddToCart={o.showAddToCart}
            showQuickAdd={o.showQuickAdd}
            showViewProduct={o.showViewProduct}
            hoverSecondImage={o.hoverSecondImage}
            priority={i < 4}
          />
        ))}
      </ProductsContainer>
    ) : (
      <div className="mt-8 text-center py-12 rounded-2xl border border-dashed border-border/80 bg-muted/20">
        <h2 className="text-lg font-semibold text-foreground">No products found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasFacets ? "Try clearing or adjusting your filters to see more products." : "There are currently no products available in this collection."}
        </p>
        <div className="mt-6">
          <Link href="/" className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            Continue Shopping
          </Link>
        </div>
      </div>
    );

  // "Load more" raises `limit` up to 100 products; past that the numbered pages take over.
  const more = (
    <>
      <LoadMore shown={shown} total={products.total} step={step} limit={limit} page={page} />
      {limit >= 100 || page > 1 ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          baseUrl={basePath ?? `/collections/${collection.slug}`}
          searchParams={{
            sort: rawSort !== "created_desc" ? rawSort : undefined,
            inStockOnly: inStockOnly ? "true" : undefined,
            limit: limit !== 24 ? limit : undefined,
            ...filters,
          }}
        />
      ) : null}
    </>
  );

  return (
    <ListingViewProvider defaultView={o.defaultView} cols={Number(o.columns)} colsTablet={Number(o.columnsTablet ?? "2")} colsMobile={Number(o.columnsMobile ?? "1")}>
      <div
        className={bare ? `bsb bsb-lay bsb-tone-${o.tone ?? "default"}` : "mx-auto w-full max-w-[80rem] px-4 py-8"}
        {...(bare ? { style: layoutStyle(o.box) } : null)}
      >
       <div className={bare ? `bsb-w bsb-w-${o.width ?? "wide"}` : undefined}>
        {o.showBreadcrumb ? (
          <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <span>/</span>
            <Link href={archive.href} className="hover:text-foreground transition-colors">
              {archive.label}
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none">{collection.title}</span>
          </nav>
        ) : null}

        {o.showTitle === false ? null : (
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl" style={{ fontFamily: "var(--bs-font-heading, inherit)" }}>
            {collection.title}
          </h1>
          {o.showDescription && description ? <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p> : null}
        </div>
        )}
        {o.showTitle === false && o.showDescription && description ? <p className="mb-6 max-w-2xl text-muted-foreground">{description}</p> : null}

        {o.showFilters ? (
          <FacetedFilters
            filterData={hasFacets && filterData ? filterData : NO_FACETS}
            currentSort={rawSort}
            totalCount={products.total}
            collapsible={o.filtersCollapsible}
            showViewToggle={o.showViewToggle}
            skeletonCount={Math.max(1, products.items.length)}
          >
            {productGrid}
            {more}
          </FacetedFilters>
        ) : (
          <>
            <div className="mt-6">{productGrid}</div>
            {more}
          </>
        )}

        {/* Long description: detail content below the products */}
        {(bare ? o.showLongDescription : o.showDescription) && collection.descriptionJson && collection.descriptionJson.blocks.length > 0 ? (
          <section className="mt-12 max-w-3xl border-t border-border pt-8" aria-label={`About ${collection.title}`}>
            <RichBlocks blocks={collection.descriptionJson.blocks} />
          </section>
        ) : null}
       </div>
      </div>
    </ListingViewProvider>
  );
}
