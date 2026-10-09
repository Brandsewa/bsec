import { and, desc, eq, notInArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { validateBlockDocument } from "@bs/blocks";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import { THEME_SYSTEM_PAGE_TYPES } from "./themes/system-pages.ts";

export interface PageSeoInput {
  title?: string | undefined;
  description?: string | undefined;
  imageMediaId?: string | null | undefined;
}

export interface CreatePageInput {
  title: string;
  slug: string;
  parentId?: string | null | undefined;
  description?: string | undefined;
  seo?: PageSeoInput | undefined;
}

export interface UpdatePageInput {
  id: string;
  title?: string | undefined;
  slug?: string | undefined;
  parentId?: string | null | undefined;
  description?: string | undefined;
  seo?: PageSeoInput | undefined;
}

export const RESERVED_PAGE_SLUGS = new Set([
  "account",
  "address",
  "admin",
  "api",
  "blog",
  "cart",
  "categories",
  "checkout",
  "cod",
  "collections",
  "home",
  "media",
  "o",
  "orders",
  "pages",
  "policies",
  "preview",
  "privacy-request",
  "privacy-verify",
  "products",
  "robots.txt",
  "search",
  "signup",
  "sitemap.xml",
  "unsubscribe",
]);

export function isReservedPageSlug(slug: string): boolean {
  const s = slug.toLowerCase().trim();
  if (s.startsWith("template-")) return true;
  return RESERVED_PAGE_SLUGS.has(s);
}

export function validatePageSlug(slug: string): string {
  const s = slug.toLowerCase().trim();
  if (!s) {
    throw new Error("Page slug cannot be empty.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
    throw new Error("Page slug must be lowercase alphanumeric characters separated by hyphens (e.g. 'about-us').");
  }
  if (isReservedPageSlug(s)) {
    throw new Error(`The URL slug "${s}" is reserved and cannot be used for a custom page.`);
  }
  return s;
}

export function parsePageSeo(raw: unknown): PageSeoInput | null | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    title: typeof obj.title === "string" ? obj.title : undefined,
    description: typeof obj.description === "string" ? obj.description : undefined,
    imageMediaId: typeof obj.imageMediaId === "string" ? obj.imageMediaId : null,
  };
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

  const res = await withTenant(db, ctx.tenantId, async (tx) => {
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

  await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });
  return res;
}

interface PageRowSummary {
  id: string;
  parentId: string | null;
  slug: string;
  type: string;
  title: string;
}

function computeCanonicalPath(
  page: { slug: string; type?: string | null; parentId?: string | null },
  pagesById: Map<string, { slug: string; parentId?: string | null; type?: string | null }>,
): string {
  if (page.type === "home" || page.slug === "home") {
    return "/";
  }
  const slugs = [page.slug];
  let curParentId = page.parentId;
  const visited = new Set<string>();
  while (curParentId) {
    if (visited.has(curParentId)) break;
    visited.add(curParentId);
    const parent = pagesById.get(curParentId);
    if (!parent) break;
    slugs.unshift(parent.slug);
    curParentId = parent.parentId;
  }
  return `/pages/${slugs.join("/")}`;
}

function validateHierarchyAndDepth(
  targetPageId: string | null,
  newParentId: string | null,
  allPages: PageRowSummary[],
) {
  if (!newParentId) return;

  if (targetPageId && newParentId === targetPageId) {
    throw new Error("A page cannot be its own parent.");
  }

  const pagesById = new Map(allPages.map((p) => [p.id, p]));
  const parent = pagesById.get(newParentId);
  if (!parent) {
    throw new Error("Parent page not found.");
  }

  if (parent.type === "home" || parent.slug === "home" || (THEME_SYSTEM_PAGE_TYPES as readonly string[]).includes(parent.type ?? "")) {
    throw new Error("Cannot set home or system page as parent.");
  }

  // Cycle check: trace parent up to root. If targetPageId is found, cycle!
  let curParentId: string | null = parent.parentId;
  let parentDepth = 1; // parent itself is at least depth 1 (root page has depth 1)
  const visited = new Set<string>([parent.id]);

  while (curParentId) {
    if (targetPageId && curParentId === targetPageId) {
      throw new Error("Circular parent reference detected.");
    }
    if (visited.has(curParentId)) {
      throw new Error("Circular parent reference detected.");
    }
    visited.add(curParentId);
    parentDepth++;
    const ancestor = pagesById.get(curParentId);
    if (!ancestor) break;
    curParentId = ancestor.parentId;
  }

  // Calculate target subtree height if updating an existing page
  let subtreeHeight = 0;
  if (targetPageId) {
    const childrenByParent = new Map<string, string[]>();
    for (const p of allPages) {
      if (p.parentId) {
        const list = childrenByParent.get(p.parentId) ?? [];
        list.push(p.id);
        childrenByParent.set(p.parentId, list);
      }
    }

    function getHeight(id: string): number {
      const kids = childrenByParent.get(id) ?? [];
      if (kids.length === 0) return 0;
      let maxH = 0;
      for (const k of kids) {
        maxH = Math.max(maxH, getHeight(k));
      }
      return 1 + maxH;
    }

    subtreeHeight = getHeight(targetPageId);
  }

  // Maximum allowed depth is 3.
  if (parentDepth + 1 + subtreeHeight > 3) {
    throw new Error("Hierarchy depth cannot exceed 3 levels.");
  }
}

