import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { THEME_SYSTEM_PAGES, validateBlockDocument, type BlockInstance, type ThemeSystemPageKey } from "@bs/blocks";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export {
  THEME_SYSTEM_PAGES,
  THEME_SYSTEM_PAGE_KEYS,
  THEME_SYSTEM_PAGE_TYPES,
  THEME_PAGE_TYPES,
  THEME_PAGE_LABELS,
  isThemeSystemPageKey,
  type ThemeSystemPageKey,
} from "@bs/blocks";

/**
 * Marks a store's theme tokens as the source of its look. Activating a library theme (or saving
 * theme settings) sets it; stores that never did keep using their Branding settings, so nothing
 * changes for them.
 */
export const THEME_TOKENS_SOURCE = "theme";

/**
 * The published blocks of a store's header/footer/product/collection page, or null when the
 * store has none (the storefront then renders its built-in layout).
 */
export async function getStorefrontThemePage(
  rt: Runtime,
  ctx: TenantContext,
  key: ThemeSystemPageKey,
): Promise<{ id: string; blocks: BlockInstance[] } | null> {
  const def = THEME_SYSTEM_PAGES[key];
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [page] = await tx
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.type, def.type), eq(schema.pages.status, "published")))
      .limit(1);
    if (!page?.publishedVersionId) return null;
    const [ver] = await tx
      .select()
      .from(schema.pageVersions)
      .where(and(eq(schema.pageVersions.tenantId, ctx.tenantId), eq(schema.pageVersions.id, page.publishedVersionId)))
      .limit(1);
    const parsed = validateBlockDocument(ver?.document);
    // A stored document that no longer validates is treated as "no custom layout": never break the storefront.
    if (!parsed.success || parsed.data.blocks.length === 0) return null;
    return { id: page.id, blocks: parsed.data.blocks };
  });
}

/** The store's theme tokens when it opted in to the theme system, else null (Branding settings apply). */
export async function getStorefrontThemeTokens(rt: Runtime, ctx: TenantContext): Promise<Record<string, unknown> | null> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ tokens: schema.themes.tokens })
      .from(schema.themes)
      .where(and(eq(schema.themes.tenantId, ctx.tenantId), eq(schema.themes.status, "published")))
      .limit(1);
    const tokens = row?.tokens;
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null;
    return (tokens as Record<string, unknown>)["source"] === THEME_TOKENS_SOURCE ? (tokens as Record<string, unknown>) : null;
  });
}
