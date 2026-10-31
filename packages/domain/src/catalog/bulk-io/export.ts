import { and, asc, eq, gt, ilike, inArray, isNull } from "drizzle-orm";
import { FINANCE_EXPORT_ROLES } from "@bs/auth";
import { minorUnitExponent } from "@bs/contracts/money";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../../runtime.ts";
import { assertPermission, type TenantContext } from "../../context.ts";
import { publicMediaUrl } from "../../media/storage.ts";
import { CUSTOM_FIELD_PREFIX, PRODUCT_COLUMNS, type ColumnGroup } from "@bs/contracts/product-bulk-io";
import { customFieldsEnabled } from "../custom-fields.ts";

export const EXPORT_PAGE_MAX = 200;

export interface ExportRowsInput {
  /** Column keys to include; "all" = every built-in column plus every custom field. */
  fields: string[] | "all";
  /** Scope: all products when none of these is set. Category ids match the primary or any other category. */
  categoryIds?: string[] | undefined;
  productIds?: string[] | undefined;
  status?: "draft" | "active" | "unlisted" | "archived" | undefined;
  search?: string | undefined;
  /** Keyset cursor: the id of the last product of the previous page. */
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ExportRowsResult {
  header: string[];
  rows: string[][];
  nextCursor: string | null;
  /** Products in this page (rows can be more than products: one per variant, plus extra image rows). */
  products: number;
}

/** Minor units -> "499.00" (or "499" for zero-decimal currencies), the format the import reads back. */
export function formatExportPrice(minor: number | bigint | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "";
  const exp = minorUnitExponent(currency);
  return (Number(minor) / 10 ** exp).toFixed(exp);
}

export const exportColumnGroups: Record<ColumnGroup, string> = {
  basics: "Basics",
  pricing: "Variants and pricing",
  images: "Images",
  seo: "SEO",
  organisation: "Organisation",
  flags: "Settings",
};

function customValueText(type: string, value: unknown, imageUrl: string | undefined): string {
  if (value === null || value === undefined) return "";
  if (type === "image") return imageUrl ?? "";
  if (Array.isArray(value)) return value.map(String).join("|");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

const mediaUrl = (key: string): string => publicMediaUrl(key) ?? "";
const yn = (b: boolean) => (b ? "yes" : "no");

/**
 * One page of products as CSV rows (docs/PRODUCT-BULK-IO-PLAN.md section 3): a row per variant, then extra rows that
 * carry only the handle and one more image. The header is the same on every page so the browser can concatenate them.
 */
export async function exportProductRows(rt: Runtime, ctx: TenantContext, input: ExportRowsInput): Promise<ExportRowsResult> {
  assertPermission(ctx, "products.read");
  // Bulk export hands over the whole catalogue: store owner and store admin only, with the export permission (ADR-022).
  assertPermission(ctx, "exports.run");
  if (!ctx.roles.some((r) => FINANCE_EXPORT_ROLES.includes(r))) throw new Error("Forbidden: only the store owner and store admin can export products");
  const db = rt._db.db;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), EXPORT_PAGE_MAX);
  const cfEnabled = await customFieldsEnabled(db, ctx.tenantId);

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [settings] = await tx.select({ currency: schema.storeSettings.currency }).from(schema.storeSettings).limit(1);
    const currency = settings?.currency ?? "INR";

    const defs = cfEnabled
      ? await tx
          .select()
          .from(schema.customFieldDefinitions)
          .where(and(eq(schema.customFieldDefinitions.tenantId, ctx.tenantId), eq(schema.customFieldDefinitions.resourceType, "product"), isNull(schema.customFieldDefinitions.archivedAt)))
          .orderBy(asc(schema.customFieldDefinitions.position), asc(schema.customFieldDefinitions.createdAt))
      : [];

    const wanted = input.fields === "all" ? null : new Set(input.fields);
    const columns = PRODUCT_COLUMNS.filter((c) => !wanted || wanted.has(c.key) || c.key === "handle");
    const customCols = defs.filter((d) => !wanted || wanted.has(`${CUSTOM_FIELD_PREFIX}${d.key}`));
    const header = [...columns.map((c) => c.header), ...customCols.map((d) => `${CUSTOM_FIELD_PREFIX}${d.key}`)];

    const conditions = [eq(schema.products.tenantId, ctx.tenantId), isNull(schema.products.deletedAt)];
    if (input.cursor) conditions.push(gt(schema.products.id, input.cursor));
    if (input.status) conditions.push(eq(schema.products.status, input.status));
    if (input.search?.trim()) conditions.push(ilike(schema.products.title, `%${input.search.trim()}%`));
    if (input.productIds?.length) conditions.push(inArray(schema.products.id, input.productIds));
    if (input.categoryIds?.length) {
      const inCats = tx
        .select({ id: schema.productCategories.productId })
        .from(schema.productCategories)
        .where(and(eq(schema.productCategories.tenantId, ctx.tenantId), inArray(schema.productCategories.categoryId, input.categoryIds)));
      conditions.push(inArray(schema.products.id, inCats));
    }

    const products = await tx
      .select()
      .from(schema.products)
      .where(and(...conditions))
      .orderBy(asc(schema.products.id))
      .limit(limit + 1);
    const hasMore = products.length > limit;
    const page = products.slice(0, limit);
    if (page.length === 0) return { header, rows: [], nextCursor: null, products: 0 };
    const ids = page.map((p) => p.id);