function collectDescendantSlugs(
  targetPageId: string,
  allPages: PageRowSummary[],
): string[] {
  const childrenByParent = new Map<string, Array<{ id: string; slug: string }>>();
  for (const p of allPages) {
    if (p.parentId) {
      const list = childrenByParent.get(p.parentId) ?? [];
      list.push({ id: p.id, slug: p.slug });
      childrenByParent.set(p.parentId, list);
    }
  }

  const result: string[] = [];
  const queue = [...(childrenByParent.get(targetPageId) ?? [])];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    result.push(item.slug);
    const kids = childrenByParent.get(item.id) ?? [];
    queue.push(...kids);
  }
  return result;
}

function isPageReferencedInMenus(
  menusList: Array<{ title: string; items: unknown }>,
  pageSlugsAndPaths: string[],
): string | null {
  const targets = new Set(
    pageSlugsAndPaths.map((p) => p.toLowerCase().trim().replace(/\/+$/, "")),
  );

  function checkItems(items: unknown): boolean {
    if (!Array.isArray(items)) return false;
    for (const it of items) {
      if (typeof it === "object" && it !== null) {
        const item = it as { url?: unknown; children?: unknown };
        if (typeof item.url === "string") {
          const rawUrl = (item.url.trim().toLowerCase().split("?")[0] ?? "").replace(/\/+$/, "");
          if (targets.has(rawUrl)) {
            return true;
          }
        }
        if (Array.isArray(item.children) && checkItems(item.children)) {
          return true;
        }
      }
    }
    return false;
  }

  for (const menu of menusList) {
    if (checkItems(menu.items)) {
      return menu.title;
    }
  }
  return null;
}

