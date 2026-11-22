/**
 * Link health (docs/STOREFRONT-AUDIT-FIXES-PLAN.md phase 4): reads the links a store wrote into its menus and published pages and
 * lists the ones that lead nowhere: an address nothing on the store has, a link to the store's preview address, an old checkout link
 * from another platform, a `www` address that is not connected. Read-only and on demand; nothing is crawled over the network.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { computeCanonicalPath } from "../content-services.ts";
import { classifyLink, type KnownTargets, type LinkProblem } from "./link-rules.ts";

export interface LinkHealthProblem extends LinkProblem {
  where: { type: "menu" | "page"; label: string };
}

export interface LinkHealthView {
  /** Distinct links read. */
  scanned: number;
  problems: LinkHealthProblem[];
  /** More problems exist than are listed. */
  truncated: boolean;
}

const MAX_PROBLEMS = 200;
const MAX_ROWS = 20_000;
const LINK_KEY = /(href|link|url)$/i;
const NOT_A_LINK_KEY = /(image|img|src|video|media|logo|icon|avatar|poster)/i;

/** Every link-like string under a link-like key, anywhere in a block document or a menu. Pure, so it is unit-tested. */
export function collectLinks(node: unknown, key = "", out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  if (typeof node === "string") {
    if (LINK_KEY.test(key) && !NOT_A_LINK_KEY.test(key) && node.length <= 2000 && !/\s/.test(node.trim()) && (node.startsWith("/") || /^https?:\/\//i.test(node))) out.push(node.trim());
  } else if (Array.isArray(node)) {
    for (const item of node) collectLinks(item, key, out, depth + 1);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collectLinks(v, k, out, depth + 1);
  }
  return out;
}

export async function getLinkHealth(rt: Runtime, ctx: TenantContext): Promise<LinkHealthView> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  const own = await db.select({ hostname: schema.domains.hostname }).from(schema.domains).where(eq(schema.domains.tenantId, ctx.tenantId));
  const ownHosts = new Set(own.map((d) => d.hostname.toLowerCase()));

  return withTenant(db, ctx.tenantId, async (tx) => {
    const t = ctx.tenantId;
    const [products, collections, categories, pageRows, posts, redirects, menus] = await Promise.all([
      tx.select({ s: schema.products.slug }).from(schema.products).where(and(eq(schema.products.tenantId, t), isNull(schema.products.deletedAt))).limit(MAX_ROWS),
      tx.select({ s: schema.collections.slug }).from(schema.collections).where(and(eq(schema.collections.tenantId, t), eq(schema.collections.published, true))).limit(MAX_ROWS),
      tx.select({ s: schema.categories.slug }).from(schema.categories).where(eq(schema.categories.tenantId, t)).limit(MAX_ROWS),
      tx
        .select({ id: schema.pages.id, parentId: schema.pages.parentId, slug: schema.pages.slug, type: schema.pages.type, title: schema.pages.title, versionId: schema.pages.publishedVersionId })
        .from(schema.pages)
        .where(and(eq(schema.pages.tenantId, t), eq(schema.pages.status, "published"), isNotNull(schema.pages.publishedVersionId)))
        .limit(MAX_ROWS),
      tx.select({ s: schema.blogPosts.slug }).from(schema.blogPosts).where(eq(schema.blogPosts.tenantId, t)).limit(MAX_ROWS),
      tx.select({ f: schema.tenantRedirects.fromPath }).from(schema.tenantRedirects).where(eq(schema.tenantRedirects.tenantId, t)).limit(5000),
      tx.select({ handle: schema.menus.handle, title: schema.menus.title, items: schema.menus.items, kind: schema.menus.kind }).from(schema.menus).where(eq(schema.menus.tenantId, t)),
    ]);

    const byId = new Map(pageRows.map((p) => [p.id, p]));
    const known: KnownTargets = {
      products: new Set(products.map((r) => r.s.toLowerCase())),
      collections: new Set(collections.map((r) => r.s.toLowerCase())),
      categories: new Set(categories.map((r) => r.s.toLowerCase())),
      pages: new Set(pageRows.map((p) => computeCanonicalPath(p, byId).toLowerCase())),
      blogPosts: new Set(posts.map((r) => r.s.toLowerCase())),
      redirects: new Set(redirects.map((r) => r.f.toLowerCase())),
      ownHosts,
    };

    const sources: Array<{ where: LinkHealthProblem["where"]; links: string[] }> = [];
    for (const m of menus) {
      if (m.kind === "filter") continue;
      sources.push({ where: { type: "menu", label: m.title || m.handle }, links: collectLinks(m.items) });
    }
    const versionIds = pageRows.map((p) => p.versionId).filter((v): v is string => Boolean(v));
    const versions = versionIds.length > 0 ? await tx.select({ id: schema.pageVersions.id, document: schema.pageVersions.document }).from(schema.pageVersions).where(and(eq(schema.pageVersions.tenantId, t), inArray(schema.pageVersions.id, versionIds))) : [];
    const docById = new Map(versions.map((v) => [v.id, v.document]));
    for (const p of pageRows) {
      const doc = p.versionId ? docById.get(p.versionId) : undefined;
      if (doc) sources.push({ where: { type: "page", label: p.title || p.slug }, links: collectLinks(doc) });
    }

    const problems: LinkHealthProblem[] = [];
    const seen = new Set<string>();
    const distinct = new Set<string>();
    let truncated = false;
    for (const s of sources) {
      for (const link of s.links) {
        distinct.add(link);
        const found = classifyLink(link, known);
        if (!found) continue;
        const key = `${s.where.type}|${s.where.label}|${link}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (problems.length >= MAX_PROBLEMS) truncated = true;
        else problems.push({ ...found, where: s.where });
      }
    }
    return { scanned: distinct.size, problems, truncated };
  });
}
