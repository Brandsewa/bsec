import { walkBlocks, type BlockInstance } from "@bs/blocks";

const DATA_TYPES = new Set(["ProductGrid", "ProductCarousel", "CollectionGrid", "ProductShowcase"]);
const DATA_PROPS = ["source", "collectionSlug", "productSlugs", "collectionSlugs", "limit", "tabs"] as const;
const MEDIA_PROPS = ["backgroundMediaId", "mediaId"] as const;

/**
 * Changes only when something that affects server-resolved render data changes (which products a
 * widget shows, which images are used), so typing in a heading does not refetch anything.
 */
export function dataSignature(blocks: BlockInstance[]): string {
  const parts: unknown[] = [];
  walkBlocks(blocks, (b) => {
    if (DATA_TYPES.has(b.type)) parts.push([b.id, b.type, ...DATA_PROPS.map((k) => b.props[k])]);
    if (b.type === "SiteHeader") parts.push([b.id, b.type, b.props.menuHandle]);
    if (b.type === "SiteFooter") {
      const handles = Array.isArray(b.props.columns)
        ? (b.props.columns as Array<Record<string, unknown>>).map((c) => c?.menuHandle)
        : [];
      parts.push([b.id, b.type, handles]);
    }
    const media = MEDIA_PROPS.map((k) => b.props[k]).filter(Boolean);
    for (const list of [b.props.items, b.props.images, b.props.slides]) {
      if (Array.isArray(list)) {
        for (const it of list) {
          const r = it as Record<string, unknown>;
          if (r?.avatarMediaId) media.push(r.avatarMediaId);
          if (r?.mediaId) media.push(r.mediaId);
          if (r?.backgroundMediaId) media.push(r.backgroundMediaId);
        }
      }
    }
    if (media.length) parts.push([b.id, media]);
  });
  return JSON.stringify(parts);
}
