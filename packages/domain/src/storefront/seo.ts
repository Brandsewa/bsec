import { and, desc, eq, isNull, inArray, notInArray, or, sql } from "drizzle-orm";
import { listBlogForSitemap } from "../blog/queries.ts";
import { LISTED_PRODUCT_STATUSES } from "./product-status.ts";
import { ALL_PRODUCTS_PATH } from "./catalog.ts";
import { decodeEntities } from "../html-entities.ts";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { syncMediaUsages } from "../media-services.ts";
import { THEME_SYSTEM_PAGE_TYPES } from "../themes/system-pages.ts";
import { toMajorUnits } from "@bs/contracts/money";
import { publicMediaUrl } from "../media/storage.ts";
import { buildHreflangAlternates, marketHreflangs, type HreflangAlternate } from "./seo-markets.ts";
import { buildMerchantReturnPolicyJsonLd, buildReviewsJsonLd, buildShippingDetailsJsonLd, type StorefrontOfferExtras } from "./seo-offers.ts";
import { loadStorefrontMarkets } from "../markets/lookup.ts";
import { withMarketScope } from "../markets/scope.ts";
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

/**
 * AI crawlers a store can allow or block (Settings > SEO). Search and user-triggered agents fetch a page to answer a
 * shopper's question and cite it, so blocking them hides the store from AI answers (GEO/AEO): allowed by default.
 * Training-only crawlers are allowed too, except two bulk scrapers that send no traffic back. Merchants can flip any of them.
 */
export const DEFAULT_AI_CRAWLERS: Record<string, "allow" | "block"> = {
  "OAI-SearchBot": "allow",
  "ChatGPT-User": "allow",
  GPTBot: "allow",
  "Claude-SearchBot": "allow",
  "Claude-User": "allow",
  ClaudeBot: "allow",
  PerplexityBot: "allow",
  "Perplexity-User": "allow",
  "Google-Extended": "allow",
  "Applebot-Extended": "allow",
  CCBot: "block",
  Bytespider: "block",
};

/**
 * Paths that are never useful in a search index: carts, checkout, per-customer tokens, internal search results.
 * robots.txt keeps crawlers out (saves crawl budget); the pages are also noindex, so a leaked link cannot be indexed.
 */
export const PRIVATE_PATHS = [
  "/cart",
  "/checkout",
  "/orders/",
  "/account",
  "/search",
  "/track",
  "/preview/",
  "/cod/",
  "/address/",
  "/o/",
  "/privacy-request",
  "/privacy-verify",
  "/unsubscribe/",
  "/api/",
];

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
  // Plain text: a name or title saved with entities ("&amp;") would otherwise show the entity in the browser tab.
  return decodeEntities(tpl.replace(/%s/g, () => decodeEntities(title)).replace(/\{\{store_name\}\}/g, () => decodeEntities(storeName)));
}

export const generateTitle = formatTitle;

/** Longest description search engines show before cutting it off (about 155 characters on desktop). */
export const META_DESCRIPTION_MAX = 155;

/** Plain text from a stored description: a string, HTML, or the admin's `{ type: "text", text }` value. Empty when there is none. */
export function cleanMetaText(input: unknown): string {
  const raw = typeof input === "string" ? input : input && typeof input === "object" && typeof (input as { text?: unknown }).text === "string" ? (input as { text: string }).text : "";
  return decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts text to `max` characters at a word boundary, with an ellipsis when it was cut. */
export function clampMetaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= max * 0.6 ? atWord : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

const TEXT_KEY = /^(subtitle|text|body|description|content|intro|heading|html)$/i;

/**
 * The first real sentence of copy in a page's blocks (document order), for a page whose merchant wrote no description. Text shorter
 * than `minLength` is skipped (a button label or a heading is not a description). Returns "" when there is none.
 */
export function firstTextOfBlocks(node: unknown, minLength = 40, depth = 0): string {
  if (depth > 12) return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const t = firstTextOfBlocks(item, minLength, depth + 1);
      if (t) return t;
    }
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && TEXT_KEY.test(k)) {
        const t = cleanMetaText(v);
        if (t.length >= minLength) return t;
      } else if (v && typeof v === "object") {
        const t = firstTextOfBlocks(v, minLength, depth + 1);
        if (t) return t;
      }
    }
  }
  return "";
}

/**
 * The description to put in the page head when the merchant wrote none: the first candidate that has text (an empty string is
 * not text), with HTML removed and the length capped, else the fallback. Never returns an empty string.
 */
