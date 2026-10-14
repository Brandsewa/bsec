import { eq, sql } from "drizzle-orm";
import { schema, type withTenant } from "@bs/db";
import type { MediaUsageReference } from "@bs/contracts";

/**
 * Checks branding, settings, and page/theme block documents for references to media IDs (MEDIA-LIBRARY-PLAN §5.2, B5).
 */
export async function findUntrackedReferences(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
  mediaIds: string[],
): Promise<Map<string, MediaUsageReference[]>> {
  const refMap = new Map<string, MediaUsageReference[]>();
  if (mediaIds.length === 0) return refMap;

  const addRef = (mId: string, ref: MediaUsageReference) => {
    const list = refMap.get(mId) || [];
    list.push(ref);
    refMap.set(mId, list);
  };

  // 1. Store branding settings
  const [brand] = await tx
    .select()
    .from(schema.brandSettings)
    .where(eq(schema.brandSettings.tenantId, tenantId))
    .limit(1);

  if (brand) {
    if (brand.logoMediaId && mediaIds.includes(brand.logoMediaId)) {
      addRef(brand.logoMediaId, {
        ownerType: "store_branding",
        ownerId: brand.id,
        field: "logo",
        label: "Store branding (Logo)",
        adminPath: "/settings/branding",
      });
    }
    if (brand.logoDarkMediaId && mediaIds.includes(brand.logoDarkMediaId)) {
      addRef(brand.logoDarkMediaId, {
        ownerType: "store_branding",
        ownerId: brand.id,
        field: "logo_dark",
        label: "Store branding (Dark Logo)",
        adminPath: "/settings/branding",
      });
    }
    if (brand.faviconMediaId && mediaIds.includes(brand.faviconMediaId)) {
      addRef(brand.faviconMediaId, {
        ownerType: "store_branding",
        ownerId: brand.id,
        field: "favicon",
        label: "Store branding (Favicon)",
        adminPath: "/settings/branding",
      });
    }
    if (brand.appleTouchIconMediaId && mediaIds.includes(brand.appleTouchIconMediaId)) {
      addRef(brand.appleTouchIconMediaId, {
        ownerType: "store_branding",
        ownerId: brand.id,
        field: "apple_touch_icon",
        label: "Store branding (Apple Touch Icon)",
        adminPath: "/settings/branding",
      });
    }
    if (brand.socialImageMediaId && mediaIds.includes(brand.socialImageMediaId)) {
      addRef(brand.socialImageMediaId, {
        ownerType: "store_branding",
        ownerId: brand.id,
        field: "social_image",
        label: "Store branding (Social Image)",
        adminPath: "/settings/branding",
      });
    }
  }

  // 2. Store status settings (maintenance/coming-soon background image)
  const [status] = await tx
    .select()
    .from(schema.storeStatus)
    .where(eq(schema.storeStatus.tenantId, tenantId))
    .limit(1);

  if (status?.backgroundMediaId && mediaIds.includes(status.backgroundMediaId)) {
    addRef(status.backgroundMediaId, {
      ownerType: "store_branding",
      ownerId: status.id,
      field: "status_background",
      label: "Store status (Background image)",
      adminPath: "/settings/storefront",
    });
  }

  // 3. SEO settings
  const [seo] = await tx
    .select()
    .from(schema.seoSettings)
    .where(eq(schema.seoSettings.tenantId, tenantId))
    .limit(1);

  if (seo?.defaultOgImageMediaId && mediaIds.includes(seo.defaultOgImageMediaId)) {
    addRef(seo.defaultOgImageMediaId, {
      ownerType: "store_branding",
      ownerId: seo.id,
      field: "seo_og_image",
      label: "Default social share image",
      adminPath: "/settings/storefront",
    });
  }

  // 4. Page blocks
  for (const mId of mediaIds) {
    const pageMatches = await tx.execute<{ page_id: string; title: string; slug: string }>(sql`
      SELECT pv.page_id, p.title, p.slug
      FROM page_versions pv
      JOIN pages p ON p.id = pv.page_id AND p.tenant_id = pv.tenant_id
      WHERE pv.tenant_id = ${tenantId}
        AND pv.document::text LIKE ${`%${mId}%`}
      LIMIT 5;
    `);
    for (const p of pageMatches.rows ?? []) {
      addRef(mId, {
        ownerType: "page",
        ownerId: p.page_id,
        field: "document",
        label: `Page: ${p.title || p.slug || "Custom Page"}`,
        adminPath: `/pages/${p.page_id}`,
      });
    }
  }

  // 5. Theme tokens
  for (const mId of mediaIds) {
    const themeMatches = await tx.execute<{ id: string; name: string }>(sql`
      SELECT t.id, t.name
      FROM themes t
      WHERE t.tenant_id = ${tenantId}
        AND t.tokens::text LIKE ${`%${mId}%`}
      LIMIT 5;
    `);
    for (const t of themeMatches.rows ?? []) {
      addRef(mId, {
        ownerType: "theme",
        ownerId: t.id,
        field: "tokens",
        label: `Theme: ${t.name || "Default Theme"}`,
        adminPath: "/themes",
      });
    }
  }

  return refMap;
}
