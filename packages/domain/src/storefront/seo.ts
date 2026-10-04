import { and, desc, eq, isNull, inArray, or, sql } from "drizzle-orm";
import { LISTED_PRODUCT_STATUSES } from "./product-status.ts";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import {
  parseCollectionRules,
  buildSingleRuleCondition,
  type StorefrontProductDetail,
} from "./catalog.ts";

export interface SeoSettings {
  id?: string;
  tenantId?: string;
  indexingEnabled: boolean;
  titleTemplate: string;
  defaultMetaDescription: string | null;
  defaultOgImageMediaId: string | null;
  twitterHandle: string | null;
  organizationSchema: unknown;
  localBusiness: unknown;
  robotsExtra: string | null;
  aiCrawlers: Record<string, "allow" | "block"> | null;
  breadcrumbsEnabled: boolean;
  faqSchemaEnabled: boolean;
  updatedAt?: Date | string;
}

export const DEFAULT_AI_CRAWLERS: Record<string, "allow" | "block"> = {
  GPTBot: "block",
  ClaudeBot: "block",
  PerplexityBot: "block",
  "Google-Extended": "block",
  CCBot: "block",
};

export const DEFAULT_SEO_SETTINGS: Omit<SeoSettings, "id" | "tenantId" | "updatedAt"> = {
  indexingEnabled: true,
  titleTemplate: "%s | {{store_name}}",
  defaultMetaDescription: null,
  defaultOgImageMediaId: null,
  twitterHandle: null,
  organizationSchema: null,
  localBusiness: null,
  robotsExtra: null,
  aiCrawlers: { ...DEFAULT_AI_CRAWLERS },
  breadcrumbsEnabled: true,
  faqSchemaEnabled: true,
};

/**
 * Formats a page title using a template string.
 * Replaces `%s` with `title` and `{{store_name}}` with `storeName`.
 * Default template is `"%s | {{store_name}}"`.
 */
export function formatTitle(
  template: string | null | undefined,
  title: string,
  storeName: string,
): string {
  const tpl = template && template.trim().length > 0 ? template : "%s | {{store_name}}";
  return tpl.replace(/%s/g, title).replace(/\{\{store_name\}\}/g, storeName);
}

export const generateTitle = formatTitle;

export interface OrganizationJsonLd {
  "@context": "https://schema.org";
  "@type": "Organization";
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
  [key: string]: unknown;
}

export interface WebSiteJsonLd {
  "@context": "https://schema.org";
  "@type": "WebSite";
  name: string;
  url: string;
  potentialAction: {
    "@type": "SearchAction";
    target: {
      "@type": "EntryPoint";
      urlTemplate: string;
    };
    "query-input": string;
  };
  [key: string]: unknown;
}

export interface ProductOfferJsonLd {
  "@type": "Offer";
  price: number;
  priceCurrency: string;
  availability: string;
  url: string;
  sku: string;
  itemCondition: string;
  [key: string]: unknown;
}

export interface ProductJsonLd {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  description?: string | undefined;
  image?: string[] | undefined;
  offers?: ProductOfferJsonLd[] | undefined;
  brand?: {
    "@type": "Brand";
    name: string;
  } | undefined;
  aggregateRating?: {
    "@type": "AggregateRating";
    ratingValue: string;
    reviewCount: number;
  } | undefined;
  [key: string]: unknown;
}

export interface BreadcrumbListJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
  [key: string]: unknown;
}

export interface FaqPageJsonLd {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: Array<{
    "@type": "Question";
    name: string;
    acceptedAnswer: {
      "@type": "Answer";
      text: string;
    };
  }>;
  [key: string]: unknown;
}

export interface ItemListJsonLd {
  "@context": "https://schema.org";
  "@type": "ItemList";
  name: string;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    url: string;
    name: string;
  }>;
  [key: string]: unknown;
}

