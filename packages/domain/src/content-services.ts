import { and, desc, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { normalizeMenuItems } from "./menu-defaults.ts";
import { schema, withTenant } from "@bs/db";
import { getBlockDefinition, hasMarketingBlocks, normalizeStoreHref, validateBlockDocument } from "@bs/blocks";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import { THEME_SYSTEM_PAGES, THEME_SYSTEM_PAGE_TYPES } from "./themes/system-pages.ts";
import { clearMediaUsagesForOwner } from "./media-services.ts";
import {
  clearDocumentMediaUsages,
  syncDocumentMediaUsages,
} from "./media/document-usages.ts";

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
    throw new Error("Bad Request: Page slug cannot be empty.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
    throw new Error("Bad Request: Page slug must be lowercase alphanumeric characters separated by hyphens (e.g. 'about-us').");
  }
  if (isReservedPageSlug(s)) {
    throw new Error(`Bad Request: The URL slug "${s}" is reserved and cannot be used for a custom page.`);
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

/**
 * A homepage version: a copy of the home page that is not live. It is a `pages` row of this type, always a draft, so the public page
 * lookup and the sitemap (published rows only) never see it. "Make active" swaps it with the live home page (`activateHomePage`).
 */
export const HOME_VARIANT_TYPE = "home_variant";

async function assertNotHomeVariant(tx: Parameters<Parameters<typeof withTenant>[2]>[0], tenantId: string, id: string) {
  const [row] = await tx
    .select({ type: schema.pages.type })
    .from(schema.pages)
    .where(and(eq(schema.pages.tenantId, tenantId), eq(schema.pages.id, id)))
    .limit(1);
  if (row?.type === HOME_VARIANT_TYPE) {
    throw new Error("Bad Request: A homepage version goes live through \"Make active\", not Publish.");
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

      if (input.tokens !== undefined) {
        await syncDocumentMediaUsages(tx, ctx, {
          ownerType: "theme",
          ownerId: row.id,
          field: "tokens",
          document: input.tokens,
        });
      }

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

    if (input.tokens !== undefined) {
      await syncDocumentMediaUsages(tx, ctx, {
        ownerType: "theme",
        ownerId: row.id,
        field: "tokens",
        document: input.tokens,
      });
    }

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

export function computeCanonicalPath(
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
    throw new Error("Bad Request: A page cannot be its own parent.");
  }

  const pagesById = new Map(allPages.map((p) => [p.id, p]));
  const parent = pagesById.get(newParentId);
  if (!parent) {
    throw new Error("Bad Request: Parent page not found.");
  }

  if (parent.type === "home" || parent.type === HOME_VARIANT_TYPE || parent.slug === "home" || (THEME_SYSTEM_PAGE_TYPES as readonly string[]).includes(parent.type ?? "")) {
    throw new Error("Bad Request: Cannot set home or system page as parent.");
  }

  // Cycle check: trace parent up to root. If targetPageId is found, cycle!
  let curParentId: string | null = parent.parentId;
  let parentDepth = 1; // parent itself is at least depth 1 (root page has depth 1)
  const visited = new Set<string>([parent.id]);

  while (curParentId) {
    if (targetPageId && curParentId === targetPageId) {
      throw new Error("Bad Request: Circular parent reference detected.");
    }
    if (visited.has(curParentId)) {
      throw new Error("Bad Request: Circular parent reference detected.");
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
    throw new Error("Bad Request: Hierarchy depth cannot exceed 3 levels.");
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

export function isPageReferencedInMenus(
  menusList: Array<{ title: string; items: unknown }>,
  pageSlugsAndPaths: string[],
  pageId?: string,
): string | null {
  const targets = new Set(
    pageSlugsAndPaths.map((p) => p.toLowerCase().trim().replace(/\/+$/, "")),
  );

  function checkItems(items: unknown): boolean {
    if (!Array.isArray(items)) return false;
    for (const it of items) {
      if (typeof it === "object" && it !== null) {
        const item = it as { url?: unknown; children?: unknown; targetId?: unknown };
        if (pageId && typeof item.targetId === "string" && item.targetId === pageId) {
          return true;
        }
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
    if (!p) throw new Error(`Not Found: Page not found: "${input.id}"`);

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

const PAGE_VERSIONS_DEFAULT_LIMIT = 30;
const PAGE_VERSIONS_MAX_LIMIT = 100;

function documentBlockCount(document: unknown): number {
  const blocks = (document as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks) ? blocks.length : 0;
}

/**
 * Saved versions of a page, newest first, without their blocks (the list stays small; a version's blocks are read one at a
 * time with getPageVersion). `before` is the createdAt of the last row already loaded, for "load more".
 */
export async function listPageVersions(rt: Runtime, ctx: TenantContext, input: { id: string; limit?: number | undefined; before?: string | undefined }) {
  assertPermission(ctx, "content.write");
  const limit = Math.min(Math.max(input.limit ?? PAGE_VERSIONS_DEFAULT_LIMIT, 1), PAGE_VERSIONS_MAX_LIMIT);
  const before = input.before ? new Date(input.before) : undefined;
  if (before && Number.isNaN(before.getTime())) throw new Error("Bad Request: invalid cursor");
  const { page, rows } = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [p] = await tx.select().from(schema.pages).where(eq(schema.pages.id, input.id));
    if (!p) throw new Error(`Not Found: Page not found: "${input.id}"`);
    const found = await tx
      .select({
        id: schema.pageVersions.id,
        note: schema.pageVersions.note,
        createdAt: schema.pageVersions.createdAt,
        createdBy: schema.pageVersions.createdBy,
        document: schema.pageVersions.document,
      })
      .from(schema.pageVersions)
      .where(before ? and(eq(schema.pageVersions.pageId, input.id), lt(schema.pageVersions.createdAt, before)) : eq(schema.pageVersions.pageId, input.id))
      .orderBy(desc(schema.pageVersions.createdAt))
      .limit(limit);
    return { page: p, rows: found };
  });
  // Staff names live in the global users table; older versions have no author.
  const authorIds = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const users = await rt._db.db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, authorIds));
    for (const u of users) names.set(u.id, u.name || u.email);
  }
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    blockCount: documentBlockCount(r.document),
    isPublished: r.id === page.publishedVersionId,
    isDraft: r.id === page.draftVersionId,
  }));
}

/** One saved version's blocks, for previewing it before a restore. The version must belong to this page. */
export async function getPageVersion(rt: Runtime, ctx: TenantContext, input: { id: string; versionId: string }) {
  assertPermission(ctx, "content.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.pageVersions.id, document: schema.pageVersions.document, createdAt: schema.pageVersions.createdAt })
      .from(schema.pageVersions)
      .where(and(eq(schema.pageVersions.id, input.versionId), eq(schema.pageVersions.pageId, input.id)))
      .limit(1);
    if (!row) throw new Error(`Not Found: Version not found: "${input.versionId}"`);
    const blocks = (row.document as { blocks?: unknown[] } | null)?.blocks;
    return { id: row.id, createdAt: row.createdAt.toISOString(), blocks: Array.isArray(blocks) ? blocks : [] };
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
      throw new Error(`Bad Request: A page with the URL slug "${validSlug}" already exists.`);
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

      await syncDocumentMediaUsages(tx, ctx, {
        ownerType: "page",
        ownerId: row.id,
        field: "draft",
        document: { version: 1, blocks: [] },
      });
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

      if (!existing) throw new Error(`Not Found: Page not found: "${input.id}"`);

      const isHome = existing.type === "home" || existing.slug === "home" || existing.type === HOME_VARIANT_TYPE;

      let validSlug: string | undefined = undefined;
      if (input.slug !== undefined) {
        if (isHome && input.slug !== existing.slug) {
          throw new Error("Bad Request: Cannot change URL slug for home page.");
        }
        validSlug = isHome ? existing.slug : validatePageSlug(input.slug);

        if (validSlug !== existing.slug) {
          const [collision] = await tx
            .select({ id: schema.pages.id })
            .from(schema.pages)
            .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.slug, validSlug)))
            .limit(1);
          if (collision) {
            throw new Error(`Bad Request: A page with the URL slug "${validSlug}" already exists.`);
          }
        }
      }

      if (isHome && input.parentId) {
        throw new Error("Bad Request: Home page cannot have a parent.");
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

      if (!row) throw new Error(`Not Found: Page not found: "${input.id}"`);

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

    if (!page) throw new Error(`Not Found: Page not found: "${input.id}"`);

    if (page.type === "home" || page.slug === "home" || (THEME_SYSTEM_PAGE_TYPES as readonly string[]).includes(page.type ?? "")) {
      throw new Error("Bad Request: Cannot delete home or system pages.");
    }

    const [child] = await tx
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.parentId, page.id)))
      .limit(1);

    if (child) {
      throw new Error("Bad Request: Cannot delete page: It has child pages. Delete or reassign its child pages first.");
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

    const referencedMenu = isPageReferencedInMenus(
      menus,
      [canonicalPath, `/pages/${page.slug}`, page.slug],
      page.id,
    );

    if (referencedMenu) {
      throw new Error(`Bad Request: Cannot delete page: It is referenced by navigation menu "${referencedMenu}". Remove the menu link first.`);
    }

    await clearMediaUsagesForOwner(tx, ctx, { ownerType: "page", ownerId: page.id });
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

    if (!page) throw new Error(`Not Found: Page not found: "${input.id}"`);

    if (page.type === "home" || page.slug === "home") {
      throw new Error("Bad Request: Cannot unpublish the home page.");
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

    await clearDocumentMediaUsages(tx, ctx, {
      ownerType: "page",
      ownerId: page.id,
      field: "published",
    });

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

    if (!page) throw new Error(`Not Found: Page not found: "${input.id}"`);

    if ((THEME_SYSTEM_PAGE_TYPES as readonly string[]).includes(page.type ?? "")) {
      throw new Error("Bad Request: Cannot duplicate system pages.");
    }
    // Duplicating the home page (or one of its versions) makes another homepage version, not a normal page.
    const isHomeSource = page.type === "home" || page.type === HOME_VARIANT_TYPE;

    const baseSlug = isHomeSource ? "home-version" : `${page.slug}-copy`;
    let candidateSlug = isHomeSource ? `${baseSlug}-2` : baseSlug;
    let counter = 3;

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
        title: isHomeSource ? `Home (Version ${candidateSlug.slice(baseSlug.length + 1)})` : `${page.title} (Copy)`,
        slug: candidateSlug,
        parentId: isHomeSource ? null : page.parentId,
        seo: page.seo,
        type: isHomeSource ? HOME_VARIANT_TYPE : page.type,
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

      await syncDocumentMediaUsages(tx, ctx, {
        ownerType: "page",
        ownerId: newPage.id,
        field: "draft",
        document: doc,
      });
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

/**
 * Makes a homepage version the live home page. The two rows trade places: the version becomes `type = "home"`, slug `home`,
 * published from its latest draft; the old home page becomes a version (draft, slug `home-version-N`) that keeps its content, so
 * nothing is lost and it can be made active again. One transaction, so there is never no home page or two. Needs `theme.publish`.
 */
export async function activateHomePage(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    const [target] = await tx
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.id, input.id)))
      .limit(1);
    if (!target) throw new Error(`Not Found: Page not found: "${input.id}"`);
    if (target.type !== HOME_VARIANT_TYPE) throw new Error("Bad Request: Only a homepage version can be made active.");

    const [current] = await tx
      .select()
      .from(schema.pages)
      // The rest of the code treats type "home" or slug "home" as the home page, so the swap does too.
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), or(eq(schema.pages.type, "home"), eq(schema.pages.slug, "home"))))
      .limit(1);

    const targetVersionId = target.draftVersionId ?? target.publishedVersionId;
    if (!targetVersionId) throw new Error("Bad Request: This homepage version has no content to publish.");
    const [targetVer] = await tx
      .select({ document: schema.pageVersions.document })
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.id, targetVersionId))
      .limit(1);

    // 1. The old home page steps aside first, so the slug "home" is free (unique per store).
    let demotedSlug: string | null = null;
    if (current) {
      const taken = new Set(
        (await tx.select({ slug: schema.pages.slug }).from(schema.pages).where(eq(schema.pages.tenantId, ctx.tenantId))).map((r) => r.slug.toLowerCase()),
      );
      let n = 2;
      while (taken.has(`home-version-${n}`)) n++;
      demotedSlug = `home-version-${n}`;
      const keepVersionId = current.draftVersionId ?? current.publishedVersionId;
      await tx
        .update(schema.pages)
        .set({
          type: HOME_VARIANT_TYPE,
          slug: demotedSlug,
          title: current.title === "Home" ? `Home (Version ${n})` : current.title,
          status: "draft",
          publishedVersionId: null,
          draftVersionId: keepVersionId,
          updatedAt: new Date(),
        })
        .where(eq(schema.pages.id, current.id));
      await clearDocumentMediaUsages(tx, ctx, { ownerType: "page", ownerId: current.id, field: "published" });
    }

    // 2. The chosen version takes the home slot and goes live.
    const [row] = await tx
      .update(schema.pages)
      .set({
        type: "home",
        slug: "home",
        title: target.title.startsWith("Home (Version") ? "Home" : target.title,
        parentId: null,
        status: "published",
        publishedVersionId: targetVersionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, target.id))
      .returning();
    if (!row) throw new Error("Failed to make the homepage active");

    if (targetVer?.document) {
      await syncDocumentMediaUsages(tx, ctx, { ownerType: "page", ownerId: target.id, field: "published", document: targetVer.document }, { tolerant: true });
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "page.home_activated",
      targetType: "page",
      targetId: target.id,
      diff: { previousHomeId: current?.id ?? null, newHomeId: target.id, previousHomeNowSlug: demotedSlug },
    });
    return row;
  });

  // After commit: the home page content changed, so the home page and the store shell caches refresh.
  await invalidatePageCache(rt, ctx, result);

  return { success: true, id: result.id };
}

