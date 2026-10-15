import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { clearMediaUsagesForOwner, syncMediaUsages } from "../media-services.ts";
import { cleanBlogSeo, slugifyBlog, type BlogSeoInput } from "./content.ts";
import { auditBlog, type Tx } from "./shared.ts";

export interface BlogCategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageMediaId: string | null;
  position: number;
  isActive: boolean;
  seo: BlogSeoInput | null;
  postCount: number;
  children?: BlogCategoryRow[];
}

export interface BlogCategoryInput {
  name: string;
  slug?: string | undefined;
  parentId?: string | null | undefined;
  description?: string | null | undefined;
  imageMediaId?: string | null | undefined;
  isActive?: boolean | undefined;
  seo?: BlogSeoInput | null | undefined;
}

const bad = (m: string) => new Error(`Bad Request: ${m}`);

function cleanDescription(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t) return null;
  if (/[<>]/.test(t)) throw bad("The description must be plain text (no HTML).");
  if (t.length > 300) throw bad("The description can be at most 300 characters.");
  return t;
}

async function uniqueCategorySlug(tx: Tx, tenantId: string, base: string, excludeId?: string): Promise<string> {
  const root = base || "category";
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const [hit] = await tx
      .select({ id: schema.blogCategories.id })
      .from(schema.blogCategories)
      .where(and(eq(schema.blogCategories.tenantId, tenantId), eq(schema.blogCategories.slug, candidate)))
      .limit(1);
    if (!hit || hit.id === excludeId) return candidate;
  }
}

/** Category -> subcategory only (ADR-033): a parent must exist and must itself be a top-level category. */
async function assertParent(tx: Tx, tenantId: string, parentId: string, selfId?: string): Promise<void> {
  if (selfId && parentId === selfId) throw bad("A category cannot be its own parent.");
  const [p] = await tx
    .select({ parentId: schema.blogCategories.parentId })
    .from(schema.blogCategories)
    .where(and(eq(schema.blogCategories.tenantId, tenantId), eq(schema.blogCategories.id, parentId)))
    .limit(1);
  if (!p) throw bad("The parent category does not exist.");
  if (p.parentId) throw bad("Categories can only be nested one level (category and subcategory).");
  if (selfId) {
    const [kid] = await tx
      .select({ id: schema.blogCategories.id })
      .from(schema.blogCategories)
      .where(and(eq(schema.blogCategories.tenantId, tenantId), eq(schema.blogCategories.parentId, selfId)))
      .limit(1);
    if (kid) throw bad("A category that has subcategories cannot become a subcategory.");
  }
}

/** Category tree for the admin (every category; post counts include drafts). */
export async function listBlogCategories(rt: Runtime, ctx: TenantContext): Promise<BlogCategoryRow[]> {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.blogCategories.id,
        parentId: schema.blogCategories.parentId,
        name: schema.blogCategories.name,
        slug: schema.blogCategories.slug,
        description: schema.blogCategories.description,
        imageMediaId: schema.blogCategories.imageMediaId,
        position: schema.blogCategories.position,
        isActive: schema.blogCategories.isActive,
        seo: schema.blogCategories.seo,
        postCount: sql<number>`(select count(*)::int from blog_posts p where p.tenant_id = ${schema.blogCategories.tenantId} and p.category_id = ${schema.blogCategories.id})`,
      })
      .from(schema.blogCategories)
      .where(eq(schema.blogCategories.tenantId, ctx.tenantId))
      .orderBy(asc(schema.blogCategories.position), asc(schema.blogCategories.name));
    const all: BlogCategoryRow[] = rows.map((r) => ({ ...r, seo: (r.seo as BlogSeoInput | null) ?? null }));
    const roots = all.filter((c) => !c.parentId);
    for (const r of roots) r.children = all.filter((c) => c.parentId === r.id);
    return roots;
  });
}