export interface ArticleJsonLd {
  "@context": "https://schema.org";
  "@type": "Article";
  headline: string;
  description?: string | undefined;
  mainEntityOfPage: {
    "@type": "WebPage";
    "@id": string;
  };
  author?: {
    "@type": "Person";
    name: string;
  } | undefined;
  datePublished?: string | undefined;
  image?: string[] | undefined;
  [key: string]: unknown;
}

export interface LocalBusinessJsonLd {
  "@context": "https://schema.org";
  "@type": "LocalBusiness";
  name: string;
  address?: string | undefined;
  telephone?: string | undefined;
  geo?: {
    "@type": "GeoCoordinates";
    latitude: number;
    longitude: number;
  } | undefined;
  [key: string]: unknown;
}

/**
 * Generates Schema.org Organization structured data.
 */
export function generateOrganizationJsonLd(opts: {
  name: string;
  url: string;
  logoUrl?: string | null;
  sameAs?: string[];
}): OrganizationJsonLd {
  const result: OrganizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: opts.name,
    url: opts.url,
  };

  if (opts.logoUrl) {
    result.logo = opts.logoUrl;
  }

  if (opts.sameAs && opts.sameAs.length > 0) {
    result.sameAs = opts.sameAs;
  }

  return result;
}

/**
 * Generates Schema.org WebSite structured data with SearchAction.
 */
export function generateWebSiteJsonLd(opts: {
  name: string;
  url: string;
  searchUrlTemplate?: string;
}): WebSiteJsonLd {
  const baseUrl = opts.url.replace(/\/$/, "");
  const searchTemplate = opts.searchUrlTemplate ?? `${baseUrl}/search?q={search_term_string}`;

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: opts.name,
    url: opts.url,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: searchTemplate,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Generates Schema.org Product structured data with variants/offers, availability, and aggregateRating.
 */
export function generateProductJsonLd(
  product: StorefrontProductDetail,
  storeUrl: string,
): ProductJsonLd {
  const baseUrl = storeUrl.replace(/\/$/, "");
  const productUrl = `${baseUrl}/products/${product.slug}`;

  const images = (product.media ?? [])
    .map((m) => m.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  const offers: ProductOfferJsonLd[] = (product.variants ?? []).map((v) => {
    const isAvailable = v.stockStatus === "in_stock" || v.stockStatus === "low_stock";
    return {
      "@type": "Offer",
      price: v.price,
      priceCurrency: "INR",
      availability: isAvailable
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `${productUrl}?variant=${v.id}`,
      sku: v.sku,
      itemCondition: "https://schema.org/NewCondition",
    };
  });

  const result: ProductJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.shortDescription ?? undefined,
    image: images.length > 0 ? images : undefined,
    offers: offers.length > 0 ? offers : undefined,
  };

  if (product.brand?.name) {
    result.brand = {
      "@type": "Brand",
      name: product.brand.name,
    };
  }

  const ratingCount = Number(product.ratingCount ?? 0);
  const ratingAvg = product.ratingAvg ? String(product.ratingAvg) : undefined;
  if (ratingCount > 0 && ratingAvg) {
    result.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: ratingAvg,
      reviewCount: ratingCount,
    };
  }

  return result;
}

/**
 * Generates Schema.org BreadcrumbList structured data.
 */
export function generateBreadcrumbJsonLd(
  items: Array<{ name: string; url: string }>,
): BreadcrumbListJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Generates Schema.org FAQPage structured data.
 */
export function generateFaqJsonLd(
  faqs: Array<{ question: string; answer: string }>,
): FaqPageJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/**
 * Generates Schema.org ItemList structured data.
 */
export function generateItemListJsonLd(
  collectionName: string,
  items: Array<{ name: string; url: string; position: number }>,
): ItemListJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: collectionName,
    itemListElement: items.map((item) => ({
      "@type": "ListItem",
      position: item.position,
      url: item.url,
      name: item.name,
    })),
  };
}

