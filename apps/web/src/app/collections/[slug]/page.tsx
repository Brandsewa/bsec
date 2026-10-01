import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
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
import { getCachedStorefrontCollection, getCachedThemePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { CollectionListingSection } from "@/components/catalog/CollectionListingSection.tsx";

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

  // The theme's own collection layout, when the store has one; the built-in layout otherwise.
  const template = await getCachedThemePage(tenantId, "collection").catch(() => null);
  const listing = (options?: Parameters<typeof CollectionListingSection>[0]["options"]) => (
    <CollectionListingSection
      collection={collection}
      products={products}
      page={page}
      limit={limit}
      rawSort={rawSort}
      inStockOnly={inStockOnly}
      options={options}
    />
  );

  return (
    <div data-cache-tag={collectionCacheTag}>
      {/* Schema.org structured data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }} />
      {template ? (
        <BlockRenderer
          blocks={template.blocks}
          renderData={template.renderData}
          context={{ renderCollectionListing: (options) => listing(options) }}
        />
      ) : (
        listing()
      )}
    </div>
  );
}
