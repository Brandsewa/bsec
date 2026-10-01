import { and, desc, eq, notInArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { validateBlockDocument } from "@bs/blocks";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import { THEME_SYSTEM_PAGE_TYPES } from "./themes/system-pages.ts";

export interface CreatePageInput {
  title: string;
  slug: string;
  description?: string | undefined;
}

export interface UpdatePageInput {
  id: string;
  title?: string | undefined;
  slug?: string | undefined;
  description?: string | undefined;
  seo?: unknown;
}

export interface SaveDraftInput {
  id: string;
  blocks: unknown[];
}

export interface PublishPageInput {
  id: string;
  versionId?: string | undefined;
}

export interface RollbackPageInput {
  id: string;
  targetVersionId: string;
}

/** Invalidates the cache tags for a page that was just published or rolled back. */
async function invalidatePageCache(
  rt: Runtime,
  ctx: TenantContext,
  page: { slug: string; type: string } | undefined,
) {
  if (!page || page.slug === "home" || page.type === "home") {
    await invalidateCache(rt, ctx, { type: "home_page_published" });
  } else {
    await invalidateCache(rt, ctx, { type: "page_published", slug: page.slug });
  }
}

// --- Theme Services ---
export async function getTheme(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.themes)
      .where(eq(schema.themes.tenantId, ctx.tenantId));

    if (!existing) {
      return {
        id: "default-theme",
        name: "Standard Theme",
        tokens: {},
        settings: {},
        isActive: true,
        version: 1,
      };
    }

    return {
      id: existing.id,
      name: existing.name,
      tokens: existing.tokens as Record<string, unknown>,
      settings: {},
      isActive: existing.status === "published",
      version: existing.version,
    };
  });
}

export async function updateTheme(
  rt: Runtime,
  ctx: TenantContext,
  input: { tokens?: Record<string, unknown> | undefined; settings?: Record<string, unknown> | undefined },
) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.themes)
      .where(eq(schema.themes.tenantId, ctx.tenantId));

    if (existing) {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.tokens !== undefined) updateData.tokens = input.tokens;

      const [row] = await tx
        .update(schema.themes)
        .set(updateData)
        .where(eq(schema.themes.id, existing.id))
        .returning();

      if (!row) throw new Error("Failed to update theme");
      await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });
      return {
        id: row.id,
        name: row.name,
        tokens: row.tokens as Record<string, unknown>,
        settings: {},
        isActive: row.status === "published",
        version: row.version,
      };
    }

    const [row] = await tx
      .insert(schema.themes)
      .values({
        tenantId: ctx.tenantId,
        name: "Custom Theme",
        tokens: input.tokens ?? {},
        status: "published",
        version: 1,
      })
      .returning();

    if (!row) throw new Error("Failed to create theme");
    await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });
    return {
      id: row.id,
      name: row.name,
      tokens: row.tokens as Record<string, unknown>,
      settings: {},
      isActive: row.status === "published",
      version: row.version,
    };
  });
}

// --- Page Services ---
export async function listPages(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.pages).orderBy(schema.pages.title);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      type: r.type,
      description: undefined,
      publishedVersionId: r.publishedVersionId,
      publishedAt: r.status === "published" ? r.updatedAt.toISOString() : undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getPage(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; draft?: boolean | undefined },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [p] = await tx.select().from(schema.pages).where(eq(schema.pages.id, input.id));
    if (!p) throw new Error(`Page not found: "${input.id}"`);

    // Fetch the version to show: the editor asks for the draft (falling back to published),
    // everyone else gets the published version (falling back to the latest).
    const wantedVersionId = input.draft
      ? (p.draftVersionId ?? p.publishedVersionId)
      : p.publishedVersionId;
    const versionQuery = wantedVersionId
      ? eq(schema.pageVersions.id, wantedVersionId)
      : eq(schema.pageVersions.pageId, p.id);

    const [ver] = await tx
      .select()
      .from(schema.pageVersions)
      .where(versionQuery)
      .orderBy(desc(schema.pageVersions.createdAt))
      .limit(1);

    const doc = (ver?.document as { blocks?: unknown[] } | null) ?? { blocks: [] };

    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      type: p.type,
      description: undefined,
      publishedVersionId: p.publishedVersionId,
      draftVersionId: p.draftVersionId,
      hasUnpublishedChanges: !!p.draftVersionId && p.draftVersionId !== p.publishedVersionId,
      publishedAt: p.status === "published" ? p.updatedAt.toISOString() : undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      blocks: doc.blocks ?? [],
      version: 1,
    };
  });
}