/**
 * Generates Schema.org Article structured data.
 */
export function generateArticleJsonLd(opts: {
  title: string;
  description?: string;
  author?: string;
  publishedAt?: Date | string;
  url: string;
  imageUrl?: string;
}): ArticleJsonLd {
  const publishedStr =
    opts.publishedAt instanceof Date
      ? opts.publishedAt.toISOString()
      : opts.publishedAt;

  const result: ArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.title,
    description: opts.description,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": opts.url,
    },
  };

  if (opts.author) {
    result.author = {
      "@type": "Person",
      name: opts.author,
    };
  }

  if (publishedStr) {
    result.datePublished = publishedStr;
  }

  if (opts.imageUrl) {
    result.image = [opts.imageUrl];
  }

  return result;
}

/**
 * Generates Schema.org LocalBusiness structured data.
 */
export function generateLocalBusinessJsonLd(opts: {
  name: string;
  address?: string;
  phone?: string;
  geo?: { lat: number; lng: number };
}): LocalBusinessJsonLd {
  const result: LocalBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: opts.name,
  };

  if (opts.address) {
    result.address = opts.address;
  }

  if (opts.phone) {
    result.telephone = opts.phone;
  }

  if (opts.geo) {
    result.geo = {
      "@type": "GeoCoordinates",
      latitude: opts.geo.lat,
      longitude: opts.geo.lng,
    };
  }

  return result;
}

/**
 * Generates robots.txt content according to indexing status, AI crawler switches, and sitemap.
 */
export function generateRobotsTxt(
  seoSettings: SeoSettings | null,
  storeStatusMode: string,
  host: string,
): string {
  const indexingEnabled = seoSettings?.indexingEnabled ?? true;
  const isBlockedMode = storeStatusMode === "coming_soon" || storeStatusMode === "password";

  // When indexing is disabled or mode blocks crawling
  if (!indexingEnabled || isBlockedMode) {
    return "User-agent: *\nDisallow: /\n";
  }

  const lines: string[] = [];

  // Default bot directives
  lines.push("User-agent: *");
  lines.push("Disallow: /cart");
  lines.push("Disallow: /checkout");
  lines.push("Disallow: /orders/");
  lines.push("Disallow: /api/");

  if (seoSettings?.robotsExtra) {
    const extra = seoSettings.robotsExtra.trim();
    if (extra.length > 0) {
      lines.push(extra);
    }
  }

  // AI Crawlers
  const crawlerConfig: Record<string, "allow" | "block"> = {
    ...DEFAULT_AI_CRAWLERS,
    ...(seoSettings?.aiCrawlers ?? {}),
  };

  for (const [bot, action] of Object.entries(crawlerConfig)) {
    lines.push("");
    lines.push(`User-agent: ${bot}`);
    if (action === "block") {
      lines.push("Disallow: /");
    } else {
      lines.push("Allow: /");
    }
  }

  // Sitemap
  const cleanHost = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  lines.push("");
  lines.push(`Sitemap: https://${cleanHost}/sitemap.xml`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Fetches SEO settings for the current tenant or returns safe defaults.
 */
export async function getStorefrontSeoSettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<Omit<SeoSettings, "id" | "tenantId" | "updatedAt">> {
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        indexingEnabled: schema.seoSettings.indexingEnabled,
        titleTemplate: schema.seoSettings.titleTemplate,
        defaultMetaDescription: schema.seoSettings.defaultMetaDescription,
        defaultOgImageMediaId: schema.seoSettings.defaultOgImageMediaId,
        twitterHandle: schema.seoSettings.twitterHandle,
        organizationSchema: schema.seoSettings.organizationSchema,
        localBusiness: schema.seoSettings.localBusiness,
        robotsExtra: schema.seoSettings.robotsExtra,
        aiCrawlers: schema.seoSettings.aiCrawlers,
        breadcrumbsEnabled: schema.seoSettings.breadcrumbsEnabled,
        faqSchemaEnabled: schema.seoSettings.faqSchemaEnabled,
      })
      .from(schema.seoSettings)
      .where(eq(schema.seoSettings.tenantId, ctx.tenantId))
      .limit(1);

    if (!row) {
      return {
        ...DEFAULT_SEO_SETTINGS,
        aiCrawlers: { ...DEFAULT_AI_CRAWLERS },
      };
    }

    return {
      indexingEnabled: row.indexingEnabled,
      titleTemplate: row.titleTemplate,
      defaultMetaDescription: row.defaultMetaDescription,
      defaultOgImageMediaId: row.defaultOgImageMediaId,
      twitterHandle: row.twitterHandle,
      organizationSchema: row.organizationSchema,
      localBusiness: row.localBusiness,
      robotsExtra: row.robotsExtra,
      aiCrawlers: (row.aiCrawlers as Record<string, "allow" | "block"> | null) ?? {
        ...DEFAULT_AI_CRAWLERS,
      },
      breadcrumbsEnabled: row.breadcrumbsEnabled,
      faqSchemaEnabled: row.faqSchemaEnabled,
    };
  });
}

