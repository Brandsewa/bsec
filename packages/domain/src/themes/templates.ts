import { asc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { getBlockDefinition, validateBlockDocument, type BlockInstance, type BlockType } from "@bs/blocks";
import { LAUNCH_TEMPLATE_TOKENS } from "./launch-template.ts";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, writePlatformAudit, type AuditMeta } from "../platform-services.ts";

/**
 * Platform theme templates (PLAN §5.1, ADR-009). A template is the platform-level definition
 * of a theme: tokens plus one block list per page key. Stores never edit it: activating a theme
 * copies the published snapshot (`default_*`) into the store's own rows, so improving a template
 * can never overwrite a store's customizations.
 *
 * Staff edit `draft_*` in the visual editor; publish copies draft -> snapshot and bumps version.
 */

export type TemplatePages = Record<string, BlockInstance[]>;

export interface TemplateSummary {
  code: string;
  name: string;
  industry: string;
  description: string | null;
  features: string[];
  version: number;
  isActive: boolean;
  /** published: stores can pick it. draft: being built, never published. archived: taken down by staff. */
  status: "draft" | "published" | "archived";
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  draftPages: TemplatePages;
  draftTokens: Record<string, unknown>;
}

type Row = typeof schema.themeTemplates.$inferSelect;

const PAGE_KEY = /^[a-z0-9-]{1,60}$/;

export async function assertThemeEditor(rt: Runtime, staffUserId: string): Promise<void> {
  const { role } = await assertPlatformStaff(rt, staffUserId);
  if (role !== "platform_owner" && role !== "platform_admin") {
    throw new Error("Forbidden: editing theme templates requires platform_admin or platform_owner");
  }
}