/** Block each ensurable theme template starts with: the built-in layout the storefront already draws. */
const ENSURABLE_TEMPLATE_BLOCKS = { blog: "BlogListing", "blog-post": "BlogPostContent" } as const;
export type EnsurableTemplateKey = keyof typeof ENSURABLE_TEMPLATE_BLOCKS;

/**
 * The blog archive and single post layouts are theme pages, but a store whose theme predates them has no row, so the editor's
 * page list could not offer them. This creates the missing one as a draft holding the built-in layout: the storefront keeps using
 * the same layout until the store publishes it. Safe to call again; it returns the existing page.
 */
export async function ensureThemeTemplatePage(rt: Runtime, ctx: TenantContext, input: { key: EnsurableTemplateKey }): Promise<{ id: string; created: boolean }> {
  assertPermission(ctx, "content.write");
  const def = THEME_SYSTEM_PAGES[input.key];
  const blockType = ENSURABLE_TEMPLATE_BLOCKS[input.key];

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.type, def.type)))
      .limit(1);
    if (existing) return { id: existing.id, created: false };

    const document = validateBlockDocument({
      version: 1,
      blocks: [{ id: crypto.randomUUID(), type: blockType, version: 1, props: { ...getBlockDefinition(blockType).defaultProps } }],
    });
    if (!document.success) throw new Error("The built-in template layout is not valid.");

    const [row] = await tx
      .insert(schema.pages)
      .values({ tenantId: ctx.tenantId, title: def.title, slug: def.slug, type: def.type, status: "draft" })
      .returning({ id: schema.pages.id });
    if (!row) throw new Error("Failed to create the template page");

    const [draft] = await tx
      .insert(schema.pageVersions)
      .values({ tenantId: ctx.tenantId, pageId: row.id, document: document.data })
      .returning({ id: schema.pageVersions.id });
    if (!draft) throw new Error("Failed to create the template draft");
    await tx.update(schema.pages).set({ draftVersionId: draft.id }).where(eq(schema.pages.id, row.id));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "page.template_created",
      targetType: "page",
      targetId: row.id,
      diff: { key: input.key, type: def.type },
    });
    return { id: row.id, created: true };
  });
}