export function deriveMetaDescription(candidates: unknown[], fallback: string): string {
  for (const c of candidates) {
    const text = cleanMetaText(c);
    if (text) return clampMetaDescription(text);
  }
  return fallback;
}

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
  legalName?: string | null;
  email?: string | null;
  telephone?: string | null;
}): OrganizationJsonLd {
  const result: OrganizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${opts.url.replace(/\/$/, "")}/#organization`,
    name: opts.name,
    url: opts.url,
  };

  if (opts.legalName && opts.legalName !== opts.name) result.legalName = opts.legalName;

  // Google wants a logo as an ImageObject or URL it can crawl; an https URL on the store's media domain qualifies.
  if (opts.logoUrl) {
    result.logo = opts.logoUrl;
  }

  // A customer-service contact point only when the merchant gave one: nothing is invented.
  if (opts.email || opts.telephone) {
    result.contactPoint = {
      "@type": "ContactPoint",
      contactType: "customer service",
      ...(opts.email ? { email: opts.email } : {}),
      ...(opts.telephone ? { telephone: opts.telephone } : {}),
    };
  }

  if (opts.sameAs && opts.sameAs.length > 0) {
    result.sameAs = opts.sameAs;
  }

  return result;
}

/** Keeps only absolute https URLs, de-duplicated: merchant-entered profile links go straight into structured data. */
export function cleanSameAs(values: unknown): string[] {
  if (!values || typeof values !== "object") return [];
  const raw = Array.isArray(values) ? values : Object.values(values as Record<string, unknown>);
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    try {
      const u = new URL(v.trim());
      if (u.protocol === "https:") out.add(u.toString());
    } catch {
      // not a URL: skip
    }
  }
  return [...out];
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
  currency = "INR",
  opts: { storeName?: string | undefined; urlPrefix?: string | null | undefined; extras?: StorefrontOfferExtras | undefined } = {},
): ProductJsonLd {
  const baseUrl = storeUrl.replace(/\/$/, "");
  const pfx = opts.urlPrefix ? (opts.urlPrefix.startsWith("/") ? opts.urlPrefix : `/${opts.urlPrefix}`) : "";
  const productUrl = `${baseUrl}${pfx}/products/${product.slug}`;

  const images = (product.media ?? [])
    .map((m) => m.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  // Variant prices are stored in minor units (paise, cents); schema.org and Google want the amount a shopper sees.
  // A price-on-request product has no price to publish, so it carries no offers at all.
  const returnPolicy = buildMerchantReturnPolicyJsonLd(opts.extras?.returnPolicy);
  const offers: ProductOfferJsonLd[] = product.priceOnRequest
    ? []
    : (product.variants ?? []).map((v) => {
        const isAvailable = v.stockStatus === "in_stock" || v.stockStatus === "low_stock";
        const availability = isAvailable
          ? v.preorderEnabled
            ? "https://schema.org/PreOrder"
            : "https://schema.org/InStock"
          : v.allowBackorder
            ? "https://schema.org/BackOrder"
            : "https://schema.org/OutOfStock";
        const offer: ProductOfferJsonLd = {
          "@type": "Offer",
          price: toMajorUnits(v.price, currency),
          priceCurrency: currency,
          availability,
          url: `${productUrl}?variant=${v.id}`,
          sku: v.sku,
          itemCondition: "https://schema.org/NewCondition",
        };
        // GTIN is only valid as 8, 12, 13 or 14 digits; anything else would make the item invalid in Merchant Center.
        if (v.barcode && /^(\d{8}|\d{12,14})$/.test(v.barcode.trim())) offer["gtin"] = v.barcode.trim();
        if (opts.storeName) offer["seller"] = { "@type": "Organization", name: opts.storeName };
        // Merchant listing details, from the store's own settings (seo-offers.ts). Nothing is added for what is not configured.
        if (returnPolicy) offer["hasMerchantReturnPolicy"] = returnPolicy;
        const shippingDetails = buildShippingDetailsJsonLd(opts.extras?.shipping, { subtotalPaise: v.price, weightGrams: v.weightGrams, currency });
        if (shippingDetails.length > 0) offer["shippingDetails"] = shippingDetails.length === 1 ? shippingDetails[0] : shippingDetails;
        return offer;
      });

  const firstSku = (product.variants ?? []).find((v) => v.sku)?.sku;

  const result: ProductJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${productUrl}#product`,
    url: productUrl,
    name: product.title,
    description: cleanMetaText(product.shortDescription) || cleanMetaText(product.descriptionJson) || undefined,
    image: images.length > 0 ? images : undefined,
    sku: firstSku,
    category: product.productType ?? undefined,
    offers: offers.length > 0 ? offers : undefined,
  };

  // Google Merchant Center asks for a brand on every product; a store that sets none is its own brand.
  const brandName = product.brand?.name?.trim() || opts.storeName?.trim();
  if (brandName) {
    result.brand = {
      "@type": "Brand",
      name: brandName,
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
    // Individual reviews only alongside a real rating, and only the newest few that the page itself shows.
    const reviews = buildReviewsJsonLd(opts.extras?.reviews);
    if (reviews.length > 0) result["review"] = reviews;
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
  lines.push("Allow: /");
  for (const path of PRIVATE_PATHS) lines.push(`Disallow: ${path}`);

  if (seoSettings?.robotsExtra) {
    const extra = seoSettings.robotsExtra.trim();
    if (extra.length > 0) {
      lines.push(extra);
    }
  }

  // AI crawlers. Only blocked ones get a group: a bot with its own group ignores the "*" group, so an explicit
  // "Allow: /" group would also let it into the cart and checkout. Allowed bots simply follow the rules above.
  const crawlerConfig: Record<string, "allow" | "block"> = {
    ...DEFAULT_AI_CRAWLERS,
    ...(seoSettings?.aiCrawlers ?? {}),
  };

  for (const [bot, action] of Object.entries(crawlerConfig)) {
    if (action !== "block") continue;
    lines.push("");
    lines.push(`User-agent: ${bot}`);
    lines.push("Disallow: /");
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

export interface StorefrontShareImage {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  alt?: string | undefined;
}

export interface StorefrontBrandAssets {
  logoUrl: string | null;
  faviconUrl: string | null;
  appleTouchIconUrl: string | null;
  /** "32x32" style sizes of the icons, when the file's dimensions are known (web manifest). */
  faviconSizes: string | null;
  appleTouchIconSizes: string | null;
  /** Image used for og:image and twitter:image on pages that have none of their own. */
  shareImage: StorefrontShareImage | null;
}

/**
 * Public brand images for the page head and structured data: logo, favicon, apple touch icon and the default share image.
 * The share image is the SEO default image, else the brand's social image, else the logo, so every page that has no picture of
 * its own still shows the store when a link is pasted or cited. Only files with a public URL are returned.
 */
export async function getStorefrontBrandAssets(rt: Runtime, tenantId: string): Promise<StorefrontBrandAssets> {
  return withTenant(rt._db.db, tenantId, async (tx) => {
    const [brand] = await tx
      .select({
        logo: schema.brandSettings.logoMediaId,
        favicon: schema.brandSettings.faviconMediaId,
        apple: schema.brandSettings.appleTouchIconMediaId,
        social: schema.brandSettings.socialImageMediaId,
      })
      .from(schema.brandSettings)
      .where(eq(schema.brandSettings.tenantId, tenantId))
      .limit(1);
    const [seo] = await tx
      .select({ og: schema.seoSettings.defaultOgImageMediaId })
      .from(schema.seoSettings)
      .where(eq(schema.seoSettings.tenantId, tenantId))
      .limit(1);

    const ids = [brand?.logo, brand?.favicon, brand?.apple, brand?.social, seo?.og].filter((v): v is string => Boolean(v));
    if (ids.length === 0) return { logoUrl: null, faviconUrl: null, appleTouchIconUrl: null, faviconSizes: null, appleTouchIconSizes: null, shareImage: null };
    const rows = await tx
      .select({ id: schema.media.id, storageKey: schema.media.storageKey, width: schema.media.width, height: schema.media.height, alt: schema.media.alt })
      .from(schema.media)
      .where(inArray(schema.media.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const urlOf = (id: string | null | undefined): string | null => {
      const row = id ? byId.get(id) : undefined;
      return (row && publicMediaUrl(row.storageKey)) || null;
    };
    const imageOf = (id: string | null | undefined): StorefrontShareImage | null => {
      const row = id ? byId.get(id) : undefined;
      const url = urlOf(id);
      if (!row || !url) return null;
      return { url, ...(row.width ? { width: row.width } : {}), ...(row.height ? { height: row.height } : {}), ...(row.alt?.trim() ? { alt: row.alt.trim() } : {}) };
    };
    const sizesOf = (id: string | null | undefined): string | null => {
      const row = id ? byId.get(id) : undefined;
      return row?.width && row?.height ? `${row.width}x${row.height}` : null;
    };
    return {
      logoUrl: urlOf(brand?.logo),
      faviconUrl: urlOf(brand?.favicon),
      appleTouchIconUrl: urlOf(brand?.apple),
      faviconSizes: sizesOf(brand?.favicon),
      appleTouchIconSizes: sizesOf(brand?.apple),
      shareImage: imageOf(seo?.og) ?? imageOf(brand?.social) ?? imageOf(brand?.logo),
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

    let targetId = existing?.id;
    if (existing) {
      await tx
        .update(schema.seoSettings)
        .set(updateValues)
        .where(eq(schema.seoSettings.id, existing.id));
    } else {
      const [inserted] = await tx
        .insert(schema.seoSettings)
        .values({
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
        })
        .returning({ id: schema.seoSettings.id });
      targetId = inserted?.id;
    }

    if (input.defaultOgImageMediaId !== undefined) {
      await syncMediaUsages(tx, ctx, {
        ownerType: "store_branding",
        ownerId: (targetId ?? ctx.tenantId) as string,
        field: "seo_og_image",
        mediaIds: [input.defaultOgImageMediaId],
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
  /** Product pictures for Google image search (image sitemap extension). */
  images?: Array<{ loc: string; title?: string | undefined }> | undefined;
  /** The same page in the store's other markets (hreflang), only when every market has a distinct language-region code. */
  alternates?: HreflangAlternate[] | undefined;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Generates valid Sitemap 0.9 XML string from a list of URLs.
 */
export function generateSitemapXml(urls: SitemapUrlItem[]): string {
  // The image and xhtml namespaces are declared only when an entry uses them, so a plain sitemap stays byte-for-byte as before.
  const hasImages = urls.some((u) => (u.images?.length ?? 0) > 0);
  const hasAlternates = urls.some((u) => (u.alternates?.length ?? 0) > 0);
  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ""}${hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ""}>`,
  ];

  for (const item of urls) {
    xmlLines.push("  <url>");
    xmlLines.push(`    <loc>${escapeXml(item.loc)}</loc>`);
    if (item.lastmod) {
      xmlLines.push(`    <lastmod>${item.lastmod}</lastmod>`);
    }
    if (item.changefreq) {
      xmlLines.push(`    <changefreq>${item.changefreq}</changefreq>`);
    }
    if (item.priority !== undefined) {
      xmlLines.push(`    <priority>${item.priority.toFixed(1)}</priority>`);
    }
    for (const alt of item.alternates ?? []) {
      xmlLines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>`);
    }
    for (const img of item.images ?? []) {
      xmlLines.push("    <image:image>");
      xmlLines.push(`      <image:loc>${escapeXml(img.loc)}</image:loc>`);
      if (img.title) xmlLines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
      xmlLines.push("    </image:image>");
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
    url?: string | undefined;
    siteName?: string | undefined;
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
  prefix?: string | null | undefined;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const pfx = opts.prefix ? (opts.prefix.startsWith("/") ? opts.prefix : `/${opts.prefix}`) : "";
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.category.seo === "object" && opts.category.seo !== null) ? (opts.category.seo as Record<string, unknown>) : {};
  const storedTitle = typeof seoObj.title === "string" && seoObj.title.trim().length > 0 ? decodeEntities(seoObj.title.trim()) : null;
  const storedDescription = typeof seoObj.description === "string" && seoObj.description.trim().length > 0 ? decodeEntities(seoObj.description.trim()) : null;

  const title = storedTitle ?? formatTitle(opts.seoSettings?.titleTemplate, opts.category.name, storeName);
  const description = storedDescription ?? deriveMetaDescription([opts.category.description], `Browse ${opts.category.name} at ${storeName}. High-quality products and great deals.`);

  const isStoreBlocked = opts.noindex === true || opts.storeStatusMode === "coming_soon" || opts.storeStatusMode === "password" || opts.storeStatusMode === "maintenance" || opts.storeStatusMode === "suspended" || opts.seoSettings?.indexingEnabled === false;

  const isEmpty = opts.productsCount <= 0;
  const isFiltered = Boolean(opts.hasFilterOrSortParams);
  const pageNum = opts.page ?? 1;

  const shouldIndex = !isStoreBlocked && !isEmpty && !isFiltered;
  const shouldFollow = !isStoreBlocked;

  let canonicalUrl = `https://${cleanHost}${pfx}/categories/${opts.category.slug}`;
  if (!isFiltered && pageNum > 1 && !isEmpty) {
    canonicalUrl = `https://${cleanHost}${pfx}/categories/${opts.category.slug}?page=${pageNum}`;
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
      url: canonicalUrl,
      siteName: storeName,
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
  prefix?: string | null | undefined;
  /** The page's own path when it is not `/collections/<slug>` (the all-products listing). */
  path?: string | undefined;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const pfx = opts.prefix ? (opts.prefix.startsWith("/") ? opts.prefix : `/${opts.prefix}`) : "";
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.collection.seo === "object" && opts.collection.seo !== null) ? (opts.collection.seo as Record<string, unknown>) : {};
  const storedTitle = typeof seoObj.title === "string" && seoObj.title.trim().length > 0 ? decodeEntities(seoObj.title.trim()) : null;
  const storedDescription = typeof seoObj.description === "string" && seoObj.description.trim().length > 0 ? decodeEntities(seoObj.description.trim()) : null;

  const title = storedTitle ?? formatTitle(opts.seoSettings?.titleTemplate, opts.collection.title, storeName);
  const description = storedDescription ?? deriveMetaDescription([opts.collection.description], `Shop ${opts.collection.title} at ${storeName}. High-quality products and great deals.`);

  const isStoreBlocked = opts.noindex === true || opts.storeStatusMode === "coming_soon" || opts.storeStatusMode === "password" || opts.storeStatusMode === "maintenance" || opts.storeStatusMode === "suspended" || opts.seoSettings?.indexingEnabled === false;

  const isEmpty = opts.productsCount <= 0;
  const isFiltered = Boolean(opts.hasFilterOrSortParams);
  const pageNum = opts.page ?? 1;

  const isEligible = opts.collection.published && opts.collection.indexable && !isEmpty;
  const shouldIndex = !isStoreBlocked && isEligible && !isFiltered;
  const shouldFollow = !isStoreBlocked;

  const ownPath = opts.path ?? `/collections/${opts.collection.slug}`;
  let canonicalUrl = `https://${cleanHost}${pfx}${ownPath}`;
  if (!isFiltered && pageNum > 1 && isEligible) {
    canonicalUrl = `https://${cleanHost}${pfx}${ownPath}?page=${pageNum}`;
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
      url: canonicalUrl,
      siteName: storeName,
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
    /** The long description; used for the page description when there is no short one. */
    descriptionJson?: unknown;
    seo?: unknown;
    media?: Array<{ url?: string | undefined }> | undefined;
  };
  seoSettings: SeoSettings | null;
  storeSettings: { storeName: string } | null;
  storeStatusMode?: string | undefined;
  noindex?: boolean | undefined;
  host: string;
  prefix?: string | null | undefined;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const pfx = opts.prefix ? (opts.prefix.startsWith("/") ? opts.prefix : `/${opts.prefix}`) : "";
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.product.seo === "object" && opts.product.seo !== null) ? (opts.product.seo as Record<string, unknown>) : {};
  const storedTitle = typeof seoObj.title === "string" && seoObj.title.trim().length > 0 ? decodeEntities(seoObj.title.trim()) : null;
  const storedDescription = typeof seoObj.description === "string" && seoObj.description.trim().length > 0 ? decodeEntities(seoObj.description.trim()) : null;

  const title = storedTitle ?? formatTitle(opts.seoSettings?.titleTemplate, opts.product.title, storeName);
  const description = storedDescription ?? deriveMetaDescription([opts.product.shortDescription, opts.product.descriptionJson], `Buy ${opts.product.title} at ${storeName}.`);

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
      url: `https://${cleanHost}${pfx}/products/${opts.product.slug}`,
      siteName: storeName,
    },
    alternates: {
      canonical: `https://${cleanHost}${pfx}/products/${opts.product.slug}`,
    },
  };
}

/**
 * Builds the home page's metadata. The home page record is called "Home", which is a poor search title, so the title
 * falls back to the store name; the description falls back to the store-wide default, then a plain sentence.
 * The canonical is the bare host (or market prefix) so www/http/utm variants collapse into one URL.
 */
export function buildHomeSeoMetadata(opts: {
  homePage: { title?: string | null | undefined; seo?: unknown } | null;
  seoSettings: SeoSettings | null;
  storeSettings: { storeName: string } | null;
  storeStatusMode?: string | undefined;
  noindex?: boolean | undefined;
  host: string;
  prefix?: string | null | undefined;
}): SeoMetadataResult {
  const cleanHost = opts.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const pfx = opts.prefix ? (opts.prefix.startsWith("/") ? opts.prefix : `/${opts.prefix}`) : "";
  const storeName = opts.storeSettings?.storeName ?? "Store";
  const seoObj = (typeof opts.homePage?.seo === "object" && opts.homePage.seo !== null) ? (opts.homePage.seo as Record<string, unknown>) : {};
  const pick = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

  const pageTitle = pick(opts.homePage?.title);
  // "Home" (the record's default name) says nothing to a search engine: use the store name instead.
  const genericTitle = !pageTitle || /^(home|homepage|home page)$/i.test(pageTitle);
  const title = pick(seoObj.title) ?? (genericTitle ? storeName : formatTitle(opts.seoSettings?.titleTemplate, pageTitle, storeName));
  const description =
    pick(seoObj.description) ?? pick(opts.seoSettings?.defaultMetaDescription) ?? `Shop online at ${storeName}. Browse the full range and order with fast delivery.`;

  const isStoreBlocked = opts.noindex === true || opts.storeStatusMode === "coming_soon" || opts.storeStatusMode === "password" || opts.storeStatusMode === "maintenance" || opts.storeStatusMode === "suspended" || opts.seoSettings?.indexingEnabled === false;
  const canonical = `https://${cleanHost}${pfx || ""}${pfx ? "" : "/"}`;

  return {
    title,
    description,
    robots: { index: !isStoreBlocked, follow: !isStoreBlocked },
    openGraph: { title, description, url: canonical, siteName: storeName },
    alternates: { canonical },
  };
}

export async function getScopedCatalogForSitemap(
  tx: Db,
  tenantId: string,
) {
  // 1. Published Products (Listed statuses only)
  const productRows = await tx
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      title: schema.products.title,
      shortDescription: schema.products.shortDescription,
      updatedAt: schema.products.updatedAt,
    })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.tenantId, tenantId),
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
        eq(schema.collections.tenantId, tenantId),
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
            eq(schema.products.tenantId, tenantId),
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
      name: schema.categories.name,
      description: schema.categories.description,
      updatedAt: schema.categories.updatedAt,
    })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.tenantId, tenantId),
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

  return { productRows, eligibleCollections, categoryRows };
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
 * - For active non-base markets with path prefixes (e.g. /us):
 *   Market home (/us), and the products, collections, categories that market actually sells (under withMarketScope)
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
    // 1. Base catalog query
    const { productRows, eligibleCollections, categoryRows } = await getScopedCatalogForSitemap(tx, ctx.tenantId);

    // 2. Published Custom Pages (excluding "home" and theme system pages)
    const pageRows = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.tenantId, ctx.tenantId),
          eq(schema.pages.status, "published"),
          notInArray(schema.pages.type, [...THEME_SYSTEM_PAGE_TYPES]),
        ),
      )
      .orderBy(desc(schema.pages.updatedAt));

    const sitemapItems: SitemapUrlItem[] = [];

    // Product pictures for the image sitemap: the first few per product, in the merchant's order, with a public URL.
    const imageRows = await tx
      .select({ productId: schema.productMedia.productId, storageKey: schema.media.storageKey, alt: schema.productMedia.alt, mediaAlt: schema.media.alt })
      .from(schema.productMedia)
      .innerJoin(schema.media, and(eq(schema.media.tenantId, schema.productMedia.tenantId), eq(schema.media.id, schema.productMedia.mediaId)))
      .innerJoin(schema.products, and(eq(schema.products.tenantId, schema.productMedia.tenantId), eq(schema.products.id, schema.productMedia.productId)))
      .where(and(eq(schema.productMedia.tenantId, ctx.tenantId), inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]), isNull(schema.products.deletedAt)))
      .orderBy(schema.productMedia.productId, schema.productMedia.position);
    const imagesByProduct = new Map<string, Array<{ loc: string; title?: string | undefined }>>();
    for (const r of imageRows) {
      const loc = publicMediaUrl(r.storageKey);
      if (!loc) continue;
      const list = imagesByProduct.get(r.productId) ?? [];
      if (list.length >= 5) continue;
      const title = (r.alt?.trim() || r.mediaAlt?.trim()) || undefined;
      list.push({ loc, ...(title ? { title } : {}) });
      imagesByProduct.set(r.productId, list);
    }
    const imagesFor = (productId: string) => {
      const imgs = imagesByProduct.get(productId);
      return imgs && imgs.length > 0 ? { images: imgs } : {};
    };

    // Home page
    const homePageRow = pageRows.find((p) => p.type === "home");
    // Without a saved home page the real change time is unknown: omit lastmod rather than claim the page changed just now.
    const homeLastMod = homePageRow ? homePageRow.updatedAt.toISOString() : undefined;
    sitemapItems.push({
      loc: baseUrl,
      lastmod: homeLastMod,
      changefreq: "daily",
      priority: 1.0,
    });

    // Base Products
    for (const p of productRows) {
      sitemapItems.push({
        loc: `${baseUrl}/products/${p.slug}`,
        lastmod: p.updatedAt.toISOString(),
        changefreq: "weekly",
        priority: 0.8,
        ...imagesFor(p.id),
      });
    }

    // The built-in all-products listing.
    if (productRows.length > 0) {
      sitemapItems.push({ loc: `${baseUrl}${ALL_PRODUCTS_PATH}`, lastmod: productRows[0]?.updatedAt.toISOString() ?? homeLastMod, changefreq: "daily", priority: 0.7 });
    }

    // The two index pages (`/collections`, `/categories`), once the store has something to list; their lastmod is the newest entry's.
    const newest = (rows: Array<{ updatedAt: Date }>): string => rows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), rows[0]?.updatedAt ?? new Date(0)).toISOString();
    if (eligibleCollections.length > 0) {
      sitemapItems.push({ loc: `${baseUrl}/collections`, lastmod: newest(eligibleCollections), changefreq: "weekly", priority: 0.6 });
    }
    if (categoryRows.length > 0) {
      sitemapItems.push({ loc: `${baseUrl}/categories`, lastmod: newest(categoryRows), changefreq: "weekly", priority: 0.6 });
    }

    // Base Collections
    for (const c of eligibleCollections) {
      sitemapItems.push({
        loc: `${baseUrl}/collections/${c.slug}`,
        lastmod: c.updatedAt.toISOString(),
        changefreq: "weekly",
        priority: 0.7,
      });
    }

    // Base Categories
    for (const cat of categoryRows) {
      sitemapItems.push({
        loc: `${baseUrl}/categories/${cat.slug}`,
        lastmod: cat.updatedAt.toISOString(),
        changefreq: "weekly",
        priority: 0.7,
      });
    }

    // Active markets with pathPrefix (WP-6: SEO and sitemap per market)
    // Only active markets; never expose draft or disabled markets; base market is already unprefixed.
    const markets = await loadStorefrontMarkets(tx, ctx.tenantId).catch(() => []);
    const extraMarkets = markets.filter((m) => !m.isBase && m.pathPrefix && m.pathPrefix.trim().length > 0);

    for (const market of extraMarkets) {
      const rawPrefix = market.pathPrefix;
      if (!rawPrefix) continue;
      const prefix = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
      const marketBaseUrl = `${baseUrl}${prefix}`;

      // Market home
      sitemapItems.push({
        loc: marketBaseUrl,
        lastmod: homeLastMod,
        changefreq: "daily",
        priority: 1.0,
      });

      // Products & Collections scoped to this market
      const scopedCatalog = await withMarketScope(
        db,
        { tenantId: ctx.tenantId, marketId: market.id },
        async (txScoped) => getScopedCatalogForSitemap(txScoped, ctx.tenantId),
      );

      for (const p of scopedCatalog.productRows) {
        sitemapItems.push({
          loc: `${marketBaseUrl}/products/${p.slug}`,
          lastmod: p.updatedAt.toISOString(),
          changefreq: "weekly",
          priority: 0.8,
          ...imagesFor(p.id),
        });
      }

      for (const c of scopedCatalog.eligibleCollections) {
        sitemapItems.push({
          loc: `${marketBaseUrl}/collections/${c.slug}`,
          lastmod: c.updatedAt.toISOString(),
          changefreq: "weekly",
          priority: 0.7,
        });
      }

      for (const cat of scopedCatalog.categoryRows) {
        sitemapItems.push({
          loc: `${marketBaseUrl}/categories/${cat.slug}`,
          lastmod: cat.updatedAt.toISOString(),
          changefreq: "weekly",
          priority: 0.7,
        });
      }
    }

    const pagesById = new Map(pageRows.map((p) => [p.id, p]));
    function getCanonicalPath(page: { id: string; slug: string; parentId: string | null; type: string }): string {
      const segments = [page.slug];
      let cur = page.parentId;
      const visited = new Set<string>();
      while (cur) {
        if (visited.has(cur)) break;
        visited.add(cur);
        const parent = pagesById.get(cur);
        if (!parent) break;
        segments.unshift(parent.slug);
        cur = parent.parentId;
      }
      return `/pages/${segments.join("/")}`;
    }

    // Custom pages (type !== 'home')
    for (const page of pageRows) {
      if (page.type !== "home") {
        sitemapItems.push({
          loc: `${baseUrl}${getCanonicalPath(page)}`,
          lastmod: page.updatedAt.toISOString(),
          changefreq: "monthly",
          priority: 0.5,
        });
      }
    }

    // Blog: real, visible, indexable posts and the categories that have any (ADR-033)
    const blog = await listBlogForSitemap(tx, ctx.tenantId);
    if (blog.enabled) {
      sitemapItems.push({ loc: `${baseUrl}/blog`, lastmod: blog.posts[0]?.lastmod.toISOString(), changefreq: "weekly", priority: 0.6 });
      for (const c of blog.categories) {
        sitemapItems.push({ loc: `${baseUrl}/blog/category/${c.path}`, lastmod: c.lastmod.toISOString(), changefreq: "weekly", priority: 0.5 });
      }
      for (const p of blog.posts) {
        sitemapItems.push({ loc: `${baseUrl}/blog/${p.slug}`, lastmod: p.lastmod.toISOString(), changefreq: "monthly", priority: 0.6 });
      }
    }

    // Policy pages: only the ones the merchant has published. An unpublished policy is either a 404 or the platform's
    // generic boilerplate (the same text on every store), neither of which belongs in a sitemap.
    const publishedPolicies = await tx
      .select({ handle: schema.storePolicies.handle })
      .from(schema.storePolicies)
      .where(and(eq(schema.storePolicies.tenantId, ctx.tenantId), sql`${schema.storePolicies.publishedVersionId} is not null`));
    const publishedHandles = new Set(publishedPolicies.map((r) => r.handle));
    for (const policy of STATIC_POLICY_PAGES) {
      if (!publishedHandles.has(policy.path.replace("/policies/", ""))) continue;
      sitemapItems.push({
        loc: `${baseUrl}${policy.path}`,
        changefreq: policy.changefreq,
        priority: policy.priority,
      });
    }
    if (publishedHandles.has("legal_notice")) {
      sitemapItems.push({ loc: `${baseUrl}/policies/legal_notice`, changefreq: "yearly", priority: 0.3 });
    }

    // hreflang: the same page in each market that serves it, only for stores whose markets all have distinct language-region codes.
    const hreflangs = marketHreflangs(markets);
    if (hreflangs) {
      const prefixes = extraMarkets.map((m) => {
        const raw = m.pathPrefix ?? "";
        return { id: m.id, prefix: `${baseUrl}${raw.startsWith("/") ? raw : `/${raw}`}` };
      });
      const baseMarket = markets.find((m) => m.isBase);
      const keyOf = (loc: string): { key: string; marketId: string | undefined; isBase: boolean } => {
        for (const p of prefixes) {
          if (loc === p.prefix || loc.startsWith(`${p.prefix}/`)) return { key: `${baseUrl}${loc.slice(p.prefix.length)}`, marketId: p.id, isBase: false };
        }
        return { key: loc, marketId: baseMarket?.id, isBase: true };
      };
      const groups = new Map<string, Array<{ marketId: string; isBase: boolean; href: string }>>();
      for (const item of sitemapItems) {
        const k = keyOf(item.loc);
        if (!k.marketId) continue;
        const list = groups.get(k.key) ?? [];
        list.push({ marketId: k.marketId, isBase: k.isBase, href: item.loc });
        groups.set(k.key, list);
      }
      for (const item of sitemapItems) {
        const k = keyOf(item.loc);
        const alts = buildHreflangAlternates(groups.get(k.key) ?? [], hreflangs);
        if (alts.length > 0) item.alternates = alts;
      }
    }

    return sitemapItems;
  });
}

