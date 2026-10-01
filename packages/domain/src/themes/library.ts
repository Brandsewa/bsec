import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { validateBlockDocument, type BlockInstance } from "@bs/blocks";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";

/**
 * Store-side theme library (M10). The store sees only published platform templates and, when it
 * activates one, receives its own copy: tokens into `themes`, page blocks into `pages` /
 * `page_versions`. After that the store edits only its own rows, so a later template update
 * never overwrites customizations. Switching themes adds a new page version instead of
 * deleting anything, so the previous design is one rollback away.
 */

export interface ThemeLibraryItem {
  code: string;
  name: string;
  description: string | null;
  industry: string;
  features: string[];
  previewImageKey: string | null;
  version: number;
  isCurrent: boolean;
  /** Template version this store last copied, when this is the current theme. */
  installedVersion: number | null;
  updateAvailable: boolean;
}

export async function listThemeLibrary(rt: Runtime, ctx: TenantContext): Promise<ThemeLibraryItem[]> {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [current] = await tx.select().from(schema.themes).where(eq(schema.themes.tenantId, ctx.tenantId)).limit(1);
    const templates = await tx.select().from(schema.themeTemplates).where(eq(schema.themeTemplates.isActive, true));
    return templates.map((t) => {
      const isCurrent = current?.templateCode === t.code;
      return {
        code: t.code,
        name: t.name,
        description: t.description,
        industry: t.industry,
        features: t.features ?? [],
        previewImageKey: t.previewImageKey,
        version: t.version,
        isCurrent,
        installedVersion: isCurrent ? current.templateVersion : null,
        updateAvailable: isCurrent && current.templateVersion < t.version,
      };
    });
  });
}

function blocksOf(pages: unknown, key: string): BlockInstance[] | null {
  const v = pages && typeof pages === "object" ? (pages as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? (v as BlockInstance[]) : null;
}

/**
 * Activates a template for the store: copies tokens and page content, publishes it, and
 * invalidates caches. Existing pages keep their history (new version, not overwritten).
 */
export async function activateTheme(
  rt: Runtime,
  ctx: TenantContext,
  input: { code: string },
): Promise<{ code: string; name: string; version: number; pages: string[] }> {
  assertPermission(ctx, "theme.publish");
  const createdBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [tpl] = await tx
      .select()
      .from(schema.themeTemplates)
      .where(and(eq(schema.themeTemplates.code, input.code), eq(schema.themeTemplates.isActive, true)))
      .limit(1);
    if (!tpl) throw new Error(`Theme not available: "${input.code}"`);

    // Validate everything before writing anything.
    const pageKeys = Object.keys((tpl.defaultPages as Record<string, unknown>) ?? {});
    if (!pageKeys.includes("home")) throw new Error("Theme has no home page");
    const validated = new Map<string, BlockInstance[]>();
    for (const key of pageKeys) {
      const blocks = blocksOf(tpl.defaultPages, key);
      if (!blocks) continue;
      const r = validateBlockDocument({ version: 1, blocks });
      if (!r.success) throw new Error(`Theme page "${key}" is invalid`);
      validated.set(key, r.data.blocks);
    }

    // 1. Theme tokens
    const [existingTheme] = await tx.select().from(schema.themes).where(eq(schema.themes.tenantId, ctx.tenantId)).limit(1);
    if (existingTheme) {
      await tx
        .update(schema.themes)
        .set({
          templateCode: tpl.code,
          templateVersion: tpl.version,
          name: tpl.name,
          tokens: tpl.defaultTokens,
          status: "published",
          publishedAt: new Date(),
          version: existingTheme.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.themes.id, existingTheme.id));
    } else {
      await tx.insert(schema.themes).values({
        tenantId: ctx.tenantId,
        templateCode: tpl.code,
        templateVersion: tpl.version,
        name: tpl.name,
        tokens: tpl.defaultTokens,
        status: "published",
        publishedAt: new Date(),
      });
    }

    // 2. Pages: home always gets the theme's layout (as a new version); landing pages are only
    //    created when missing, so a store's own pages are never replaced.
    const touched: Array<{ slug: string; isHome: boolean }> = [];
    for (const [key, blocks] of validated) {
      const isHome = key === "home";
      const [page] = await tx
        .select()
        .from(schema.pages)
        .where(isHome ? eq(schema.pages.type, "home") : eq(schema.pages.slug, key))
        .limit(1);

      if (page && !isHome) continue;

      const pageId =
        page?.id ??
        (
          await tx
            .insert(schema.pages)
            .values({
              tenantId: ctx.tenantId,
              type: isHome ? "home" : "landing",
              title: isHome ? "Home" : key.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
              slug: key,
              status: "published",
            })
            .returning({ id: schema.pages.id })
        )[0]?.id;
      if (!pageId) throw new Error("Failed to create page");

      const [version] = await tx
        .insert(schema.pageVersions)
        .values({
          tenantId: ctx.tenantId,
          pageId,
          document: { version: 1, blocks },
          createdBy,
          note: `Activated theme "${tpl.name}" v${tpl.version}`,
        })
        .returning({ id: schema.pageVersions.id });
      if (!version) throw new Error("Failed to create page version");

      await tx
        .update(schema.pages)
        .set({ publishedVersionId: version.id, draftVersionId: version.id, status: "published", updatedAt: new Date() })
        .where(eq(schema.pages.id, pageId));
      touched.push({ slug: key, isHome });
    }

    return { code: tpl.code, name: tpl.name, version: tpl.version, touched };
  });

  await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });
  for (const p of result.touched) {
    await invalidateCache(rt, ctx, p.isHome ? { type: "home_page_published" } : { type: "page_published", slug: p.slug });
  }
  return { code: result.code, name: result.name, version: result.version, pages: result.touched.map((p) => p.slug) };
}

/** The published home page of a library theme, for previewing before activation. */
export async function previewThemeTemplate(
  rt: Runtime,
  ctx: TenantContext,
  input: { code: string },
): Promise<{ name: string; version: number; blocks: BlockInstance[] }> {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [tpl] = await tx
      .select()
      .from(schema.themeTemplates)
      .where(and(eq(schema.themeTemplates.code, input.code), eq(schema.themeTemplates.isActive, true)))
      .limit(1);
    if (!tpl) throw new Error(`Theme not available: "${input.code}"`);
    const blocks = blocksOf(tpl.defaultPages, "home");
    const r = blocks ? validateBlockDocument({ version: 1, blocks }) : null;
    if (!r?.success) throw new Error("Theme has no valid home page");
    return { name: tpl.name, version: tpl.version, blocks: r.data.blocks };
  });
}