export async function createBlogCategory(
  rt: Runtime,
  ctx: TenantContext,
  input: BlogCategoryInput,
): Promise<{ id: string; slug: string }> {
  assertPermission(ctx, "content.write");
  const name = input.name.trim();
  if (!name) throw bad("The category needs a name.");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    if (input.parentId) await assertParent(tx, ctx.tenantId, input.parentId);
    const slug = await uniqueCategorySlug(tx, ctx.tenantId, slugifyBlog(input.slug?.trim() || name));
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.blogCategories.position}), -1)::int` })
      .from(schema.blogCategories)
      .where(
        and(
          eq(schema.blogCategories.tenantId, ctx.tenantId),
          input.parentId ? eq(schema.blogCategories.parentId, input.parentId) : isNull(schema.blogCategories.parentId),
        ),
      );
    const [row] = await tx
      .insert(schema.blogCategories)
      .values({
        tenantId: ctx.tenantId,
        parentId: input.parentId ?? null,
        name: name.slice(0, 120),
        slug,
        description: cleanDescription(input.description),
        imageMediaId: input.imageMediaId ?? null,
        isActive: input.isActive ?? true,
        seo: cleanBlogSeo(input.seo),
        position: (last?.max ?? -1) + 1,
      })
      .returning({ id: schema.blogCategories.id, slug: schema.blogCategories.slug });
    if (!row) throw new Error("Failed to create category");
    await syncMediaUsages(tx, ctx, { ownerType: "blog_category", ownerId: row.id, field: "image", mediaIds: [input.imageMediaId] });
    await auditBlog(tx, ctx, "blog.category.created", "blog_category", row.id, { name, slug: row.slug, parentId: input.parentId ?? null });
    return row;
  });
  await invalidateCache(rt, ctx, { type: "blog_category_changed", categoryId: result.id });
  return result;
}

export async function updateBlogCategory(rt: Runtime, ctx: TenantContext, id: string, input: { [K in keyof BlogCategoryInput]?: BlogCategoryInput[K] | undefined }): Promise<void> {
  assertPermission(ctx, "content.write");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [cur] = await tx
      .select({ id: schema.blogCategories.id })
      .from(schema.blogCategories)
      .where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.id, id)))
      .limit(1);
    if (!cur) throw bad("Category not found.");
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      if (!input.name.trim()) throw bad("The category needs a name.");
      set["name"] = input.name.trim().slice(0, 120);
    }
    if (input.slug !== undefined) set["slug"] = await uniqueCategorySlug(tx, ctx.tenantId, slugifyBlog(input.slug), id);
    if (input.parentId !== undefined) {
      if (input.parentId) await assertParent(tx, ctx.tenantId, input.parentId, id);
      set["parentId"] = input.parentId;
    }
    if (input.description !== undefined) set["description"] = cleanDescription(input.description);
    if (input.imageMediaId !== undefined) set["imageMediaId"] = input.imageMediaId;
    if (input.isActive !== undefined) set["isActive"] = input.isActive;
    if (input.seo !== undefined) set["seo"] = cleanBlogSeo(input.seo);
    await tx.update(schema.blogCategories).set(set).where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.id, id)));
    if (input.imageMediaId !== undefined) {
      await syncMediaUsages(tx, ctx, { ownerType: "blog_category", ownerId: id, field: "image", mediaIds: [input.imageMediaId] });
    }
    await auditBlog(tx, ctx, "blog.category.updated", "blog_category", id, { changed: Object.keys(set).filter((k) => k !== "updatedAt") });
  });
  await invalidateCache(rt, ctx, { type: "blog_category_changed", categoryId: id });
}

/** Sets the order among siblings: `orderedIds` are siblings under one parent (or all top-level categories). */
export async function reorderBlogCategories(rt: Runtime, ctx: TenantContext, orderedIds: string[]): Promise<void> {
  assertPermission(ctx, "content.write");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (!id) continue;
      await tx
        .update(schema.blogCategories)
        .set({ position: i, updatedAt: new Date() })
        .where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.id, id)));
    }
    await auditBlog(tx, ctx, "blog.category.reordered", "blog_category", null, { count: orderedIds.length });
  });
  await invalidateCache(rt, ctx, { type: "blog_category_changed" });
}

/**
 * Deletes a category. Its subcategories move up to top level and its posts move to `moveTo` (or become
 * uncategorised when it is null), so a delete never hides or loses a post.
 */
export async function deleteBlogCategory(rt: Runtime, ctx: TenantContext, id: string, moveTo: string | null): Promise<void> {
  assertPermission(ctx, "content.write");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    if (moveTo === id) throw bad("Choose a different category to move the posts to.");
    if (moveTo) {
      const [t] = await tx
        .select({ id: schema.blogCategories.id })
        .from(schema.blogCategories)
        .where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.id, moveTo)))
        .limit(1);
      if (!t) throw bad("The category to move posts to does not exist.");
    }
    const kids = await tx
      .select({ id: schema.blogCategories.id })
      .from(schema.blogCategories)
      .where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.parentId, id)));
    await tx
      .update(schema.blogCategories)
      .set({ parentId: null, updatedAt: new Date() })
      .where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.parentId, id)));
    await tx
      .update(schema.blogPosts)
      .set({ categoryId: moveTo, updatedAt: new Date() })
      .where(and(eq(schema.blogPosts.tenantId, ctx.tenantId), eq(schema.blogPosts.categoryId, id)));
    await clearMediaUsagesForOwner(tx, ctx, { ownerType: "blog_category", ownerId: id });
    await tx.delete(schema.blogCategories).where(and(eq(schema.blogCategories.tenantId, ctx.tenantId), eq(schema.blogCategories.id, id)));
    await auditBlog(tx, ctx, "blog.category.deleted", "blog_category", id, { moveTo, promotedChildren: kids.length });
  });
  await invalidateCache(rt, ctx, { type: "blog_category_changed", categoryId: id });
}