export interface LlmsTxtInput {
  storeName: string;
  baseUrl: string;
  summary: string;
  categories: Array<{ name: string; slug: string; description?: string | null | undefined }>;
  collections: Array<{ title: string; slug: string }>;
  products: Array<{ title: string; slug: string; shortDescription?: string | null | undefined }>;
  pages: Array<{ title: string; path: string }>;
  blog: boolean;
  policies: Array<{ title: string; handle: string }>;
  /** Cap on listed products; the full catalogue is always in the sitemap. */
  productLimit?: number | undefined;
}

const oneLine = (v: string | null | undefined, max = 160) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * Builds the store's /llms.txt (https://llmstxt.org): a plain-Markdown map of the store for AI agents and answer
 * engines. H1 name, a one-line summary, then link sections. Nothing here is private: it lists what the sitemap lists.
 */
export function generateLlmsTxt(input: LlmsTxtInput): string {
  const base = input.baseUrl.replace(/\/$/, "");
  const out: string[] = [`# ${oneLine(input.storeName, 80)}`, "", `> ${oneLine(input.summary, 240)}`, ""];
  const section = (heading: string, rows: string[]) => {
    if (rows.length === 0) return;
    out.push(`## ${heading}`, "", ...rows, "");
  };
  const link = (label: string, path: string, note?: string | null) => `- [${oneLine(label, 100)}](${base}${path})${note ? `: ${oneLine(note)}` : ""}`;

  section("Shop by category", input.categories.map((c) => link(c.name, `/categories/${c.slug}`, c.description)));
  section("Collections", input.collections.map((c) => link(c.title, `/collections/${c.slug}`)));
  const limit = input.productLimit ?? 100;
  section("Products", input.products.slice(0, limit).map((p) => link(p.title, `/products/${p.slug}`, p.shortDescription)));
  section("Pages", input.pages.map((p) => link(p.title, p.path)));
  if (input.blog) section("Blog", [link("Blog", "/blog"), `- [RSS feed](${base}/blog/feed.xml)`]);
  section("Policies", input.policies.map((p) => link(p.title, `/policies/${p.handle}`)));
  section("Optional", [`- [Sitemap](${base}/sitemap.xml)`]);
  return out.join("\n");
}

