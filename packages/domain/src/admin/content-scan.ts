/**
 * Small pure readers over what a store wrote: pictures with no description (alt text) in blog posts and page blocks, and links
 * inside blog HTML. Used by SEO health and the link check; no database here.
 */

/** Pictures in a blog post's HTML with no alt text (missing, empty or blank). Decorative `role="presentation"` ones do not count. */
export function countImagesWithoutAlt(html: string): number {
  let n = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (/\brole\s*=\s*["']presentation["']/i.test(tag)) continue;
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!alt || !(alt[1] ?? alt[2] ?? "").trim()) n++;
  }
  return n;
}

/** Picture blocks in a page document that have a picture but no alt text. */
export function countBlocksWithoutAlt(node: unknown, depth = 0): number {
  if (depth > 12) return 0;
  if (Array.isArray(node)) return node.reduce<number>((sum, item) => sum + countBlocksWithoutAlt(item, depth + 1), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as { type?: unknown; props?: Record<string, unknown> } & Record<string, unknown>;
  let n = 0;
  if (o.type === "Image" && o.props) {
    const hasPicture = (typeof o.props["imageUrl"] === "string" && o.props["imageUrl"] !== "") || typeof o.props["mediaId"] === "string";
    const alt = typeof o.props["alt"] === "string" ? o.props["alt"].trim() : "";
    if (hasPicture && !alt) n++;
  }
  for (const value of Object.values(o)) if (value && typeof value === "object") n += countBlocksWithoutAlt(value, depth + 1);
  return n;
}

/** Every `href` in a blog post's HTML, in order. Anchors, mail and phone links are returned too; the caller judges them. */
export function hrefsInHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2] ?? "").trim();
    if (href) out.push(href.replace(/&amp;/g, "&"));
  }
  return out;
}
