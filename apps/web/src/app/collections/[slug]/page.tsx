import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import Link from "next/link";
import {
  evaluateStorefrontAccess,
  getStorefrontCollection,
  getStoreSettings,
  getStorefrontSeoSettings,
  generateItemListJsonLd,
  generateBreadcrumbJsonLd,
  formatTitle,
  tenantTag,
  type CatalogListingOptions,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontCollection } from "@/server/cached-storefront.ts";
import { ProductCard } from "@/components/catalog/ProductCard.tsx";
import { ProductFilterSort } from "@/components/catalog/ProductFilterSort.tsx";
import { Pagination } from "@/components/catalog/Pagination.tsx";

interface CollectionPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    limit?: string;
    sort?: string;
    inStockOnly?: string;
  }>;
}

export async function generateMetadata({ params }: CollectionPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (access.tenantId) {
      const tenantCtx = {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: ["store_admin"],
        permissions: ["products.read", "settings.write"],
        requestId: crypto.randomUUID(),
      };

      const [res, seoSettings, storeSettings] = await Promise.all([
        getStorefrontCollection(rt, tenantCtx, slug),
        getStorefrontSeoSettings(rt, tenantCtx).catch(() => null),
        getStoreSettings(rt, tenantCtx).catch(() => null),
      ]);

      if (res?.collection) {
        const storeName = storeSettings?.storeName ?? "Store";
        const metaTitle = formatTitle(seoSettings?.titleTemplate, res.collection.title, storeName);
        const description = `Shop ${res.collection.title} at ${storeName}. High-quality products and great deals.`;

        return {
          title: metaTitle,
          description,
          openGraph: {
            title: metaTitle,
            description,
          },
        };
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return {
    title: "Collection Not Found",
  };
}

export default async function CollectionDetailPage({
  params,
  searchParams,
}: CollectionPageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(sp.limit ?? "24", 10) || 24));
  const rawSort = sp.sort ?? "created_desc";
  const inStockOnly = sp.inStockOnly === "true";

  // Map sort parameter to domain CatalogListingOptions
  let sortOption: CatalogListingOptions["sort"] = undefined;
  if (rawSort === "price_asc") sortOption = "price_asc";
  else if (rawSort === "price_desc") sortOption = "price_desc";
  else if (rawSort === "title_asc" || rawSort === "title") sortOption = "title";
  else if (rawSort === "created_desc" || rawSort === "newest") sortOption = "newest";

  let collectionData: Awaited<ReturnType<typeof getStorefrontCollection>> = null;
  let host = "localhost";
  let tenantId = "";

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      notFound();
    }

    tenantId = access.tenantId;
    collectionData = await getCachedStorefrontCollection(tenantId, slug, {
      page,
      limit,
      sort: sortOption,
      inStockOnly: inStockOnly || undefined,
    });
  } catch {
    notFound();
  }

  if (!collectionData?.collection) {
    notFound();
  }

  const { collection, products } = collectionData;

  // Set tenant collection cache tags for Next.js Cache Components (PLAN §11.6)
  try {
    cacheTag(tenantTag(tenantId, "collection", collection.id));
    cacheTag(tenantTag(tenantId, "collection"));
  } catch {
    // Ignore outside Next.js request context
  }

  const collectionCacheTag = tenantTag(tenantId, "collection", collection.id);

  const storeUrl = `https://${host}`;
  const totalPages = Math.ceil(products.total / limit);

  // Schema.org structured data
  const itemListJsonLd = generateItemListJsonLd(
    collection.title,
    products.items.map((prod, idx) => ({
      name: prod.title,
      url: `${storeUrl}/products/${prod.slug}`,
      position: (page - 1) * limit + idx + 1,
    })),
  );

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: storeUrl },
    { name: "Collections", url: `${storeUrl}/collections` },
    { name: collection.title, url: `${storeUrl}/collections/${collection.slug}` },
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" data-cache-tag={collectionCacheTag}>
      {/* Schema.org Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      {/* Breadcrumbs Navigation */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/collections" className="hover:text-foreground transition-colors">
          Collections
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none">
          {collection.title}
        </span>
      </nav>

      {/* Collection Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          {collection.title}
        </h1>
      </div>

      {/* Filter and Sort bar */}
      <ProductFilterSort
        currentSort={rawSort}
        inStockOnly={inStockOnly}
        totalCount={products.total}
      />

      {/* Products Grid or Empty State */}
      {products.items.length > 0 ? (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="mt-16 text-center py-12 rounded-2xl border border-dashed border-border/80 bg-muted/20">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <h2 className="text-lg font-semibold text-foreground">No products found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            There are currently no products available in this collection.
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
      )}

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        baseUrl={`/collections/${collection.slug}`}
        searchParams={{
          sort: rawSort !== "created_desc" ? rawSort : undefined,
          inStockOnly: inStockOnly ? "true" : undefined,
          limit: limit !== 24 ? limit : undefined,
        }}
      />
    </div>
  );
}