function pagesOf(value: unknown): TemplatePages {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: TemplatePages = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v as BlockInstance[];
  }
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function summarize(r: Row): TemplateSummary {
  return {
    code: r.code,
    name: r.name,
    industry: r.industry,
    description: r.description,
    features: r.features ?? [],
    version: r.version,
    isActive: r.isActive,
    status: r.isActive ? "published" : r.archivedAt ? "archived" : "draft",
    hasUnpublishedChanges:
      (r.draftPages != null && !sameJson(r.draftPages, r.defaultPages)) ||
      (r.draftTokens != null && !sameJson(r.draftTokens, r.defaultTokens)),
    publishedAt: r.publishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function detail(r: Row): TemplateDetail {
  return {
    ...summarize(r),
    draftPages: pagesOf(r.draftPages ?? r.defaultPages),
    draftTokens: (r.draftTokens ?? r.defaultTokens) as Record<string, unknown>,
  };
}

/** A new theme starts with one sensible layout for every page, built from each block's defaults. */
function starterPages(): TemplatePages {
  const one = (id: string, type: BlockType): BlockInstance[] => [
    { id, type, version: 1, props: structuredClone(getBlockDefinition(type).defaultProps) as Record<string, unknown> },
  ];
  return {
    home: [
      ...one("hero-1", "Hero"),
      ...one("usp-1", "UspStrip"),
      ...one("products-1", "ProductGrid"),
    ],
    collection: one("collection-1", "CollectionListing"),
    product: one("product-1", "ProductDetail"),
    cart: one("cart-1", "CartContents"),
    header: one("header-1", "SiteHeader"),
    footer: one("footer-1", "SiteFooter"),
  };
}

/** Validates every page of a template. Returns cleaned pages or throws with a readable message. */
export function validateTemplatePages(pages: TemplatePages): TemplatePages {
  const out: TemplatePages = {};
  for (const [key, blocks] of Object.entries(pages)) {
    if (!PAGE_KEY.test(key)) throw new Error(`Bad Request: Invalid page key "${key}" (use lowercase letters, numbers and dashes)`);
    const result = validateBlockDocument({ version: 1, blocks });
    if (!result.success) {
      throw new Error(`Bad Request: Page "${key}" is invalid: ${result.errors.map((e) => `${e.path}: ${e.message}`).join(", ")}`);
    }
    out[key] = result.data.blocks;
  }
  if (!out.home) throw new Error('Bad Request: A theme must define a "home" page');
  return out;
}

export async function listThemeTemplates(rt: Runtime, staffUserId: string): Promise<TemplateSummary[]> {
  await assertPlatformStaff(rt, staffUserId);
  const rows = await rt._db.db.select().from(schema.themeTemplates).orderBy(asc(schema.themeTemplates.createdAt));
  return rows.map(summarize);
}

export async function getThemeTemplate(rt: Runtime, staffUserId: string, code: string): Promise<TemplateDetail> {
  await assertPlatformStaff(rt, staffUserId);
  const [row] = await rt._db.db.select().from(schema.themeTemplates).where(eq(schema.themeTemplates.code, code)).limit(1);
  if (!row) throw new Error(`Template not found: "${code}"`);
  return detail(row);
}

export interface CreateTemplateInput {
  name: string;
  industry?: string | undefined;
  description?: string | undefined;
  /** Start from another template's draft instead of the blank starter. */
  cloneFromCode?: string | undefined;
}

export async function createThemeTemplate(
  rt: Runtime,
  staffUserId: string,
  input: CreateTemplateInput,
  meta?: AuditMeta,
): Promise<TemplateDetail> {
  await assertThemeEditor(rt, staffUserId);
  const db = rt._db.db;

  const code =
    input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "theme";

  let pages: TemplatePages = starterPages();
  let tokens: Record<string, unknown> = structuredClone(LAUNCH_TEMPLATE_TOKENS) as Record<string, unknown>;
  if (input.cloneFromCode) {
    const [src] = await db.select().from(schema.themeTemplates).where(eq(schema.themeTemplates.code, input.cloneFromCode)).limit(1);
    if (!src) throw new Error(`Template not found: "${input.cloneFromCode}"`);
    pages = pagesOf(src.draftPages ?? src.defaultPages);
    tokens = (src.draftTokens ?? src.defaultTokens) as Record<string, unknown>;
  }

  return db.transaction(async (tx) => {
    let finalCode = code;
    for (let i = 2; i < 50; i++) {
      const [taken] = await tx.select({ id: schema.themeTemplates.id }).from(schema.themeTemplates).where(eq(schema.themeTemplates.code, finalCode)).limit(1);
      if (!taken) break;
      finalCode = `${code}-${i}`;
    }
    // New themes start unpublished: is_active=false hides them from the store library.
    const [row] = await tx
      .insert(schema.themeTemplates)
      .values({
        code: finalCode,
        name: input.name,
        industry: input.industry ?? "general",
        description: input.description ?? null,
        features: [],
        defaultTokens: tokens,
        defaultPages: {},
        draftPages: pages,
        draftTokens: tokens,
        isActive: false,
      })
      .returning();
    if (!row) throw new Error("Failed to create template");
    await writePlatformAudit(tx, staffUserId, "theme_template.create", "theme_template", row.code, null, { name: input.name, cloneFrom: input.cloneFromCode ?? null }, meta);
    return detail(row);
  });
}

export interface SaveTemplateDraftInput {
  code: string;
  pages: TemplatePages;
  tokens?: Record<string, unknown> | undefined;
}

/** Saves the work-in-progress; stores are unaffected until publish. Audited like every platform change. */
export async function saveThemeTemplateDraft(
  rt: Runtime,
  staffUserId: string,
  input: SaveTemplateDraftInput,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  await assertThemeEditor(rt, staffUserId);
  const pages = validateTemplatePages(input.pages);
  const set: Partial<typeof schema.themeTemplates.$inferInsert> = { draftPages: pages, updatedAt: new Date() };
  if (input.tokens) set.draftTokens = input.tokens;
  await rt._db.db.transaction(async (tx) => {
    const res = await tx.update(schema.themeTemplates).set(set).where(eq(schema.themeTemplates.code, input.code)).returning({ id: schema.themeTemplates.id });
    if (res.length === 0) throw new Error(`Template not found: "${input.code}"`);
    const blockCount = Object.values(pages).reduce((n, list) => n + list.length, 0);
    await writePlatformAudit(tx, staffUserId, "theme_template.draft_save", "theme_template", input.code, null, { pages: Object.keys(pages), topLevelBlocks: blockCount }, meta);
  });
  return { ok: true };
}

/** Publishes the draft as the new snapshot stores copy from; bumps the template version. */
export async function publishThemeTemplate(
  rt: Runtime,
  staffUserId: string,
  code: string,
  meta?: AuditMeta,
): Promise<{ version: number }> {
  await assertThemeEditor(rt, staffUserId);
  return rt._db.db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.themeTemplates).where(eq(schema.themeTemplates.code, code)).limit(1);
    if (!row) throw new Error(`Template not found: "${code}"`);
    const pages = validateTemplatePages(pagesOf(row.draftPages ?? row.defaultPages));
    const tokens = (row.draftTokens ?? row.defaultTokens) as Record<string, unknown>;
    const [updated] = await tx
      .update(schema.themeTemplates)
      .set({
        defaultPages: pages,
        defaultTokens: tokens,
        draftPages: pages,
        draftTokens: tokens,
        isActive: true,
        archivedAt: null,
        publishedAt: new Date(),
        version: sql`${schema.themeTemplates.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.themeTemplates.code, code))
      .returning({ version: schema.themeTemplates.version });
    if (!updated) throw new Error("Failed to publish template");
    await writePlatformAudit(tx, staffUserId, "theme_template.publish", "theme_template", code, null, { version: updated.version }, meta);
    return { version: updated.version };
  });
}

export interface UpdateTemplateMetaInput {
  code: string;
  name?: string | undefined;
  description?: string | null | undefined;
  industry?: string | undefined;
  features?: string[] | undefined;
  isActive?: boolean | undefined;
  /** true: archive (hidden from stores, moves to the Archive tab); false: restore it to Drafts. */
  archived?: boolean | undefined;
}

/**
 * Permanently deletes a theme from the platform. Only a theme stores cannot pick (a draft or an archived
 * one) can be deleted, so a theme stores can still pick is never removed by accident. Stores that already activated it keep their
 * own copy of its pages and settings; they just stop seeing it in the library. Audited.
 */
export async function deleteThemeTemplate(
  rt: Runtime,
  staffUserId: string,
  code: string,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  await assertThemeEditor(rt, staffUserId);
  return rt._db.db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.themeTemplates).where(eq(schema.themeTemplates.code, code)).limit(1);
    if (!row) throw new Error(`Template not found: "${code}"`);
    if (row.isActive) throw new Error("Archive this theme before deleting it");
    await tx.delete(schema.themeTemplates).where(eq(schema.themeTemplates.id, row.id));
    await writePlatformAudit(tx, staffUserId, "theme_template.delete", "theme_template", code, null, { name: row.name, version: row.version }, meta);
    return { ok: true as const };
  });
}

/** Edits library card details, or hides/shows a published theme (unpublish keeps store copies). */
export async function updateThemeTemplateMeta(
  rt: Runtime,
  staffUserId: string,
  input: UpdateTemplateMetaInput,
  meta?: AuditMeta,
): Promise<TemplateSummary> {
  await assertThemeEditor(rt, staffUserId);
  const set: Partial<typeof schema.themeTemplates.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.industry !== undefined) set.industry = input.industry;
  if (input.features !== undefined) set.features = input.features.slice(0, 10);
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (input.archived === true) {
    set.isActive = false;
    set.archivedAt = new Date();
  } else if (input.archived === false) {
    set.archivedAt = null;
  }
  return rt._db.db.transaction(async (tx) => {
    const [row] = await tx.update(schema.themeTemplates).set(set).where(eq(schema.themeTemplates.code, input.code)).returning();
    if (!row) throw new Error(`Template not found: "${input.code}"`);
    await writePlatformAudit(tx, staffUserId, "theme_template.update", "theme_template", row.code, null, { ...input }, meta);
    return summarize(row);
  });
}