/** Saved versions of a page, newest first (for rollback, including after a theme switch). */
export async function listPageVersions(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [p] = await tx.select().from(schema.pages).where(eq(schema.pages.id, input.id));
    if (!p) throw new Error(`Page not found: "${input.id}"`);
    const rows = await tx
      .select({
        id: schema.pageVersions.id,
        note: schema.pageVersions.note,
        createdAt: schema.pageVersions.createdAt,
      })
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, input.id))
      .orderBy(desc(schema.pageVersions.createdAt))
      .limit(30);
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      isPublished: r.id === p.publishedVersionId,
      isDraft: r.id === p.draftVersionId,
    }));
  });
}

export async function createPage(rt: Runtime, ctx: TenantContext, input: CreatePageInput) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.pages)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        slug: input.slug,
      })
      .returning();

    if (!row) throw new Error("Failed to create page");
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: undefined,
      publishedVersionId: row.publishedVersionId,
      publishedAt: undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function updatePage(rt: Runtime, ctx: TenantContext, input: UpdatePageInput) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updateData.title = input.title;
    if (input.slug !== undefined) updateData.slug = input.slug;
    if (input.seo !== undefined) updateData.seo = input.seo;

    const [row] = await tx
      .update(schema.pages)
      .set(updateData)
      .where(eq(schema.pages.id, input.id))
      .returning();

    if (!row) throw new Error(`Page not found: "${input.id}"`);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: undefined,
      publishedVersionId: row.publishedVersionId,
      publishedAt: row.status === "published" ? row.updatedAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function savePageDraft(rt: Runtime, ctx: TenantContext, input: SaveDraftInput) {
  assertPermission(ctx, "content.write");

  // Validate block document per ADR-009
  const validation = validateBlockDocument({ version: 1, blocks: input.blocks });
  if (!validation.success) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join(", ");
    throw new Error(`Validation failed: ${msg}`);
  }

  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [created] = await tx
      .insert(schema.pageVersions)
      .values({
        tenantId: ctx.tenantId,
        pageId: input.id,
        document: validation.data,
      })
      .returning();

    if (!created) throw new Error("Failed to create page version draft");

    await tx
      .update(schema.pages)
      .set({
        draftVersionId: created.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.id));

    return { versionId: created.id };
  });
}

export async function publishPage(rt: Runtime, ctx: TenantContext, input: PublishPageInput) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    let targetVersionId = input.versionId;

    if (!targetVersionId) {
      const [latest] = await tx
        .select({ id: schema.pageVersions.id })
        .from(schema.pageVersions)
        .where(eq(schema.pageVersions.pageId, input.id))
        .orderBy(desc(schema.pageVersions.createdAt))
        .limit(1);

      if (!latest) throw new Error("No page versions found to publish");
      targetVersionId = latest.id;
    }

    const updateQuery = tx
      .update(schema.pages)
      .set({
        publishedVersionId: targetVersionId,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.id));

    const rows = typeof updateQuery.returning === "function"
      ? await updateQuery.returning()
      : await updateQuery;
    const updatedPage = Array.isArray(rows) ? rows[0] : undefined;

    await invalidatePageCache(rt, ctx, updatedPage);

    return { success: true, publishedVersionId: targetVersionId };
  });
}

export async function rollbackPage(rt: Runtime, ctx: TenantContext, input: RollbackPageInput) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateQuery = tx
      .update(schema.pages)
      .set({
        publishedVersionId: input.targetVersionId,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.id));

    const rows = typeof updateQuery.returning === "function"
      ? await updateQuery.returning()
      : await updateQuery;
    const updatedPage = Array.isArray(rows) ? rows[0] : undefined;

    await invalidatePageCache(rt, ctx, updatedPage);

    return { success: true, publishedVersionId: input.targetVersionId };
  });
}