    const [variants, options, media, cats, cfValues] = await Promise.all([
      tx.select().from(schema.variants).where(inArray(schema.variants.productId, ids)).orderBy(asc(schema.variants.position)),
      tx.select().from(schema.productOptions).where(inArray(schema.productOptions.productId, ids)).orderBy(asc(schema.productOptions.position)),
      tx
        .select({ productId: schema.productMedia.productId, mediaId: schema.productMedia.mediaId, variantId: schema.productMedia.variantId, position: schema.productMedia.position, alt: schema.productMedia.alt, key: schema.media.storageKey, kind: schema.media.kind })
        .from(schema.productMedia)
        .innerJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
        .where(inArray(schema.productMedia.productId, ids))
        .orderBy(asc(schema.productMedia.position)),
      tx
        .select({ productId: schema.productCategories.productId, name: schema.categories.name, isPrimary: schema.productCategories.isPrimary })
        .from(schema.productCategories)
        .innerJoin(schema.categories, eq(schema.categories.id, schema.productCategories.categoryId))
        .where(and(eq(schema.productCategories.tenantId, ctx.tenantId), inArray(schema.productCategories.productId, ids))),
      defs.length
        ? tx.select().from(schema.customFieldValues).where(and(eq(schema.customFieldValues.tenantId, ctx.tenantId), inArray(schema.customFieldValues.productId, ids)))
        : Promise.resolve([] as Array<typeof schema.customFieldValues.$inferSelect>),
    ]);

    // Image-typed custom fields store { mediaId }; resolve them to URLs in one query.
    const cfMediaIds = cfValues.map((v) => (v.value as { mediaId?: string } | null)?.mediaId).filter((v): v is string => Boolean(v));
    const cfMedia = cfMediaIds.length
      ? await tx.select({ id: schema.media.id, key: schema.media.storageKey }).from(schema.media).where(and(eq(schema.media.tenantId, ctx.tenantId), inArray(schema.media.id, cfMediaIds)))
      : [];
    const cfUrl = new Map(cfMedia.map((m) => [m.id, mediaUrl(m.key)]));

    const rows: string[][] = [];
    for (const p of page) {
      const pVariants = variants.filter((v) => v.productId === p.id);
      const pOptions = options.filter((o) => o.productId === p.id);
      const pMedia = media.filter((m) => m.productId === p.id && m.kind === "image");
      const pCats = cats.filter((c) => c.productId === p.id);
      const seo = (p.seo ?? {}) as { title?: string; description?: string };
      const desc = (p.descriptionJson as { text?: unknown } | string | null) ?? null;
      const descText = typeof desc === "string" ? desc : typeof desc?.text === "string" ? desc.text : "";
      const gallery = pMedia.filter((m) => !m.variantId);
      const featured = gallery[0];
      const cf = new Map(cfValues.filter((v) => v.productId === p.id).map((v) => [v.definitionId, v.value]));

      const productCells: Record<string, string> = {
        handle: p.slug,
        title: p.title,
        shortDescription: p.shortDescription ?? "",
        description: descText,
        status: p.status,
        primaryCategory: pCats.find((c) => c.isPrimary)?.name ?? "",
        tags: p.tags.join("|"),
        productType: p.productType ?? "",
        hsn: p.hsn ?? "",
        option1Name: pOptions[0]?.name ?? "",
        option2Name: pOptions[1]?.name ?? "",
        option3Name: pOptions[2]?.name ?? "",
        imageUrl: featured ? mediaUrl(featured.key) : "",
        additionalImages: gallery.slice(1).map((m) => mediaUrl(m.key)).join("|"),
        imageAlt: featured?.alt ?? "",
        seoTitle: seo.title ?? "",
        seoDescription: seo.description ?? "",
        isFeatured: yn(p.isFeatured),
        returnable: yn(p.returnable),
        requiresShipping: yn(p.requiresShipping),
      };
      const customCells = customCols.map((d) => customValueText(d.type, cf.get(d.id), (cf.get(d.id) as { mediaId?: string } | undefined)?.mediaId ? cfUrl.get((cf.get(d.id) as { mediaId: string }).mediaId) : undefined));

      const list = pVariants.length ? pVariants : [null];
      list.forEach((v, i) => {
        const ov = (v?.optionValues ?? {}) as Record<string, string>;
        const variantCells: Record<string, string> = v
          ? {
              option1Value: ov[pOptions[0]?.name ?? ""] ?? "",
              option2Value: ov[pOptions[1]?.name ?? ""] ?? "",
              option3Value: ov[pOptions[2]?.name ?? ""] ?? "",
              sku: v.sku,
              variantTitle: v.title,
              price: formatExportPrice(v.price, currency),
              compareAtPrice: formatExportPrice(v.compareAtPrice, currency),
              costPrice: formatExportPrice(v.costPrice, currency),
              barcode: v.barcode ?? "",
              weightGrams: v.weightGrams === null ? "" : String(v.weightGrams),
              trackInventory: yn(v.trackInventory),
              allowBackorder: yn(v.allowBackorder),
              variantImageUrl: (() => {
                const m = pMedia.find((x) => x.mediaId === v.imageMediaId);
                return m ? mediaUrl(m.key) : "";
              })(),
            }
          : {};
        // Product-level cells only on the first row of the product; continuation rows repeat the handle.
        rows.push([
          ...columns.map((c) => (c.key === "handle" ? p.slug : (variantCells[c.key] ?? (i === 0 ? (productCells[c.key] ?? "") : "")))),
          ...(i === 0 ? customCells : customCols.map(() => "")),
        ]);
      });
    }
    return { header, rows, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null, products: page.length };
  });
}