export async function savePageDraft(rt: Runtime, ctx: TenantContext, input: SaveDraftInput) {
  assertPermission(ctx, "content.write");

  // Validate block document per ADR-009
  const validation = validateBlockDocument({ version: 1, blocks: input.blocks });
  if (!validation.success) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join(", ");
    throw new Error(`Bad Request: Validation failed: ${msg}`);
  }

  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // Website sections only render on the website record (ADR-042); only a document that has one pays for this read.
    if (hasMarketingBlocks(validation.data.blocks)) {
      const [tenant] = await tx.select({ kind: schema.tenants.kind }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId)).limit(1);
      if (tenant?.kind !== "platform_site") throw new Error("Bad Request: this block belongs to the platform's website");
    }

    const [created] = await tx
      .insert(schema.pageVersions)
      .values({
        tenantId: ctx.tenantId,
        pageId: input.id,
        document: validation.data,
        createdBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      })
      .returning();

    if (!created) throw new Error("Failed to create page version draft");

    await syncDocumentMediaUsages(tx, ctx, {
      ownerType: "page",
      ownerId: input.id,
      field: "draft",
      document: validation.data,
    });

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
    await assertNotHomeVariant(tx, ctx.tenantId, input.id);
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

    const [targetVer] = await tx
      .select({ id: schema.pageVersions.id, document: schema.pageVersions.document })
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.id, targetVersionId))
      .limit(1);

    if (targetVer?.document) {
      // The version was validated when it was saved as a draft; publishing it must not fail on later Trash or deletes.
      await syncDocumentMediaUsages(tx, ctx, {
        ownerType: "page",
        ownerId: input.id,
        field: "published",
        document: targetVer.document,
      }, { tolerant: true });
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

/**
 * Restores an old version of a page as the live page. The restore is itself a new version (a copy of the old one), so it can be
 * undone like any other change, and the old row stays as it was. The version must belong to this page: a version id from another
 * page (Header, Home...) is refused, because pointing a page at another page's blocks is exactly how a store lost its header.
 */
export async function rollbackPage(rt: Runtime, ctx: TenantContext, input: RollbackPageInput) {
  assertPermission(ctx, "theme.publish");
  const db = rt._db.db;

  const { updatedPage, restoredVersionId } = await withTenant(db, ctx.tenantId, async (tx) => {
    await assertNotHomeVariant(tx, ctx.tenantId, input.id);
    const [targetVer] = await tx
      .select({ id: schema.pageVersions.id, document: schema.pageVersions.document, createdAt: schema.pageVersions.createdAt })
      .from(schema.pageVersions)
      .where(and(eq(schema.pageVersions.id, input.targetVersionId), eq(schema.pageVersions.pageId, input.id)))
      .limit(1);
    if (!targetVer) throw new Error(`Not Found: Version not found for this page: "${input.targetVersionId}"`);

    const [restored] = await tx
      .insert(schema.pageVersions)
      .values({
        tenantId: ctx.tenantId,
        pageId: input.id,
        document: targetVer.document,
        createdBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        note: `Restored from ${targetVer.createdAt.toISOString()}`,
      })
      .returning({ id: schema.pageVersions.id });
    if (!restored) throw new Error("Failed to create the restored version");

    // Restoring history must not fail because a file was trashed or deleted since: that content was valid when saved.
    for (const field of ["published", "draft"] as const) {
      await syncDocumentMediaUsages(tx, ctx, { ownerType: "page", ownerId: input.id, field, document: targetVer.document }, { tolerant: true });
    }

    const updateQuery = tx
      .update(schema.pages)
      .set({
        publishedVersionId: restored.id,
        draftVersionId: restored.id,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.id));

    const rows = typeof updateQuery.returning === "function"
      ? await updateQuery.returning()
      : await updateQuery;

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "page.restored",
      targetType: "page",
      targetId: input.id,
      diff: { fromVersionId: input.targetVersionId, newVersionId: restored.id },
    });
    return { updatedPage: Array.isArray(rows) ? rows[0] : undefined, restoredVersionId: restored.id };
  });

  await invalidatePageCache(rt, ctx, updatedPage);

  return { success: true, publishedVersionId: restoredVersionId };
}