/**
 * Updates SEO settings for a tenant and invalidates storefront SEO cache tags.
 */
export async function updateStorefrontSeoSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: Partial<Omit<SeoSettings, "id" | "tenantId" | "updatedAt">>,
): Promise<void> {
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.seoSettings.id })
      .from(schema.seoSettings)
      .where(eq(schema.seoSettings.tenantId, ctx.tenantId))
      .limit(1);

    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.indexingEnabled !== undefined) updateValues.indexingEnabled = input.indexingEnabled;
    if (input.titleTemplate !== undefined) updateValues.titleTemplate = input.titleTemplate;
    if (input.defaultMetaDescription !== undefined) updateValues.defaultMetaDescription = input.defaultMetaDescription;
    if (input.defaultOgImageMediaId !== undefined) updateValues.defaultOgImageMediaId = input.defaultOgImageMediaId;
    if (input.twitterHandle !== undefined) updateValues.twitterHandle = input.twitterHandle;
    if (input.organizationSchema !== undefined) updateValues.organizationSchema = input.organizationSchema;
    if (input.localBusiness !== undefined) updateValues.localBusiness = input.localBusiness;
    if (input.robotsExtra !== undefined) updateValues.robotsExtra = input.robotsExtra;
    if (input.aiCrawlers !== undefined) updateValues.aiCrawlers = input.aiCrawlers;
    if (input.breadcrumbsEnabled !== undefined) updateValues.breadcrumbsEnabled = input.breadcrumbsEnabled;
    if (input.faqSchemaEnabled !== undefined) updateValues.faqSchemaEnabled = input.faqSchemaEnabled;

    if (existing) {
      await tx
        .update(schema.seoSettings)
        .set(updateValues)
        .where(eq(schema.seoSettings.id, existing.id));
    } else {
      await tx.insert(schema.seoSettings).values({
        tenantId: ctx.tenantId,
        indexingEnabled: input.indexingEnabled ?? true,
        titleTemplate: input.titleTemplate ?? "%s | {{store_name}}",
        defaultMetaDescription: input.defaultMetaDescription ?? null,
        defaultOgImageMediaId: input.defaultOgImageMediaId ?? null,
        twitterHandle: input.twitterHandle ?? null,
        organizationSchema: input.organizationSchema ?? null,
        localBusiness: input.localBusiness ?? null,
        robotsExtra: input.robotsExtra ?? null,
        aiCrawlers: input.aiCrawlers ?? { ...DEFAULT_AI_CRAWLERS },
        breadcrumbsEnabled: input.breadcrumbsEnabled ?? true,
        faqSchemaEnabled: input.faqSchemaEnabled ?? true,
      });
    }
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
}