const POLICY_TITLES: Record<string, string> = {
  privacy: "Privacy policy",
  terms: "Terms of service",
  refund: "Refund and returns policy",
  shipping: "Shipping policy",
  legal_notice: "Legal notice",
};

/** Gathers what /llms.txt lists for one store: the same published, listed, non-empty content the sitemap uses. */
export async function getStorefrontLlmsTxt(
  rt: Runtime,
  ctx: TenantContext,
  host: string,
  opts: { storeName: string; summary?: string | null | undefined },
): Promise<string> {
  const cleanHost = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const { productRows, eligibleCollections, categoryRows } = await getScopedCatalogForSitemap(tx, ctx.tenantId);

    const pageRows = await tx
      .select({ id: schema.pages.id, parentId: schema.pages.parentId, slug: schema.pages.slug, title: schema.pages.title, type: schema.pages.type })
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.status, "published"), notInArray(schema.pages.type, [...THEME_SYSTEM_PAGE_TYPES])));
    const byId = new Map(pageRows.map((p) => [p.id, p]));
    const pagePath = (page: (typeof pageRows)[number]): string => {
      const segs = [page.slug];
      const seen = new Set<string>();
      let cur = page.parentId;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const parent = byId.get(cur);
        if (!parent) break;
        segs.unshift(parent.slug);
        cur = parent.parentId;
      }
      return `/pages/${segs.join("/")}`;
    };

    const blog = await listBlogForSitemap(tx, ctx.tenantId);
    const published = await tx
      .select({ handle: schema.storePolicies.handle })
      .from(schema.storePolicies)
      .where(and(eq(schema.storePolicies.tenantId, ctx.tenantId), sql`${schema.storePolicies.publishedVersionId} is not null`));

    return generateLlmsTxt({
      storeName: opts.storeName,
      baseUrl: `https://${cleanHost}`,
      summary: opts.summary?.trim() || `Online store of ${opts.storeName}. Product catalogue, categories, policies and guides.`,
      categories: categoryRows.map((c) => ({ name: c.name, slug: c.slug, description: c.description })),
      collections: eligibleCollections.map((c) => ({ title: c.title, slug: c.slug })),
      products: productRows.map((p) => ({ title: p.title, slug: p.slug, shortDescription: p.shortDescription })),
      pages: pageRows.filter((p) => p.type !== "home").map((p) => ({ title: p.title, path: pagePath(p) })),
      blog: blog.enabled && blog.posts.length > 0,
      policies: published.map((r) => ({ handle: r.handle, title: POLICY_TITLES[r.handle] ?? r.handle })),
    });
  });
}