// --- Menu Services ---
export async function listMenus(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.menus).orderBy(schema.menus.title);
    return rows.map((r) => ({
      id: r.id,
      name: r.title,
      handle: r.handle,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getMenu(rt: Runtime, ctx: TenantContext, input: { handle: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.menus)
      .where(eq(schema.menus.handle, input.handle));

    if (!row) throw new Error(`Menu not found: "${input.handle}"`);

    return {
      id: row.id,
      name: row.title,
      handle: row.handle,
      items: (row.items as unknown[]) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function createMenu(
  rt: Runtime,
  ctx: TenantContext,
  input: { name: string; handle: string; items?: unknown[] | undefined },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.menus)
      .values({
        tenantId: ctx.tenantId,
        title: input.name,
        handle: input.handle,
        items: input.items ?? [],
      })
      .returning();

    if (!row) throw new Error("Failed to create menu");

    return {
      id: row.id,
      name: row.title,
      handle: row.handle,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function updateMenu(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; name?: string | undefined; items?: unknown[] | undefined },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.title = input.name;
    if (input.items !== undefined) updateData.items = input.items;

    const [row] = await tx
      .update(schema.menus)
      .set(updateData)
      .where(eq(schema.menus.id, input.id))
      .returning();

    if (!row) throw new Error(`Menu not found: "${input.id}"`);

    await invalidateCache(rt, ctx, { type: "nav_updated" });

    return {
      id: row.id,
      name: row.title,
      handle: row.handle,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function deleteMenu(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.menus).where(eq(schema.menus.id, input.id));
    return { success: true };
  });
}

// --- Storefront Public Content Services ---

export interface StorefrontPageDetail {
  id: string;
  slug: string;
  title: string;
  type: string;
  seo: unknown;
  publishedAt?: string | undefined;
  document: {
    version: 1;
    blocks: unknown[];
  };
}

/**
 * Retrieves a published page by slug for storefront visitor rendering.
 */
export async function getStorefrontPage(
  rt: Runtime,
  ctx: TenantContext,
  slug: string,
): Promise<StorefrontPageDetail | null> {
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.tenantId, ctx.tenantId),
          eq(schema.pages.slug, slug),
          eq(schema.pages.status, "published"),
          // Header, footer and product/collection layouts are not public pages.
          notInArray(schema.pages.type, [...THEME_SYSTEM_PAGE_TYPES]),
        ),
      )
      .limit(1);

    if (!p || !p.publishedVersionId) {
      return null;
    }

    const [ver] = await tx
      .select()
      .from(schema.pageVersions)
      .where(
        and(
          eq(schema.pageVersions.tenantId, ctx.tenantId),
          eq(schema.pageVersions.id, p.publishedVersionId),
        ),
      )
      .limit(1);

    const doc = (ver?.document as { version?: 1; blocks?: unknown[] } | null) ?? {
      version: 1,
      blocks: [],
    };

    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      type: p.type,
      seo: p.seo,
      publishedAt: p.updatedAt.toISOString(),
      document: {
        version: 1,
        blocks: Array.isArray(doc.blocks) ? doc.blocks : [],
      },
    };
  });
}

/**
 * Retrieves published home page document or default starter blocks if no page authored yet.
 */
export async function getStorefrontHomePage(
  rt: Runtime,
  ctx: TenantContext,
): Promise<{
  id?: string;
  title: string;
  seo?: unknown;
  document: { version: 1; blocks: unknown[] };
}> {
  const db = rt._db.db;

  const publishedHome = await withTenant(db, ctx.tenantId, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.tenantId, ctx.tenantId),
          eq(schema.pages.type, "home"),
          eq(schema.pages.status, "published"),
        ),
      )
      .limit(1);

    if (!p || !p.publishedVersionId) {
      return null;
    }

    const [ver] = await tx
      .select()
      .from(schema.pageVersions)
      .where(
        and(
          eq(schema.pageVersions.tenantId, ctx.tenantId),
          eq(schema.pageVersions.id, p.publishedVersionId),
        ),
      )
      .limit(1);

    const doc = (ver?.document as { version?: 1; blocks?: unknown[] } | null) ?? {
      version: 1,
      blocks: [],
    };

    return {
      id: p.id,
      title: p.title,
      seo: p.seo,
      document: {
        version: 1 as const,
        blocks: Array.isArray(doc.blocks) ? doc.blocks : [],
      },
    };
  });

  if (publishedHome && publishedHome.document.blocks.length > 0) {
    return publishedHome;
  }

  // Default starter blocks if no home page authored yet
  return {
    title: "Home",
    document: {
      version: 1,
      blocks: [
        {
          id: "default-hero",
          type: "Hero",
          version: 1,
          props: {
            title: "Welcome to Our Store",
            subtitle: "Discover our handcrafted collection of high-quality products.",
            ctaText: "Shop All",
            ctaLink: "/collections",
            alignment: "center",
          },
        },
        {
          id: "default-usp",
          type: "UspStrip",
          version: 1,
          props: {
            items: [
              { icon: "Truck", title: "Free Shipping", description: "On orders above ₹999 across India" },
              { icon: "ShieldCheck", title: "100% Authentic", description: "Direct from verified makers" },
              { icon: "RotateCcw", title: "Easy Returns", description: "7-day seamless exchange guarantee" },
              { icon: "Headphones", title: "Dedicated Support", description: "Friendly support via WhatsApp" },
            ],
          },
        },
        {
          id: "default-grid",
          type: "ProductGrid",
          version: 1,
          props: {
            title: "Featured Products",
            subtitle: "Explore our latest arrivals",
            limit: 8,
            columns: "4",
          },
        },
        {
          id: "default-newsletter",
          type: "Newsletter",
          version: 1,
          props: {
            title: "Subscribe to Our Newsletter",
            subtitle: "Get updates on new releases, special discounts, and seasonal collections.",
            buttonText: "Subscribe",
            placeholder: "Enter your email address",
          },
        },
      ],
    },
  };
}