export interface SitemapUrlItem {
  loc: string;
  lastmod?: string | undefined;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never" | undefined;
  priority?: number | undefined;
}

/**
 * Generates valid Sitemap 0.9 XML string from a list of URLs.
 */
export function generateSitemapXml(urls: SitemapUrlItem[]): string {
  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const item of urls) {
    xmlLines.push("  <url>");
    xmlLines.push(`    <loc>${item.loc}</loc>`);
    if (item.lastmod) {
      xmlLines.push(`    <lastmod>${item.lastmod}</lastmod>`);
    }
    if (item.changefreq) {
      xmlLines.push(`    <changefreq>${item.changefreq}</changefreq>`);
    }
    if (item.priority !== undefined) {
      xmlLines.push(`    <priority>${item.priority.toFixed(1)}</priority>`);
    }
    xmlLines.push("  </url>");
  }

  xmlLines.push("</urlset>");
  return xmlLines.join("\n");
}

export const STATIC_POLICY_PAGES = [
  { path: "/policies/privacy", changefreq: "yearly" as const, priority: 0.3 },
  { path: "/policies/terms", changefreq: "yearly" as const, priority: 0.3 },
  { path: "/policies/refund", changefreq: "yearly" as const, priority: 0.3 },
  { path: "/policies/shipping", changefreq: "yearly" as const, priority: 0.3 },
];

export const STATIC_BLOG_POSTS = [
  { slug: "mechanical-keyboards-guide-for-beginners", publishedAt: "2026-09-15T00:00:00.000Z" },
  { slug: "lubing-switches-sound-and-feel", publishedAt: "2026-09-20T00:00:00.000Z" },
  { slug: "workspace-ergonomics-desk-setup", publishedAt: "2026-09-25T00:00:00.000Z" },
];

/**
 * Queries all published entities for a tenant and builds a complete sitemap list:
 * - Home page (/, daily, 1.0)
 * - Published products (/products/[slug], weekly, 0.8)
 * - Published collections (/collections/[slug], weekly, 0.7)
 * - Published categories (/categories/[slug], weekly, 0.7)
 * - Published custom pages (/pages/[slug], monthly, 0.5)
 * - Published blog posts (/blog/[slug], monthly, 0.6)
 * - Static policy pages (/policies/..., yearly, 0.3)
 */
export interface SeoMetadataResult {
  title: string;
  description: string;
  robots: {
    index: boolean;
    follow: boolean;
  };
  openGraph: {
    title: string;
    description: string;
    images?: Array<{ url: string }> | undefined;
  };
  alternates: {
    canonical: string;
  };
}

/**
 * Builds standard SEO metadata for a Category page according to Section 3 rules:
 * - Uses seo.title / seo.description when set, falls back to templates
 * - Sets robots to index, follow unless store blocked, category is empty (no active listed products), or filtered/sorted
 * - Sets canonical URL (clean path for page 1/filtered, ?page=N for pagination without filters)
 */
