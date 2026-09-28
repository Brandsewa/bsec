import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import type { StorefrontProductDetail } from "./catalog.ts";

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
