import type { Metadata } from "next";
import { decodeEntities } from "@bs/domain";

/**
 * Title, description, canonical and structured data for the two index pages (`/collections` and `/categories`). Both draw the
 * theme's archive template, so the words come from there: the page's own SEO settings when it has them, else the title and
 * subtitle of the first grid in the template (editable in the theme editor), else a plain default. Pure, so it is unit-tested.
 */
export interface ArchiveCopy {
  title: string;
  description: string;
}

interface Node {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: unknown;
  [key: string]: unknown;
}

/** The first grid block's title and subtitle in document order, searched through nested blocks. */
export function firstGridCopy(blocks: unknown, depth = 0): { title?: string; subtitle?: string } | null {
  if (depth > 8 || !Array.isArray(blocks)) return null;
  for (const b of blocks as Node[]) {
    if (!b || typeof b !== "object") continue;
    if ((b.type === "CollectionGrid" || b.type === "CollectionShowcase") && b.props) {
      const title = typeof b.props["title"] === "string" ? b.props["title"].trim() : "";
      const subtitle = typeof b.props["subtitle"] === "string" ? b.props["subtitle"].trim() : "";
      if (title || subtitle) return { ...(title ? { title } : {}), ...(subtitle ? { subtitle } : {}) };
    }
    for (const value of Object.values(b)) {
      const nested = firstGridCopy(Array.isArray(value) ? value : (value as Node | undefined)?.children, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * `/collections` and `/categories` draw one shared template, so a page-level SEO title would be the same on both. The categories
 * page therefore passes `shared: true`: it ignores the page SEO and any grid wording that is about collections, and uses its own
 * default instead (a grid titled for categories is used as it is).
 */
export function archiveCopy(opts: { seo: unknown; blocks: unknown; fallback: ArchiveCopy; shared?: boolean }): ArchiveCopy {
  const seo = !opts.shared && opts.seo && typeof opts.seo === "object" && !Array.isArray(opts.seo) ? (opts.seo as Record<string, unknown>) : {};
  const found = firstGridCopy(opts.blocks);
  const about = (s: string | undefined) => (opts.shared && s && /collection/i.test(s) ? undefined : s);
  const grid = found ? { title: about(found.title), subtitle: about(found.subtitle) } : null;
  const pick = (stored: unknown, fromGrid: string | undefined, fallback: string): string => {
    const v = typeof stored === "string" && stored.trim() ? stored.trim() : fromGrid || fallback;
    return decodeEntities(v);
  };
  return {
    title: pick(seo["title"], grid?.title, opts.fallback.title),
    description: pick(seo["description"], grid?.subtitle, opts.fallback.description),
  };
}

export function archiveMetadata(opts: { copy: ArchiveCopy; storeName: string; host: string; prefix: string; path: "/collections" | "/categories" }): Metadata {
  const name = decodeEntities(opts.storeName);
  const title = opts.copy.title.toLowerCase().includes(name.toLowerCase()) ? opts.copy.title : `${opts.copy.title} | ${name}`;
  const url = `https://${opts.host.replace(/^https?:\/\//, "")}${opts.prefix}${opts.path}`;
  return {
    title,
    description: opts.copy.description,
    alternates: { canonical: url },
    openGraph: { title, description: opts.copy.description, url, siteName: name },
    twitter: { card: "summary", title, description: opts.copy.description },
  };
}

/** `CollectionPage` with an `ItemList` of what the page lists, for search engines and AI assistants. */
export function archiveJsonLd(opts: { copy: ArchiveCopy; host: string; prefix: string; path: "/collections" | "/categories"; itemPath: "/collections" | "/categories"; items: Array<{ title: string; slug: string }> }): Record<string, unknown> {
  const base = `https://${opts.host.replace(/^https?:\/\//, "")}${opts.prefix}`;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: opts.copy.title,
    description: opts.copy.description,
    url: `${base}${opts.path}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: opts.items.length,
      itemListElement: opts.items.slice(0, 50).map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.title, url: `${base}${opts.itemPath}/${it.slug}` })),
    },
  };
}

/** What the archive's grids list, from the data the page already loaded for its blocks. */
export function archiveItems(renderData: unknown): Array<{ title: string; slug: string }> {
  const out: Array<{ title: string; slug: string }> = [];
  const seen = new Set<string>();
  if (renderData && typeof renderData === "object") {
    const data = (renderData as { data?: Record<string, { kind?: string; collections?: Array<{ title: string; slug: string }> } | undefined> }).data ?? (renderData as Record<string, never>);
    for (const entry of Object.values(data)) {
      if (entry && typeof entry === "object" && entry.kind === "collections" && Array.isArray(entry.collections)) {
        for (const c of entry.collections) {
          if (c?.slug && !seen.has(c.slug)) {
            seen.add(c.slug);
            out.push({ title: c.title, slug: c.slug });
          }
        }
      }
    }
  }
  return out;
}