// --- Menu Services ---

const SAFE_MENU_SCHEME = /^(\/|#|https:\/\/|mailto:|tel:)/i;

export const FilterItemSchema = z.object({
  id: z.string(),
  type: z.literal("filter"),
  filter: z.object({
    kind: z.enum(["availability", "price", "brand", "category", "collection", "tag", "option"]),
    label: z.string().min(1),
    display: z.enum(["checkbox", "range", "swatch"]),
    optionName: z.string().optional(),
    collapsed: z.boolean().optional(),
  }),
});

export function isProtectedMenu(handle: string): boolean {
  return handle === "header" || handle === "footer";
}

/**
 * A menu link to the store's own preview address (`<store>.bcom.si`) becomes a relative path, as for block links
 * (`normalizeStoreHref`), so the menu keeps shoppers on the store's real domain. Only plain address items; nested items too.
 */
function tidyMenuLinks(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const it = { ...(item as Record<string, unknown>) };
    if ((it.type === undefined || it.type === "url") && typeof it.url === "string") it.url = normalizeStoreHref(it.url.trim());
    if (Array.isArray(it.children)) it.children = tidyMenuLinks(it.children);
    return it;
  });
}

function validateMenuItems(kind: string, items: unknown[], depth = 1): void {
  if (kind === "filter") {
    if (depth > 1) {
      throw new Error("Bad Request: Filter menus cannot have nested items");
    }
    for (const item of items) {
      const parsed = FilterItemSchema.safeParse(item);
      if (!parsed.success) {
        throw new Error(`Bad Request: Invalid filter menu item: ${parsed.error.message}`);
      }
      const children = (item as { children?: unknown[] }).children;
      if (Array.isArray(children) && children.length > 0) {
        throw new Error("Bad Request: Filter menus cannot have nested items");
      }
    }
    return;
  }

  // Navigation menu validation
  if (depth > 3) {
    throw new Error("Bad Request: Navigation menus cannot exceed 3 levels of nesting");
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new Error("Bad Request: Invalid menu item");
    }
    const it = item as Record<string, unknown>;
    const type = typeof it.type === "string" ? it.type : "url";
    if (type === "url" && typeof it.url === "string") {
      const u = it.url.trim();
      if (u && !SAFE_MENU_SCHEME.test(u)) {
        throw new Error(`Bad Request: Unsafe URL scheme in menu item: "${u}"`);
      }
      if (Boolean(it.openInNewTab || it.newTab) && !/^https:\/\//i.test(u)) {
        throw new Error("Bad Request: Only https: links can be set to open in a new tab");
      }
    }
    if (Array.isArray(it.children) && it.children.length > 0) {
      validateMenuItems("navigation", it.children, depth + 1);
    }
  }
}