export function buildCategorySeoMetadata(opts: {
  category: {
    name: string;
    slug: string;
    description?: string | null | undefined;
    seo?: unknown;
  };
  seoSettings: SeoSettings | null;
  storeSettings: { storeName: string } | null;
  storeStatusMode?: string | undefined;
  noindex?: boolean | undefined;
  productsCount: number;
  hasFilterOrSortParams?: boolean | undefined;
  page?: number | undefined;
  host: string;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.category.seo === "object" && opts.category.seo !== null) ? (opts.category.seo as Record<string, unknown>) : {};
  const storedTitle = typeof seoObj.title === "string" && seoObj.title.trim().length > 0 ? seoObj.title.trim() : null;
  const storedDescription = typeof seoObj.description === "string" && seoObj.description.trim().length > 0 ? seoObj.description.trim() : null;

  const title = storedTitle ?? formatTitle(opts.seoSettings?.titleTemplate, opts.category.name, storeName);
  const description = storedDescription ?? opts.category.description ?? `Browse ${opts.category.name} at ${storeName}. High-quality products and great deals.`;

  const isStoreBlocked = opts.noindex === true || opts.storeStatusMode === "coming_soon" || opts.storeStatusMode === "password" || opts.storeStatusMode === "maintenance" || opts.storeStatusMode === "suspended" || opts.seoSettings?.indexingEnabled === false;

  const isEmpty = opts.productsCount <= 0;
  const isFiltered = Boolean(opts.hasFilterOrSortParams);
  const pageNum = opts.page ?? 1;

  const shouldIndex = !isStoreBlocked && !isEmpty && !isFiltered;
  const shouldFollow = !isStoreBlocked;

  let canonicalUrl = `https://${cleanHost}/categories/${opts.category.slug}`;
  if (!isFiltered && pageNum > 1 && !isEmpty) {
    canonicalUrl = `https://${cleanHost}/categories/${opts.category.slug}?page=${pageNum}`;
  }

  return {
    title,
    description,
    robots: {
      index: shouldIndex,
      follow: shouldFollow,
    },
    openGraph: {
      title,
      description,
    },
    alternates: {
      canonical: canonicalUrl,
    },
  };
}

/**
 * Builds standard SEO metadata for a Collection page according to Section 3 rules:
 * - Uses seo.title / seo.description when set, falls back to templates
 * - Indexable ONLY when indexable === true AND published === true AND productsCount > 0
 * - Sets robots to noindex if not indexable, empty, store blocked, or filtered/sorted
 * - Sets canonical URL
 */
export function buildCollectionSeoMetadata(opts: {
  collection: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    published: boolean;
    indexable: boolean;
    seo?: unknown;
  };
  seoSettings: SeoSettings | null;
  storeSettings: { storeName: string } | null;
  storeStatusMode?: string | undefined;
  noindex?: boolean | undefined;
  productsCount: number;
  hasFilterOrSortParams?: boolean | undefined;
  page?: number | undefined;
  host: string;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.collection.seo === "object" && opts.collection.seo !== null) ? (opts.collection.seo as Record<string, unknown>) : {};
  const storedTitle = typeof seoObj.title === "string" && seoObj.title.trim().length > 0 ? seoObj.title.trim() : null;
  const storedDescription = typeof seoObj.description === "string" && seoObj.description.trim().length > 0 ? seoObj.description.trim() : null;

  const title = storedTitle ?? formatTitle(opts.seoSettings?.titleTemplate, opts.collection.title, storeName);
  const description = storedDescription ?? opts.collection.description ?? `Shop ${opts.collection.title} at ${storeName}. High-quality products and great deals.`;

  const isStoreBlocked = opts.noindex === true || opts.storeStatusMode === "coming_soon" || opts.storeStatusMode === "password" || opts.storeStatusMode === "maintenance" || opts.storeStatusMode === "suspended" || opts.seoSettings?.indexingEnabled === false;

  const isEmpty = opts.productsCount <= 0;
  const isFiltered = Boolean(opts.hasFilterOrSortParams);
  const pageNum = opts.page ?? 1;

  const isEligible = opts.collection.published && opts.collection.indexable && !isEmpty;
  const shouldIndex = !isStoreBlocked && isEligible && !isFiltered;
  const shouldFollow = !isStoreBlocked;

  let canonicalUrl = `https://${cleanHost}/collections/${opts.collection.slug}`;
  if (!isFiltered && pageNum > 1 && isEligible) {
    canonicalUrl = `https://${cleanHost}/collections/${opts.collection.slug}?page=${pageNum}`;
  }

  return {
    title,
    description,
    robots: {
      index: shouldIndex,
      follow: shouldFollow,
    },
    openGraph: {
      title,
      description,
    },
    alternates: {
      canonical: canonicalUrl,
    },
  };
}

