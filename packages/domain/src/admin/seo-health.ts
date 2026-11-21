import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { SeoHealthView } from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { LISTED_PRODUCT_STATUSES } from "../storefront/product-status.ts";
import { DEFAULT_AI_CRAWLERS, getStorefrontBrandAssets, getStorefrontSitemapUrls } from "../storefront/seo.ts";

type Check = SeoHealthView["checks"][number];

/** Search and assistant agents whose block would keep the store out of AI answers (docs/SEO-GEO-AEO-PLAN.md section 2). */
export const RETRIEVAL_AGENTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"] as const;
export const CORE_POLICIES = ["privacy", "terms", "refund", "shipping"] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure: turns raw counts into the report lines, so every rule is unit-tested without a database. */
export function buildSeoHealthChecks(f: {
  storeLive: boolean;
  indexingEnabled: boolean;
  blockedAgents: string[];
  listedProducts: number;
  productsWithoutDescription: number;
  productsWithoutImage: number;
  imagesWithoutAlt: number;
  categoriesWithoutDescription: number;
  collectionsWithoutDescription: number;
  publishedPolicies: number;
  hasShareImage: boolean;
  hasFavicon: boolean;
  hasContact: boolean;
  hasShippingRates: boolean;
}): Check[] {
  const checks: Check[] = [];
  const visible = f.storeLive && f.indexingEnabled;
  checks.push({
    id: "visibility",
    label: "Visible to search engines",
    status: visible ? "ok" : "fail",
    detail: visible ? "Your store is live and open to search engines." : !f.storeLive ? "Your store is not live yet, so search engines are kept out." : "\"Discourage search engines\" is on, so your store asks to be left out of search results.",
    fixHref: "/settings/storefront",
  });
  checks.push({
    id: "ai-agents",
    label: "Open to AI assistants",
    status: f.blockedAgents.length === 0 ? "ok" : "warn",
    detail: f.blockedAgents.length === 0 ? "ChatGPT, Claude and Perplexity can read your store to answer shoppers." : `Blocked: ${f.blockedAgents.join(", ")}. AI assistants cannot cite your store.`,
    count: f.blockedAgents.length,
  });
  const count = (id: string, label: string, n: number, total: number, okText: string, badText: string, fixHref?: string, status: "warn" | "fail" = "warn"): void => {
    checks.push({ id, label, status: n === 0 ? "ok" : status, detail: n === 0 ? okText : badText, ...(n > 0 ? { count: n } : {}), ...(fixHref && n > 0 ? { fixHref } : {}) });
    void total;
  };
  count("product-description", "Products have a description", f.productsWithoutDescription, f.listedProducts, f.listedProducts === 0 ? "No products yet." : "Every product has a description.", `${plural(f.productsWithoutDescription, "product")} with no description: search engines and AI have little to quote.`, "/products");
  count("product-image", "Products have a picture", f.productsWithoutImage, f.listedProducts, "Every product has a picture.", `${plural(f.productsWithoutImage, "product")} with no picture.`, "/products");
  count("image-alt", "Product pictures have alt text", f.imagesWithoutAlt, f.listedProducts, "Every product picture is described.", `${plural(f.imagesWithoutAlt, "picture")} with no description (alt text): used by image search and screen readers.`, "/products");
  count("category-description", "Categories have a description", f.categoriesWithoutDescription, 0, "Every category has a description.", `${plural(f.categoriesWithoutDescription, "category", "categories")} with no description.`, "/categories");
  count("collection-description", "Collections have a description", f.collectionsWithoutDescription, 0, "Every collection has a description.", `${plural(f.collectionsWithoutDescription, "collection")} with no description.`, "/collections");
  checks.push({
    id: "policies",
    label: "Store policies published",
    status: f.publishedPolicies >= CORE_POLICIES.length ? "ok" : "warn",
    detail: f.publishedPolicies >= CORE_POLICIES.length ? "Privacy, terms, refund and shipping policies are published." : `${f.publishedPolicies} of ${CORE_POLICIES.length} core policies published. Unpublished ones are kept out of search results.`,
    count: CORE_POLICIES.length - Math.min(f.publishedPolicies, CORE_POLICIES.length),
    fixHref: "/settings/policies",
  });
  checks.push({ id: "share-image", label: "Share image", status: f.hasShareImage ? "ok" : "warn", detail: f.hasShareImage ? "Shared links show a picture of your store." : "No picture is shown when your store is shared. Add a logo or social image in Branding.", fixHref: "/settings/branding" });
  checks.push({ id: "favicon", label: "Favicon", status: f.hasFavicon ? "ok" : "warn", detail: f.hasFavicon ? "Your browser-tab icon is set." : "No favicon: browsers and search results show a blank icon.", fixHref: "/settings/branding" });
  checks.push({ id: "contact", label: "Contact details", status: f.hasContact ? "ok" : "warn", detail: f.hasContact ? "Your support email or phone is shared with search engines." : "Add a support email or phone so search engines can show how to reach you.", fixHref: "/settings/store-details" });
  checks.push({ id: "shipping", label: "Shipping rates published", status: f.hasShippingRates ? "ok" : "warn", detail: f.hasShippingRates ? "Your shipping rates appear in product listings." : "No shipping rates configured, so Google cannot show delivery costs.", fixHref: "/settings/shipping" });
  return checks;
}