// --- Page Services ---
export async function listPages(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.pages).orderBy(schema.pages.title);

    const pagesById = new Map(rows.map((r) => [r.id, r]));
    const childrenCountByParent = new Map<string, number>();
    for (const r of rows) {
      if (r.parentId) {
        childrenCountByParent.set(
          r.parentId,
          (childrenCountByParent.get(r.parentId) ?? 0) + 1,
        );
      }
    }

    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      slug: r.slug,
      title: r.title,
      type: r.type,
      path: computeCanonicalPath(r, pagesById),
      childCount: childrenCountByParent.get(r.id) ?? 0,
      description: undefined,
      status: r.status as "draft" | "published",
      seo: parsePageSeo(r.seo) ?? undefined,
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

    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const pagesById = new Map(allPages.map((row) => [row.id, row]));
    const childCount = allPages.filter((row) => row.parentId === p.id).length;

    return {
      id: p.id,
      parentId: p.parentId,
      slug: p.slug,
      title: p.title,
      type: p.type,
      path: computeCanonicalPath(p, pagesById),
      childCount,
      description: undefined,
      status: p.status as "draft" | "published",
      seo: parsePageSeo(p.seo) ?? undefined,
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

  const validSlug = validatePageSlug(input.slug);

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existingSlug] = await tx
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.slug, validSlug)))
      .limit(1);

    if (existingSlug) {
      throw new Error(`A page with the URL slug "${validSlug}" already exists.`);
    }

    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
        title: schema.pages.title,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    if (input.parentId) {
      validateHierarchyAndDepth(null, input.parentId, allPages);
    }

    const [row] = await tx
      .insert(schema.pages)
      .values({
        tenantId: ctx.tenantId,
        title: input.title.trim(),
        slug: validSlug,
        parentId: input.parentId ?? null,
        seo: input.seo ? input.seo : null,
        type: "custom",
        status: "draft",
      })
      .returning();

    if (!row) throw new Error("Failed to create page");

    const [draftVer] = await tx
      .insert(schema.pageVersions)
      .values({
        tenantId: ctx.tenantId,
        pageId: row.id,
        document: { version: 1, blocks: [] },
      })
      .returning();

    if (draftVer) {
      await tx
        .update(schema.pages)
        .set({ draftVersionId: draftVer.id })
        .where(eq(schema.pages.id, row.id));
    }

    const pagesById = new Map(allPages.map((p) => [p.id, p]));
    pagesById.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      type: row.type,
      title: row.title,
    });

    return {
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      title: row.title,
      type: row.type,
      path: computeCanonicalPath(row, pagesById),
      childCount: 0,
      description: undefined,
      status: row.status as "draft" | "published",
      seo: parsePageSeo(row.seo) ?? undefined,
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

  const { updated, oldSlug, descendantSlugs, slugOrParentChanged } = await withTenant(
    db,
    ctx.tenantId,
    async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.pages)
        .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.id, input.id)))
        .limit(1);

      if (!existing) throw new Error(`Page not found: "${input.id}"`);

      const isHome = existing.type === "home" || existing.slug === "home";

      let validSlug: string | undefined = undefined;
      if (input.slug !== undefined) {
        if (isHome && input.slug !== existing.slug) {
          throw new Error("Cannot change URL slug for home page.");
        }
        validSlug = isHome ? existing.slug : validatePageSlug(input.slug);

        if (validSlug !== existing.slug) {
          const [collision] = await tx
            .select({ id: schema.pages.id })
            .from(schema.pages)
            .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.slug, validSlug)))
            .limit(1);
          if (collision) {
            throw new Error(`A page with the URL slug "${validSlug}" already exists.`);
          }
        }
      }

      if (isHome && input.parentId) {
        throw new Error("Home page cannot have a parent.");
      }

      const allPages = await tx
        .select({
          id: schema.pages.id,
          parentId: schema.pages.parentId,
          slug: schema.pages.slug,
          type: schema.pages.type,
          title: schema.pages.title,
        })
        .from(schema.pages)
        .where(eq(schema.pages.tenantId, ctx.tenantId));

      if (input.parentId !== undefined && input.parentId !== existing.parentId) {
        validateHierarchyAndDepth(existing.id, input.parentId, allPages);
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) updateData.title = input.title.trim();
      if (validSlug !== undefined) updateData.slug = validSlug;
      if (input.parentId !== undefined) updateData.parentId = input.parentId;
      if (input.seo !== undefined) updateData.seo = input.seo;

      const [row] = await tx
        .update(schema.pages)
        .set(updateData)
        .where(eq(schema.pages.id, input.id))
        .returning();

      if (!row) throw new Error(`Page not found: "${input.id}"`);

      const slugChanged = validSlug !== undefined && validSlug !== existing.slug;
      const parentChanged = input.parentId !== undefined && input.parentId !== existing.parentId;
      const slugOrParentChanged = slugChanged || parentChanged;

      const descendantSlugs = slugOrParentChanged
        ? collectDescendantSlugs(existing.id, allPages)
        : [];

      return {
        updated: row,
        oldSlug: existing.slug,
        descendantSlugs,
        slugOrParentChanged,
      };
    },
  );

  if (slugOrParentChanged) {
    await invalidateCache(rt, ctx, {
      type: "page_published",
      slug: oldSlug,
      extraSlugs: Array.from(new Set([updated.slug, ...descendantSlugs])),
    });
  }

  return withTenant(db, ctx.tenantId, async (tx) => {
    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const pagesById = new Map(allPages.map((p) => [p.id, p]));
    const childCount = allPages.filter((p) => p.parentId === updated.id).length;

    return {
      id: updated.id,
      parentId: updated.parentId,
      slug: updated.slug,
      title: updated.title,
      type: updated.type,
      path: computeCanonicalPath(updated, pagesById),
      childCount,
      description: undefined,
      status: updated.status as "draft" | "published",
      seo: parsePageSeo(updated.seo) ?? undefined,
      publishedVersionId: updated.publishedVersionId,
      publishedAt: updated.status === "published" ? updated.updatedAt.toISOString() : undefined,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

export async function deletePage(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  const deletedPage = await withTenant(db, ctx.tenantId, async (tx) => {
    const [page] = await tx
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.id, input.id)))
      .limit(1);

    if (!page) throw new Error(`Page not found: "${input.id}"`);

    if (page.type === "home" || page.slug === "home" || (THEME_SYSTEM_PAGE_TYPES as readonly string[]).includes(page.type ?? "")) {
      throw new Error("Cannot delete home or system pages.");
    }

    const [child] = await tx
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.parentId, page.id)))
      .limit(1);

    if (child) {
      throw new Error("Cannot delete page: It has child pages. Delete or reassign its child pages first.");
    }

    const menus = await tx
      .select({ title: schema.menus.title, items: schema.menus.items })
      .from(schema.menus)
      .where(eq(schema.menus.tenantId, ctx.tenantId));

    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const pagesById = new Map(allPages.map((p) => [p.id, p]));
    const canonicalPath = computeCanonicalPath(page, pagesById);

    const referencedMenu = isPageReferencedInMenus(menus, [
      canonicalPath,
      `/pages/${page.slug}`,
      page.slug,
    ]);

    if (referencedMenu) {
      throw new Error(`Cannot delete page: It is referenced by navigation menu "${referencedMenu}". Remove the menu link first.`);
    }

    await tx.delete(schema.pageVersions).where(eq(schema.pageVersions.pageId, page.id));
    await tx.delete(schema.pages).where(eq(schema.pages.id, page.id));

    return page;
  });

  await invalidateCache(rt, ctx, { type: "page_published", slug: deletedPage.slug });

  return { success: true };
}