function countMenuItems(items: unknown[]): number {
  let count = 0;
  for (const it of items) {
    if (it && typeof it === "object") {
      count += 1;
      const children = (it as { children?: unknown[] }).children;
      if (Array.isArray(children)) {
        count += countMenuItems(children);
      }
    }
  }
  return count;
}

function computeMenuUsage(
  menus: Array<{ handle: string }>,
  pages: Array<{ type: string; title: string; document?: unknown }>,
): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>();
  for (const m of menus) {
    const s = new Set<string>();
    if (m.handle === "header") s.add("Header");
    if (m.handle === "footer") s.add("Footer");
    usage.set(m.handle, s);
  }

  for (const page of pages) {
    const doc = page.document as { blocks?: Array<{ type?: string; props?: Record<string, unknown> }> } | null;
    if (!doc || !Array.isArray(doc.blocks)) continue;
    for (const b of doc.blocks) {
      if (!b || !b.props) continue;
      const menuH = b.props.menuHandle;
      if (typeof menuH === "string") {
        const set = usage.get(menuH);
        if (set) {
          const label = page.type === "header" ? "Header" : page.type === "footer" ? "Footer" : page.title;
          set.add(label);
        }
      }
      if (Array.isArray(b.props.columns)) {
        for (const col of b.props.columns as Array<Record<string, unknown>>) {
          if (col && typeof col.menuHandle === "string") {
            const set = usage.get(col.menuHandle);
            if (set) {
              set.add("Footer");
            }
          }
        }
      }
      const filterH = b.props.filterMenuHandle;
      if (typeof filterH === "string") {
        const set = usage.get(filterH);
        if (set) {
          const label = page.type === "collection_template" ? "Collection template" : page.title;
          set.add(label);
        }
      }
    }
  }

  return usage;
}

