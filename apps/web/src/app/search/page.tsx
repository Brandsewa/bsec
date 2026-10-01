import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import {
  evaluateStorefrontAccess,
  searchStorefrontProducts,
  getStoreSettings,
  getStorefrontSeoSettings,
  generateItemListJsonLd,
  formatTitle,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { ProductCard } from "@/components/catalog/ProductCard.tsx";
import { SearchInput } from "@/components/catalog/SearchInput.tsx";
import { Pagination } from "@/components/catalog/Pagination.tsx";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    limit?: string;
  }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";

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

      const [seoSettings, storeSettings] = await Promise.all([
        getStorefrontSeoSettings(rt, tenantCtx).catch(() => null),
        getStoreSettings(rt, tenantCtx).catch(() => null),
      ]);

      const storeName = storeSettings?.storeName ?? "Store";
      const pageTitle = q ? `Search results for "${q}"` : "Search Catalog";
      const metaTitle = formatTitle(seoSettings?.titleTemplate, pageTitle, storeName);

      return {
        title: metaTitle,
        description: `Search our catalog at ${storeName}. Find the best mechanical keyboards, accessories, and components.`,
        robots: {
          index: false, // Prevent indexing of dynamic internal search results pages
          follow: true,
        },
      };
    }
  } catch {
    // Non-fatal fallback
  }

  return {
    title: q ? `Search: ${q}` : "Search",
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(sp.limit ?? "24", 10) || 24));

  let results: Awaited<ReturnType<typeof searchStorefrontProducts>> = { items: [], total: 0 };
  let host = "localhost";

  if (q) {
    try {
      const h = await headers();
      host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
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

        results = await searchStorefrontProducts(rt, tenantCtx, q, { page, limit });
      }
    } catch {
      // In case of error, show zero results
      results = { items: [], total: 0 };
    }
  }

  const storeUrl = `https://${host}`;
  const totalPages = Math.ceil(results.total / limit);

  // Schema.org structured data if there are search results
  const itemListJsonLd =
    results.items.length > 0
      ? generateItemListJsonLd(
          `Search results for "${q}"`,
          results.items.map((prod, idx) => ({
            name: prod.title,
            url: `${storeUrl}/products/${prod.slug}`,
            position: (page - 1) * limit + idx + 1,
          })),
        )
      : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Schema.org Structured Data */}
      {itemListJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
        />
      )}

      {/* Breadcrumbs Navigation */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">Search</span>
      </nav>

      {/* Search Header & SearchInput Bar */}
      <div className="flex flex-col items-center justify-center text-center mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl mb-4">
          Search Products
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground mb-6">
          Search this store by product name.
        </p>
        <div className="w-full flex justify-center">
          <SearchInput initialQuery={q} placeholder="Search products..." />
        </div>
      </div>

      {/* Query status and count */}
      {q && (
        <div className="mb-6 border-b border-border/60 pb-4">
          <p className="text-base text-foreground">
            Found <strong className="font-semibold">{results.total}</strong> products for{" "}
            <span className="font-semibold text-primary">&ldquo;{q}&rdquo;</span>
          </p>
        </div>
      )}

      {/* Product Results Grid or Zero-State */}
      {q ? (
        results.items.length > 0 ? (
          <div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {results.items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Pagination */}
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl="/search"
              searchParams={{
                q,
                limit: limit !== 24 ? limit : undefined,
              }}
            />
          </div>
        ) : (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border/80 bg-muted/20">
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-foreground">No products found</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
              No products found. Try different keywords, checking your spelling, or exploring our collections.
            </p>
            <div className="mt-6">
              <Link
                href="/collections"
                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Browse Collections
              </Link>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