export async function unpublishPage(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  const { unpublished, descendantSlugs } = await withTenant(db, ctx.tenantId, async (tx) => {
    const [page] = await tx
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.id, input.id)))
      .limit(1);

    if (!page) throw new Error(`Page not found: "${input.id}"`);

    if (page.type === "home" || page.slug === "home") {
      throw new Error("Cannot unpublish the home page.");
    }

    const [row] = await tx
      .update(schema.pages)
      .set({
        status: "draft",
        publishedVersionId: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, page.id))
      .returning();

    if (!row) throw new Error("Failed to unpublish page");

    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
        title: schema.pages.title,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const descendantSlugs = collectDescendantSlugs(page.id, allPages);

    return { unpublished: row, descendantSlugs };
  });

  await invalidateCache(rt, ctx, {
    type: "page_published",
    slug: unpublished.slug,
    extraSlugs: descendantSlugs,
  });

  return { success: true };
}

export async function duplicatePage(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [page] = await tx
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.id, input.id)))
      .limit(1);

    if (!page) throw new Error(`Page not found: "${input.id}"`);

    if (page.type === "home" || (THEME_SYSTEM_PAGE_TYPES as readonly string[]).includes(page.type ?? "")) {
      throw new Error("Cannot duplicate home or system pages.");
    }

    const baseSlug = `${page.slug}-copy`;
    let candidateSlug = baseSlug;
    let counter = 2;

    const existingSlugs = await tx
      .select({ slug: schema.pages.slug })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const slugSet = new Set(existingSlugs.map((s) => s.slug.toLowerCase()));
    while (slugSet.has(candidateSlug.toLowerCase())) {
      candidateSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const sourceVersionId = page.draftVersionId ?? page.publishedVersionId;
    let doc = { version: 1, blocks: [] };
    if (sourceVersionId) {
      const [v] = await tx
        .select()
        .from(schema.pageVersions)
        .where(eq(schema.pageVersions.id, sourceVersionId))
        .limit(1);
      if (v?.document && typeof v.document === "object") {
        doc = v.document as { version: 1; blocks: [] };
      }
    }

    const [newPage] = await tx
      .insert(schema.pages)
      .values({
        tenantId: ctx.tenantId,
        title: `${page.title} (Copy)`,
        slug: candidateSlug,
        parentId: page.parentId,
        seo: page.seo,
        type: page.type,
        status: "draft",
      })
      .returning();

    if (!newPage) throw new Error("Failed to duplicate page");

    const [newVer] = await tx
      .insert(schema.pageVersions)
      .values({
        tenantId: ctx.tenantId,
        pageId: newPage.id,
        document: doc,
      })
      .returning();

    if (newVer) {
      await tx
        .update(schema.pages)
        .set({ draftVersionId: newVer.id })
        .where(eq(schema.pages.id, newPage.id));
    }

    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        type: schema.pages.type,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const pagesById = new Map(allPages.map((p) => [p.id, p]));

    return {
      id: newPage.id,
      parentId: newPage.parentId,
      slug: newPage.slug,
      title: newPage.title,
      type: newPage.type,
      path: computeCanonicalPath(newPage, pagesById),
      childCount: 0,
      description: undefined,
      status: newPage.status as "draft" | "published",
      seo: parsePageSeo(newPage.seo) ?? undefined,
      publishedVersionId: newPage.publishedVersionId,
      publishedAt: undefined,
      createdAt: newPage.createdAt.toISOString(),
      updatedAt: newPage.updatedAt.toISOString(),
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

  const { updatedPage, targetVersionId: finalVersionId } = await withTenant(db, ctx.tenantId, async (tx) => {
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
    const updated = Array.isArray(rows) ? rows[0] : undefined;

    return { updatedPage: updated, targetVersionId };
  });

  await invalidatePageCache(rt, ctx, updatedPage);

  return { success: true, publishedVersionId: finalVersionId };
}

export async function rollbackPage(rt: Runtime, ctx: TenantContext, input: RollbackPageInput) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  const updatedPage = await withTenant(db, ctx.tenantId, async (tx) => {
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
    return Array.isArray(rows) ? rows[0] : undefined;
  });

  await invalidatePageCache(rt, ctx, updatedPage);

  return { success: true, publishedVersionId: input.targetVersionId };
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

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.title = input.name;
    if (input.items !== undefined) updateData.items = input.items;

    const [updated] = await tx
      .update(schema.menus)
      .set(updateData)
      .where(eq(schema.menus.id, input.id))
      .returning();

    if (!updated) throw new Error(`Menu not found: "${input.id}"`);
    return updated;
  });

  await invalidateCache(rt, ctx, { type: "nav_updated" });

  return {
    id: row.id,
    name: row.title,
    handle: row.handle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

export interface StorefrontPageByPathResult {
  page: StorefrontPageDetail;
  canonicalPath: string;
  isCanonical: boolean;
  breadcrumbs: Array<{ name: string; url: string }>;
}

/**
 * Retrieves a published page by path segments for hierarchical canonical URL resolution.
 * Verifies full ancestor chain. Returns canonicalPath and isCanonical flag.
 */
export async function getStorefrontPageByPath(
  rt: Runtime,
  ctx: TenantContext,
  pathSegments: string[],
): Promise<StorefrontPageByPathResult | null> {
  if (!pathSegments || pathSegments.length === 0) {
    return null;
  }

  const targetSlug = pathSegments[pathSegments.length - 1]?.toLowerCase().trim();
  if (!targetSlug) return null;

  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.tenantId, ctx.tenantId),
          eq(schema.pages.slug, targetSlug),
          eq(schema.pages.status, "published"),
          notInArray(schema.pages.type, [...THEME_SYSTEM_PAGE_TYPES]),
        ),
      )
      .limit(1);

    if (!p || !p.publishedVersionId || p.type === "home") {
      return null;
    }

    const allPages = await tx
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        slug: schema.pages.slug,
        title: schema.pages.title,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, ctx.tenantId));

    const pagesById = new Map(allPages.map((row) => [row.id, row]));

    // Trace ancestor chain
    const ancestorChain: Array<{ slug: string; title: string }> = [{ slug: p.slug, title: p.title }];
    let curParentId = p.parentId;
    const visited = new Set<string>();

    while (curParentId) {
      if (visited.has(curParentId)) break;
      visited.add(curParentId);
      const ancestor = pagesById.get(curParentId);
      if (!ancestor) break;
      ancestorChain.unshift({ slug: ancestor.slug, title: ancestor.title });
      curParentId = ancestor.parentId;
    }

    const canonicalSlugs = ancestorChain.map((a) => a.slug);
    const canonicalPath = `/pages/${canonicalSlugs.join("/")}`;
    const isCanonical =
      pathSegments.length === canonicalSlugs.length &&
      pathSegments.every((seg, idx) => seg.toLowerCase() === canonicalSlugs[idx]?.toLowerCase());

    const breadcrumbs = [
      { name: "Home", url: "/" },
      ...ancestorChain.map((a, idx) => ({
        name: a.title,
        url: `/pages/${canonicalSlugs.slice(0, idx + 1).join("/")}`,
      })),
    ];

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
      page: {
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
      },
      canonicalPath,
      isCanonical,
      breadcrumbs,
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