export async function listMenus(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.menus).orderBy(schema.menus.title);
    const pageRows = await tx
      .select({
        title: schema.pages.title,
        type: schema.pages.type,
        document: schema.pageVersions.document,
      })
      .from(schema.pages)
      .leftJoin(
        schema.pageVersions,
        eq(schema.pageVersions.id, schema.pages.publishedVersionId),
      );

    const usageMap = computeMenuUsage(rows, pageRows);

    return rows.map((r) => {
      const items = (r.items as unknown[]) ?? [];
      const usedIn = Array.from(usageMap.get(r.handle) ?? []);
      return {
        id: r.id,
        name: r.title,
        handle: r.handle,
        kind: (r.kind as "navigation" | "filter") || "navigation",
        itemCount: countMenuItems(items),
        usedIn,
        isProtected: isProtectedMenu(r.handle),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  });
}

export async function getMenu(rt: Runtime, ctx: TenantContext, input: { handle: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // A deleted default menu stays deleted: nothing re-creates it when it is listed or opened.
    const [row] = await tx
      .select()
      .from(schema.menus)
      .where(eq(schema.menus.handle, input.handle));

    if (!row) throw new Error(`Not Found: Menu not found: "${input.handle}"`);

    // Legacy seeded menus lack item ids and types, which broke the editor (blank screen).
    const items = row.kind === "filter" ? ((row.items as unknown[]) ?? []) : normalizeMenuItems(row.items);

    const pageRows = await tx
      .select({
        title: schema.pages.title,
        type: schema.pages.type,
        document: schema.pageVersions.document,
      })
      .from(schema.pages)
      .leftJoin(
        schema.pageVersions,
        eq(schema.pageVersions.id, schema.pages.publishedVersionId),
      );

    const usageMap = computeMenuUsage([row], pageRows);
    const usedIn = Array.from(usageMap.get(row.handle) ?? []);

    return {
      id: row.id,
      name: row.title,
      handle: row.handle,
      kind: (row.kind as "navigation" | "filter") || "navigation",
      itemCount: countMenuItems(items),
      usedIn,
      isProtected: isProtectedMenu(row.handle),
      items,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function createMenu(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    name: string;
    handle: string;
    kind?: "navigation" | "filter" | undefined;
    items?: unknown[] | undefined;
  },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;
  const kind = input.kind ?? "navigation";
  const items = kind === "filter" ? (input.items ?? []) : tidyMenuLinks(input.items ?? []);
  validateMenuItems(kind, items);

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.menus)
      .values({
        tenantId: ctx.tenantId,
        title: input.name,
        handle: input.handle,
        kind,
        items,
      })
      .returning();

    if (!row) throw new Error("Failed to create menu");

    return {
      id: row.id,
      name: row.title,
      handle: row.handle,
      kind: (row.kind as "navigation" | "filter") || "navigation",
      itemCount: countMenuItems(items),
      isProtected: isProtectedMenu(row.handle),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function updateMenu(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    id: string;
    name?: string | undefined;
    handle?: string | undefined;
    kind?: "navigation" | "filter" | undefined;
    items?: unknown[] | undefined;
  },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx.select().from(schema.menus).where(eq(schema.menus.id, input.id));
    if (!existing) throw new Error(`Not Found: Menu not found: "${input.id}"`);

    if (input.handle !== undefined && input.handle !== existing.handle) {
      if (isProtectedMenu(existing.handle)) {
        throw new Error(`Bad Request: Cannot change handle of protected menu "${existing.handle}"`);
      }
    }

    const effectiveKind = input.kind ?? (existing.kind as "navigation" | "filter") ?? "navigation";
    const effectiveItems = input.items !== undefined ? (effectiveKind === "filter" ? input.items : tidyMenuLinks(input.items)) : ((existing.items as unknown[]) ?? []);
    validateMenuItems(effectiveKind, effectiveItems);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.title = input.name;
    if (input.handle !== undefined) updateData.handle = input.handle;
    if (input.kind !== undefined) updateData.kind = input.kind;
    if (input.items !== undefined) updateData.items = effectiveItems;

    const [updated] = await tx
      .update(schema.menus)
      .set(updateData)
      .where(eq(schema.menus.id, input.id))
      .returning();

    if (!updated) throw new Error(`Not Found: Menu not found: "${input.id}"`);
    return updated;
  });

  await invalidateCache(rt, ctx, { type: "nav_updated" });

  const items = (row.items as unknown[]) ?? [];
  return {
    id: row.id,
    name: row.title,
    handle: row.handle,
    kind: (row.kind as "navigation" | "filter") || "navigation",
    itemCount: countMenuItems(items),
    isProtected: isProtectedMenu(row.handle),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deleteMenu(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx.select().from(schema.menus).where(eq(schema.menus.id, input.id));
    if (!existing) throw new Error(`Not Found: Menu not found: "${input.id}"`);

    // Default menus (header, footer) can be deleted like any other menu; a store may start from scratch.
    await tx.delete(schema.menus).where(eq(schema.menus.id, input.id));
  });

  // After commit (AGENTS.md rule 13): storefront navigation caches must drop the deleted menu.
  await invalidateCache(rt, ctx, { type: "nav_updated" });
  return { success: true };
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
          type: "HeroSlider",
          version: 1,
          props: {
            slides: [
              {
                title: "Welcome to Our Store",
                subtitle: "Discover our handcrafted collection of high-quality products.",
                primaryLabel: "Shop All",
                primaryHref: "/collections",
              },
            ],
          },
        },
        { id: "default-usp", type: "TrustStrip", version: 1, props: {} },
        {
          id: "default-grid",
          type: "ProductShowcase",
          version: 1,
          props: {
            title: "Featured Products",
            subtitle: "Explore our latest arrivals",
            limit: 8,
          },
        },
      ],
    },
  };
}

