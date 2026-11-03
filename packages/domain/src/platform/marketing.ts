import { MARKETING_STARTERS, MkFooterSchema, MkHeaderSchema, THEME_SYSTEM_PAGES, isWebsiteFooterBlockSet, isWebsiteHeaderBlockSet, isWebsitePageBlockSet, validateBlockDocument, type BlockInstance } from "@bs/blocks";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { createPage, savePageDraft } from "../content-services.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta, type PlatformRole } from "../platform-services.ts";
import type { Runtime } from "../runtime.ts";
import { updateStoreStatus } from "../storefront/lifecycle.ts";
import { getPlatformSiteId, PLATFORM_SITE_SLUG } from "./platform-site.ts";

/** Creates the website record on first use, with its audit row. Calling it again changes nothing. */
export async function enablePlatformSite(rt: Runtime, staffUserId: string, meta?: AuditMeta): Promise<{ siteId: string }> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_admin", "setting up the website");
  const db = rt._db.db;
  const existing = await getPlatformSiteId(db);
  if (existing) return { siteId: existing };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.tenants)
      .values({ slug: PLATFORM_SITE_SLUG, name: "BCOM website", kind: "platform_site", status: "active" })
      .onConflictDoNothing()
      .returning({ id: schema.tenants.id });
    const siteId = row?.id ?? (await getPlatformSiteId(tx));
    if (!siteId) throw new Error(`Conflict: the slug ${PLATFORM_SITE_SLUG} is taken by a store`);
    if (row) await writePlatformAudit(tx, staffUserId, "platform_site.create", "tenant", siteId, siteId, {}, meta);
    return { siteId };
  });
}

/**
 * The context Marketing procedures pass to the content services. Built only on the server, for the website record, with
 * what writing and publishing content needs. Use it solely with the `app_rw` runtime: the services rely on RLS (ADR-042).
 */
export function platformSiteContext(siteId: string, staffUserId: string, requestId?: string): TenantContext {
  return {
    tenantId: siteId,
    storeStatus: "live",
    actor: { type: "staff", userId: staffUserId },
    // store_owner: the maintenance window is owner-only in the status service; here the staff member is the owner of the website.
    roles: ["platform_site_editor", "store_owner"],
    permissions: ["content.write", "theme.publish", "settings.read", "storefront.manage", "policies.manage", "privacy.manage"],
    requestId: requestId ?? crypto.randomUUID(),
  };
}

/** A new website page, starting from the built-in version of that page when there is one (About). */
export async function createPlatformSitePage(rt: Runtime, ctx: TenantContext, input: Parameters<typeof createPage>[2]) {
  // "home" is reserved as a page URL; the website's Home page is stored as "bcom-home" and shown at "/".
  const isHome = input.slug === "home";
  const page = await createPage(rt, ctx, isHome ? { ...input, slug: "bcom-home", title: input.title || "Home page" } : input);
  const starter = MARKETING_STARTERS[page.slug];
  if (starter) await savePageDraft(rt, ctx, { id: page.id, blocks: starter });
  return page;
}

/** The website is built only from its own sections: store blocks need a store's theme, data and stylesheet. */
export async function savePlatformSiteDraft(rt: Runtime, ctx: TenantContext, input: { id: string; blocks: unknown[] }) {
  const blocks = input.blocks as BlockInstance[];
  const [page] = await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select({ type: schema.pages.type }).from(schema.pages).where(eq(schema.pages.id, input.id)).limit(1));
  const ok = page?.type === "header" ? isWebsiteHeaderBlockSet(blocks) : page?.type === "footer" ? isWebsiteFooterBlockSet(blocks) : isWebsitePageBlockSet(blocks);
  if (!ok) throw new Error("Bad Request: this block belongs to stores, not the website");
  return savePageDraft(rt, ctx, input);
}

/**
 * A store with no status row reads as "coming soon". The website must read as live, so its row is created on first use
 * (setup, or the first visit to Settings for a website set up before this existed). Does nothing when a row exists.
 */
export async function ensureSiteStatusLive(rt: Runtime, ctx: TenantContext): Promise<void> {
  const rows = await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select({ id: schema.storeStatus.tenantId }).from(schema.storeStatus).limit(1));
  if (rows.length > 0) return;
  await updateStoreStatus(rt, ctx, { mode: "live", collectEmails: false });
}

/**
 * The website's header or footer page, created from today's layout when it does not exist yet. Safe to call again: it
 * returns the existing page. The published chrome replaces the built-in header or footer (ADR-011).
 */
export async function ensurePlatformSiteChrome(rt: Runtime, ctx: TenantContext, input: { key: "header" | "footer" }): Promise<{ id: string; created: boolean }> {
  assertPermission(ctx, "content.write");
  const def = THEME_SYSTEM_PAGES[input.key];
  const type = input.key === "header" ? "MkHeader" : "MkFooter";
  const props = (input.key === "header" ? MkHeaderSchema : MkFooterSchema).parse({});
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.tenantId, ctx.tenantId), eq(schema.pages.type, def.type))).limit(1);
    if (existing) return { id: existing.id, created: false };
    const document = validateBlockDocument({ version: 1, blocks: [{ id: crypto.randomUUID(), type, version: 1, props }] });
    if (!document.success) throw new Error("The built-in layout is not valid.");
    const [row] = await tx.insert(schema.pages).values({ tenantId: ctx.tenantId, title: def.title, slug: def.slug, type: def.type, status: "draft" }).returning({ id: schema.pages.id });
    if (!row) throw new Error("Failed to create the page");
    const [draft] = await tx.insert(schema.pageVersions).values({ tenantId: ctx.tenantId, pageId: row.id, document: document.data }).returning({ id: schema.pageVersions.id });
    if (!draft) throw new Error("Failed to create the draft");
    await tx.update(schema.pages).set({ draftVersionId: draft.id }).where(eq(schema.pages.id, row.id));
    await tx.insert(schema.auditLogs).values({ tenantId: ctx.tenantId, actorType: ctx.actor.type, actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null, action: "page.chrome_created", targetType: "page", targetId: row.id, diff: { key: input.key } });
    return { id: row.id, created: true };
  });
}
