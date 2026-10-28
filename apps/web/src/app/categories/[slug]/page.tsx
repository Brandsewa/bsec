import React from "react";
import { getMarketContext } from "@/server/market.ts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cacheTag } from "next/cache";
import {
  evaluateStorefrontAccess,
  getStorefrontCategory,
  getStoreSettings,
  getStorefrontSeoSettings,
  generateItemListJsonLd,
  generateBreadcrumbJsonLd,
  buildCategorySeoMetadata,
  tenantTag,
  type CatalogListingOptions,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontCategory, getCachedThemePage } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { CollectionListingSection } from "@/components/catalog/CollectionListingSection.tsx";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    limit?: string;
    sort?: string;
    inStockOnly?: string;
    [key: string]: string | undefined;
  }>;
}

export async function generateMetadata({ params, searchParams }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;

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
        getStorefrontCategory(rt, tenantCtx, slug),
        getStorefrontSeoSettings(rt, tenantCtx).catch(() => null),
        getStoreSettings(rt, tenantCtx).catch(() => null),
      ]);

      if (res?.category) {
        const page = sp.page ? parseInt(sp.page, 10) : 1;
        const hasFilterOrSortParams = Boolean(sp.sort || sp.inStockOnly);

        const seoMeta = buildCategorySeoMetadata({
          category: res.category,
          seoSettings,
          storeSettings,
          storeStatusMode: access.mode,
          noindex: access.noindex,
          productsCount: res.products.total,
          hasFilterOrSortParams,
          page,
          host,
        });

        return {
          title: seoMeta.title,
          description: seoMeta.description,
          robots: seoMeta.robots,
          openGraph: seoMeta.openGraph,
          alternates: seoMeta.alternates,
        };
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return {
    title: "Category Not Found",
  };
}

/** The collection page's product list is either the full "Collection page" block or the bare "Collection products" widget. */
const isListingBlock = (type: string) => type === "CollectionListing" || type === "CollectionProducts";

export default async function CategoryDetailPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const rawSort = sp.sort ?? "created_desc";
  const inStockOnly = sp.inStockOnly === "true";

  // Map sort parameter to domain CatalogListingOptions
  let sortOption: CatalogListingOptions["sort"] = undefined;
  if (rawSort === "price_asc") sortOption = "price_asc";
  else if (rawSort === "price_desc") sortOption = "price_desc";
  else if (rawSort === "title_asc" || rawSort === "title") sortOption = "title";
  else if (rawSort === "popularity") sortOption = "popularity";
  else if (rawSort === "rating") sortOption = "rating";
  else if (rawSort === "created_desc" || rawSort === "newest") sortOption = "newest";

  let categoryData: Awaited<ReturnType<typeof getStorefrontCategory>> = null;
  let host = "localhost";
  let tenantId = "";
  let marketCurrency = "INR";
  let marketLocale = "en-IN";
  let template: Awaited<ReturnType<typeof getCachedThemePage>> = null;
  let limit = 12;

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      notFound();
    }

    tenantId = access.tenantId;
    const marketCtx = await getMarketContext(tenantId);
    const marketId = marketCtx.marketId;
    marketCurrency = marketCtx.currency;
    marketLocale = marketCtx.locale;
    // Categories are drawn with the theme's collection template, the same page collections use.
    template = await getCachedThemePage(tenantId, "collection", marketId).catch(() => null);
    const listingForSize = template?.blocks.find((b) => isListingBlock(b.type));
    const templateSize = Number(listingForSize?.props?.["pageSize"]);
    const defaultLimit = [12, 24, 36].includes(templateSize) ? templateSize : listingForSize ? 24 : 12;
    limit = Math.max(1, Math.min(100, parseInt(sp.limit ?? "", 10) || defaultLimit));
    // The collection template's filter menu (or the store's "filter" menu) drives the filters, as on collection pages.
    const listingBlock = template?.blocks.find((b) => isListingBlock(b.type));
    const filterMenuHandle = typeof listingBlock?.props?.filterMenuHandle === "string" && listingBlock.props.filterMenuHandle ? listingBlock.props.filterMenuHandle : "filter";
    const filterParams: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(sp)) {
      if (!["page", "limit", "sort"].includes(k)) filterParams[k] = v;
    }
    categoryData = await getCachedStorefrontCategory(tenantId, slug, {
      page,
      limit,
      sort: sortOption,
      inStockOnly: inStockOnly || undefined,
      filterMenuHandle,
      filters: filterParams,
    });
  } catch {
    notFound();
  }

  if (!categoryData?.category) {
    notFound();
  }

  const { category, products } = categoryData;

  // Set tenant category cache tags for Next.js Cache Components (PLAN §11.6)
  try {
    cacheTag(tenantTag(tenantId, "category", category.id));
    cacheTag(tenantTag(tenantId, "category"));
  } catch {
    // Ignore outside Next.js request context
  }

  const categoryCacheTag = tenantTag(tenantId, "category", category.id);

  const storeUrl = `https://${host}`;

  // Schema.org structured data
  const itemListJsonLd = generateItemListJsonLd(
    category.name,
    products.items.map((prod, idx) => ({
      name: prod.title,
      url: `${storeUrl}/products/${prod.slug}`,
      position: (page - 1) * limit + idx + 1,
    })),
  );

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: storeUrl },
    { name: "Categories", url: `${storeUrl}/categories` },
    { name: category.name, url: `${storeUrl}/categories/${category.slug}` },
  ]);

  // The listing template reads a collection; a category maps onto it field for field (no rules, no filter menu).
  const asCollection = {
    id: category.id,
    title: category.name,
    slug: category.slug,
    type: "manual",
    rules: null,
    sortOrder: "manual",
    imageMediaId: category.imageMediaId,
    description: category.description,
    descriptionJson: category.descriptionJson,
    seo: category.seo,
    published: true,
    indexable: true,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };

  const listing = (options?: Parameters<typeof CollectionListingSection>[0]["options"]) => (
    <CollectionListingSection
      collection={asCollection}
      products={products}
      page={page}
      limit={limit}
      rawSort={rawSort}
      inStockOnly={inStockOnly}
      filterData={categoryData?.filterData}
      filters={sp}
      options={options}
      basePath={`/categories/${category.slug}`}
      archive={{ href: "/categories", label: "Categories" }}
      currency={marketCurrency}
      locale={marketLocale}
    />
  );

  return (
    <div data-cache-tag={categoryCacheTag} className="bs-skin">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }} />
      {template ? (
        <BlockRenderer
          blocks={template.blocks}
          renderData={template.renderData}
          context={{
            currency: marketCurrency,
            locale: marketLocale,
            renderCollectionListing: (options) => listing(options),
          }}
        />
      ) : (
        listing()
      )}
    </div>
  );
}