/**
 * The store's SEO health report: what search engines and AI assistants can see, and what content is missing. Read-only; every
 * number is counted for this store only (RLS), and nothing here changes the storefront.
 */
export async function getSeoHealth(rt: Runtime, ctx: TenantContext): Promise<SeoHealthView> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;
  const t = ctx.tenantId;

  const base = await withTenant(db, t, async (tx) => {
    const [status] = await tx.select({ mode: schema.storeStatus.mode }).from(schema.storeStatus).where(eq(schema.storeStatus.tenantId, t)).limit(1);
    const [seo] = await tx.select({ indexingEnabled: schema.seoSettings.indexingEnabled, aiCrawlers: schema.seoSettings.aiCrawlers }).from(schema.seoSettings).where(eq(schema.seoSettings.tenantId, t)).limit(1);
    const [store] = await tx.select({ email: schema.storeSettings.supportEmail, phone: schema.storeSettings.supportPhone }).from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, t)).limit(1);
    const listed = and(eq(schema.products.tenantId, t), inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]), isNull(schema.products.deletedAt));

    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        noDescription: sql<number>`count(*) FILTER (WHERE coalesce(btrim(${schema.products.shortDescription}), '') = '' AND ${schema.products.descriptionJson} IS NULL)::int`,
        noImage: sql<number>`count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${schema.productMedia} pm WHERE pm.tenant_id = ${schema.products.tenantId} AND pm.product_id = ${schema.products.id}))::int`,
      })
      .from(schema.products)
      .where(listed);
    const [alt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.productMedia)
      .innerJoin(schema.media, and(eq(schema.media.tenantId, schema.productMedia.tenantId), eq(schema.media.id, schema.productMedia.mediaId)))
      .innerJoin(schema.products, and(eq(schema.products.tenantId, schema.productMedia.tenantId), eq(schema.products.id, schema.productMedia.productId)))
      .where(and(listed, sql`coalesce(btrim(${schema.productMedia.alt}), '') = '' AND coalesce(btrim(${schema.media.alt}), '') = ''`));
    const [cats] = await tx.select({ n: sql<number>`count(*) FILTER (WHERE coalesce(btrim(${schema.categories.description}), '') = '' AND ${schema.categories.descriptionJson} IS NULL)::int` }).from(schema.categories).where(eq(schema.categories.tenantId, t));
    const [cols] = await tx
      .select({ n: sql<number>`count(*) FILTER (WHERE coalesce(btrim(${schema.collections.description}), '') = '' AND ${schema.collections.descriptionJson} IS NULL)::int` })
      .from(schema.collections)
      .where(and(eq(schema.collections.tenantId, t), eq(schema.collections.published, true)));
    const policies = await tx.select({ handle: schema.storePolicies.handle, published: schema.storePolicies.publishedVersionId }).from(schema.storePolicies).where(eq(schema.storePolicies.tenantId, t));
    const [rates] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.shippingRates).where(eq(schema.shippingRates.tenantId, t));
    return { status, seo, store, counts, alt, cats, cols, policies, rates };
  });

  const crawlers = { ...DEFAULT_AI_CRAWLERS, ...((base.seo?.aiCrawlers as Record<string, "allow" | "block"> | null | undefined) ?? {}) };
  const blockedAgents = RETRIEVAL_AGENTS.filter((a) => crawlers[a] === "block");
  const [assets, sitemap] = await Promise.all([getStorefrontBrandAssets(rt, t), getStorefrontSitemapUrls(rt, ctx, "health.invalid").catch(() => [])]);
  const publishedPolicies = base.policies.filter((p) => p.published && (CORE_POLICIES as readonly string[]).includes(p.handle)).length;

  return {
    indexablePageCount: sitemap.length,
    checks: buildSeoHealthChecks({
      storeLive: (base.status?.mode ?? "coming_soon") === "live",
      indexingEnabled: base.seo?.indexingEnabled ?? true,
      blockedAgents,
      listedProducts: base.counts?.total ?? 0,
      productsWithoutDescription: base.counts?.noDescription ?? 0,
      productsWithoutImage: base.counts?.noImage ?? 0,
      imagesWithoutAlt: base.alt?.n ?? 0,
      categoriesWithoutDescription: base.cats?.n ?? 0,
      collectionsWithoutDescription: base.cols?.n ?? 0,
      publishedPolicies,
      hasShareImage: assets.shareImage != null,
      hasFavicon: assets.faviconUrl != null,
      hasContact: Boolean(base.store?.email || base.store?.phone),
      hasShippingRates: (base.rates?.n ?? 0) > 0,
    }),
  };
}