/**
 * Builds standard SEO metadata for a Product page:
 * - Uses seo.title / seo.description when set, falls back to templates
 * - Unlisted products are served with noindex
 * - Canonical is clean absolute URL https://${host}/products/${slug}
 */
export function buildProductSeoMetadata(opts: {
  product: {
    title: string;
    slug: string;
    status: string;
    shortDescription?: string | null | undefined;
    seo?: unknown;
    media?: Array<{ url?: string | undefined }> | undefined;
  };
  seoSettings: SeoSettings | null;
  storeSettings: { storeName: string } | null;
  storeStatusMode?: string | undefined;
  noindex?: boolean | undefined;
  host: string;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.product.seo === "object" && opts.product.seo !== null) ? (opts.product.seo as Record<string, unknown>) : {};
  const storedTitle = typeof seoObj.title === "string" && seoObj.title.trim().length > 0 ? seoObj.title.trim() : null;
  const storedDescription = typeof seoObj.description === "string" && seoObj.description.trim().length > 0 ? seoObj.description.trim() : null;

  const title = storedTitle ?? formatTitle(opts.seoSettings?.titleTemplate, opts.product.title, storeName);
  const description = storedDescription ?? opts.product.shortDescription ?? `Buy ${opts.product.title} at ${storeName}.`;

  const isStoreBlocked = opts.noindex === true || opts.storeStatusMode === "coming_soon" || opts.storeStatusMode === "password" || opts.storeStatusMode === "maintenance" || opts.storeStatusMode === "suspended" || opts.seoSettings?.indexingEnabled === false;

  const isUnlisted = opts.product.status === "unlisted";
  const shouldIndex = !isStoreBlocked && !isUnlisted;
  const shouldFollow = !isStoreBlocked;

  const firstImage = opts.product.media?.[0]?.url;

  return {
    title,
    description,
    robots: {
      index: shouldIndex,
      follow: shouldFollow,
    },
    openGraph: {
      title,
      description,
      images: firstImage ? [{ url: firstImage }] : undefined,
    },
    alternates: {
      canonical: `https://${cleanHost}/products/${opts.product.slug}`,
    },
  };
}

/**
 * Queries all published entities for a tenant and builds a complete sitemap list:
 * - Home page (/, daily, 1.0)
 * - Published products (listed statuses only, weekly, 0.8)
 * - Published, indexable, non-empty collections (/collections/[slug], weekly, 0.7)
 * - Active, non-empty categories (/categories/[slug], weekly, 0.7)
 * - Published custom pages (/pages/[slug], monthly, 0.5)
 * - Published blog posts (/blog/[slug], monthly, 0.6)
 * - Static policy pages (/policies/..., yearly, 0.3)
 */
