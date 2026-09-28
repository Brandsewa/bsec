import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { validateBlockDocument } from "@bs/blocks";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";

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
      description: undefined,
      publishedVersionId: r.publishedVersionId,
      publishedAt: r.status === "published" ? r.updatedAt.toISOString() : undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getPage(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [p] = await tx.select().from(schema.pages).where(eq(schema.pages.id, input.id));
    if (!p) throw new Error(`Page not found: "${input.id}"`);

    // Fetch published or latest version
    const versionQuery = p.publishedVersionId
      ? eq(schema.pageVersions.id, p.publishedVersionId)
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
      description: undefined,
      publishedVersionId: p.publishedVersionId,
      publishedAt: p.status === "published" ? p.updatedAt.toISOString() : undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      blocks: doc.blocks ?? [],
      version: 1,
    };
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

    await tx
      .update(schema.pages)
      .set({
        publishedVersionId: targetVersionId,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.id));

    return { success: true, publishedVersionId: targetVersionId };
  });
}

export async function rollbackPage(rt: Runtime, ctx: TenantContext, input: RollbackPageInput) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx
      .update(schema.pages)
      .set({
        publishedVersionId: input.targetVersionId,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.id));

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
