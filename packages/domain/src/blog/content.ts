import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@bs/db";
import type { withTenant } from "@bs/db";
import { isUuid, sanitizeBlogHtml } from "@bs/blocks";
import { publicMediaUrl } from "../media/storage.ts";
import { PRIVATE_MEDIA_FOLDERS } from "../media/types.ts";
import type { TenantContext } from "../context.ts";

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/** Post slugs that would collide with a blog route (ADR-033). */
export const RESERVED_BLOG_SLUGS = new Set(["page", "category", "feed.xml", "tag", "search", "rss"]);

export const BLOG_EXCERPT_MAX = 300;
export const BLOG_MAX_BODY_CHARS = 200_000;

export function slugifyBlog(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
    .replace(/-$/, "");
}

/** Plain text, no angle brackets, max 300; blank becomes null. */
export function cleanBlogExcerpt(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim();
  if (!v) return null;
  if (/[<>]/.test(v)) throw new Error("Bad Request: The excerpt must be plain text (no HTML).");
  if (v.length > BLOG_EXCERPT_MAX) throw new Error(`Bad Request: The excerpt can be at most ${BLOG_EXCERPT_MAX} characters.`);
  return v;
}

export interface BlogSeoInput {
  title?: string | null | undefined;
  description?: string | null | undefined;
  imageMediaId?: string | null | undefined;
  noindex?: boolean | undefined;
}

export function cleanBlogSeo(seo: BlogSeoInput | null | undefined): BlogSeoInput | null {
  if (!seo) return null;
  const title = seo.title?.trim().slice(0, 120) || undefined;
  const description = seo.description?.trim().slice(0, 320) || undefined;
  const imageMediaId = isUuid(seo.imageMediaId) ? seo.imageMediaId.trim().toLowerCase() : undefined;
  const noindex = seo.noindex === true ? true : undefined;
  if (!title && !description && !imageMediaId && !noindex) return null;
  return { ...(title ? { title } : {}), ...(description ? { description } : {}), ...(imageMediaId ? { imageMediaId } : {}), ...(noindex ? { noindex } : {}) };
}

export interface BlogHeading {
  id: string;
  text: string;
  level: 2 | 3 | 4;
}

export interface PreparedBlogBody {
  html: string;
  text: string;
  readingMinutes: number;
  mediaIds: string[];
  headings: BlogHeading[];
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ");
}

export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<\/(p|h[1-6]|li|blockquote|figcaption|pre)>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Adds ids to h2-h4 (sanitised markup has no attributes on headings) and lists them for the table of contents. */
export function addHeadingIds(html: string): { html: string; headings: BlogHeading[] } {
  const headings: BlogHeading[] = [];
  const used = new Set<string>();
  const out = html.replace(/<h([234])>([\s\S]*?)<\/h\1>/g, (_m, lvl: string, inner: string) => {
    const text = htmlToText(inner);
    const base = slugifyBlog(text) || "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    headings.push({ id, text, level: Number(lvl) as 2 | 3 | 4 });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  return { html: out, headings };
}

/**
 * Sanitises a post body on the server. Inline images must name a media-library item of this store through
 * `data-media-id`; their `src` is rebuilt from that item, never taken from the browser.
 */
export async function prepareBlogBody(tx: Tx, ctx: TenantContext, raw: string): Promise<PreparedBlogBody> {
  if (raw.length > BLOG_MAX_BODY_CHARS) throw new Error("Bad Request: The post is too long.");
  const ids = new Set<string>();
  for (const m of raw.matchAll(/data-media-id\s*=\s*["']?([0-9a-fA-F-]{36})/g)) {
    if (isUuid(m[1])) ids.add(m[1].toLowerCase());
  }
  const map = new Map<string, { src: string; width?: number | null; height?: number | null }>();
  if (ids.size > 0) {
    const rows = await tx
      .select({ id: schema.media.id, key: schema.media.storageKey, folder: schema.media.folder, kind: schema.media.kind, width: schema.media.width, height: schema.media.height })
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), inArray(schema.media.id, [...ids])));
    for (const r of rows) {
      if (r.folder && (PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(r.folder)) continue;
      if (r.kind && r.kind !== "image") continue;
      const src = publicMediaUrl(r.key);
      if (src) map.set(r.id, { src, width: r.width, height: r.height });
    }
  }
  // The editor leaves empty paragraphs behind; they only add blank space.
  const clean = sanitizeBlogHtml(raw, map).replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/g, "");
  const withIds = addHeadingIds(clean);
  const text = htmlToText(withIds.html);
  const words = text ? text.split(" ").length : 0;
  return {
    html: withIds.html,
    text,
    readingMinutes: Math.max(1, Math.ceil(words / 200)),
    mediaIds: [...map.keys()].filter((id) => ids.has(id)),
    headings: withIds.headings,
  };
}

/** Table of contents of an already prepared body (ids were added on write). */
export function extractHeadings(html: string): BlogHeading[] {
  const out: BlogHeading[] = [];
  for (const m of html.matchAll(/<h([234]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)) {
    out.push({ id: m[2] ?? "", text: htmlToText(m[3] ?? ""), level: Number(m[1]) as 2 | 3 | 4 });
  }
  return out;
}