export async function getStorefrontSitemapUrls(
  rt: Runtime,
  ctx: TenantContext,
  host: string,
): Promise<SitemapUrlItem[]> {
  const cleanHost = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const baseUrl = `https://${cleanHost}`;
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Published Products (Listed statuses only)
    const productRows = await tx
      .select({
        slug: schema.products.slug,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.tenantId, ctx.tenantId),
          inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
          isNull(schema.products.deletedAt),
        ),
      )
      .orderBy(desc(schema.products.updatedAt));

    // 2. Published & Indexable Collections
    const collectionRows = await tx
      .select()
      .from(schema.collections)
      .where(
        and(
          eq(schema.collections.tenantId, ctx.tenantId),
          eq(schema.collections.published, true),
          eq(schema.collections.indexable, true),
        ),
      )
      .orderBy(desc(schema.collections.updatedAt));

    const eligibleCollections: typeof collectionRows = [];
    for (const col of collectionRows) {
      if (col.type === "automated" && col.rules) {
        const parsed = parseCollectionRules(col.rules);
        const conds = parsed.map((r) => buildSingleRuleCondition(r, schema.products));
        const combined = col.match === "any" ? (conds.length > 0 ? or(...conds) : undefined) : (conds.length > 0 ? and(...conds) : undefined);
        const [p] = await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(
            and(
              eq(schema.products.tenantId, ctx.tenantId),
              inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
              isNull(schema.products.deletedAt),
              combined,
            ),
          )
          .limit(1);
        if (p) eligibleCollections.push(col);
      } else {
        const [p] = await tx
          .select({ id: schema.products.id })
          .from(schema.collectionProducts)
          .innerJoin(
            schema.products,
            and(
              eq(schema.products.tenantId, schema.collectionProducts.tenantId),
              eq(schema.products.id, schema.collectionProducts.productId),
            ),
          )
          .where(
            and(
              eq(schema.collectionProducts.collectionId, col.id),
              inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
              isNull(schema.products.deletedAt),
            ),
          )
          .limit(1);
        if (p) eligibleCollections.push(col);
      }
    }

    // 3. Active, Non-empty Categories
    const categoryRows = await tx
      .select({
        slug: schema.categories.slug,
        updatedAt: schema.categories.updatedAt,
      })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.tenantId, ctx.tenantId),
          sql`exists (
            select 1 from ${schema.productCategories} pc
            join ${schema.products} p on p.tenant_id = pc.tenant_id and p.id = pc.product_id
            where pc.tenant_id = ${schema.categories.tenantId}
              and pc.category_id = ${schema.categories.id}
              and p.status in ('active', 'published')
              and p.deleted_at is null
          )`,
        ),
      )
      .orderBy(desc(schema.categories.updatedAt));

    // 4. Published Custom Pages (excluding "home" which is mapped to /)
    const pageRows = await tx
      .select({
        slug: schema.pages.slug,
        type: schema.pages.type,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.tenantId, ctx.tenantId),
          eq(schema.pages.status, "published"),
        ),
      )
      .orderBy(desc(schema.pages.updatedAt));

    const sitemapItems: SitemapUrlItem[] = [];

    // Home page
    const homePageRow = pageRows.find((p) => p.type === "home");
    sitemapItems.push({
      loc: baseUrl,
      lastmod: homePageRow ? homePageRow.updatedAt.toISOString() : new Date().toISOString(),
      changefreq: "daily",
      priority: 1.0,
    });

    // Products
    for (const p of productRows) {
      sitemapItems.push({
        loc: `${baseUrl}/products/${p.slug}`,
        lastmod: p.updatedAt.toISOString(),
        changefreq: "weekly",
        priority: 0.8,
      });
    }

    // Collections
    for (const c of eligibleCollections) {
      sitemapItems.push({
        loc: `${baseUrl}/collections/${c.slug}`,
        lastmod: c.updatedAt.toISOString(),
        changefreq: "weekly",
        priority: 0.7,
      });
    }

    // Categories
    for (const cat of categoryRows) {
      sitemapItems.push({
        loc: `${baseUrl}/categories/${cat.slug}`,
        lastmod: cat.updatedAt.toISOString(),
        changefreq: "weekly",
        priority: 0.7,
      });
    }

    // Custom pages (type !== 'home')
    for (const page of pageRows) {
      if (page.type !== "home") {
        sitemapItems.push({
          loc: `${baseUrl}/pages/${page.slug}`,
          lastmod: page.updatedAt.toISOString(),
          changefreq: "monthly",
          priority: 0.5,
        });
      }
    }

    // Blog posts
    for (const blog of STATIC_BLOG_POSTS) {
      sitemapItems.push({
        loc: `${baseUrl}/blog/${blog.slug}`,
        lastmod: blog.publishedAt,
        changefreq: "monthly",
        priority: 0.6,
      });
    }

    // Static policy pages
    for (const policy of STATIC_POLICY_PAGES) {
      sitemapItems.push({
        loc: `${baseUrl}${policy.path}`,
        changefreq: policy.changefreq,
        priority: policy.priority,
      });
    }

    return sitemapItems;
  });
}
